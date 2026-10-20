"use strict";
// Track 5 (partners and campaigns) coverage: feed fetching/parsing safety,
// category mapping, postback adjustments/reversals/assisted attribution and
// fraud holds through the real route, campaign editing rules, holdout lift
// math, quiet-hours rescheduling and legacy marketing-cap logging.
jest.mock("../db", () => ({ query: jest.fn(), connect: jest.fn() }));
jest.mock("../middleware/rateLimiter", () => ({
  strictLimiter: (req, res, next) => next(),
  generalLimiter: (req, res, next) => next(),
}));
const crypto = require("crypto");
const db = require("../db");
const feedFetch = require("../growth/partners/feedFetch");
const feedParse = require("../growth/partners/feedParse");
const { resolveCategory } = require("../growth/partners/categoryMap");
const fraud = require("../growth/partners/fraud");
const campaigns = require("../growth/campaigns");
const core = require("../services/delivery/core");
const { recordMarketingContact } = require("../growth/marketingLog");

process.env.GROWTH_SUBJECT_PEPPER = "synthetic-growth-subject-pepper-test-only";
process.env.GROWTH_PARTNER_OFFERS_ENABLED = "true";
process.env.GROWTH_PARTNER_POSTBACK_ACME_SECRET =
  "synthetic-postback-secret-for-tests-32chars";

describe("feed fetch SSRF boundaries", () => {
  test.each([
    ["8.8.8.8", true],
    ["1.1.1.1", true],
    ["172.15.0.1", true],
    ["10.0.0.1", false],
    ["172.16.0.1", false],
    ["172.31.255.255", false],
    ["192.168.1.1", false],
    ["127.0.0.1", false],
    ["169.254.169.254", false],
    ["100.64.0.1", false],
    ["224.0.0.1", false],
    ["0.0.0.0", false],
    ["2606:4700:4700::1111", true],
    ["::1", false],
    ["fe80::1", false],
    ["fd00::1", false],
    ["::ffff:127.0.0.1", false],
    ["::ffff:8.8.8.8", true],
  ])("isPublicAddress(%s) = %s", (ip, expected) =>
    expect(feedFetch.isPublicAddress(ip)).toBe(expected),
  );
  test("only https on allowlisted hosts without credentials or odd ports", () => {
    expect(
      feedFetch.assertSafeUrl("https://feeds.example.com/x.xml", [
        "feeds.example.com",
      ]).hostname,
    ).toBe("feeds.example.com");
    for (const bad of [
      "http://feeds.example.com/x",
      "https://evil.example.com/x",
      "https://user:pass@feeds.example.com/x",
      "https://feeds.example.com:8443/x",
    ])
      expect(() => feedFetch.assertSafeUrl(bad, ["feeds.example.com"])).toThrow();
  });
  const lookupPublic = async () => [{ address: "93.184.216.34", family: 4 }];
  test("redirects are re-validated against the allowlist", async () => {
    const transport = async () => ({
      status: 302,
      headers: { location: "https://169.254.169.254/latest/meta-data" },
      body: Buffer.alloc(0),
    });
    await expect(
      feedFetch.fetchFeed("https://feeds.example.com/x", {
        allowedHosts: ["feeds.example.com"],
        lookup: lookupPublic,
        transport,
      }),
    ).rejects.toThrow("feed_host_not_allowed");
  });
  test("private DNS answers are refused even for allowlisted hosts", async () => {
    await expect(
      feedFetch.fetchFeed("https://feeds.example.com/x", {
        allowedHosts: ["feeds.example.com"],
        lookup: async () => [{ address: "10.1.2.3", family: 4 }],
        transport: async () => ({ status: 200, headers: {}, body: Buffer.from("x") }),
      }),
    ).rejects.toThrow("feed_dns_private");
  });
  test("happy path returns the body", async () => {
    const { body } = await feedFetch.fetchFeed("https://feeds.example.com/x", {
      allowedHosts: ["feeds.example.com"],
      lookup: lookupPublic,
      transport: async () => ({
        status: 200,
        headers: {},
        body: Buffer.from("a,b\n1,2"),
      }),
    });
    expect(body.toString()).toContain("a,b");
  });
});

describe("feed parsing and normalization", () => {
  test("CSV handles quoted commas, escaped quotes and CRLF", () => {
    const rows = feedParse.parseCsv(
      'id,name,price\r\n1,"Drain, snake","12.99"\r\n2,"Say ""hi"" wrench",3.5',
    );
    expect(rows).toHaveLength(2);
    expect(rows[0].name).toBe("Drain, snake");
    expect(rows[1].name).toBe('Say "hi" wrench');
  });
  test("prices are exact string math, never floats or rounding", () => {
    expect(feedParse.parsePriceToMinor("12.99")).toEqual({
      minor: 1299,
      currency: null,
    });
    expect(feedParse.parsePriceToMinor("1,299.00")).toEqual({
      minor: 129900,
      currency: null,
    });
    expect(feedParse.parsePriceToMinor("3.50 USD")).toEqual({
      minor: 350,
      currency: "USD",
    });
    expect(feedParse.parsePriceToMinor("12.999")).toBeNull();
    expect(feedParse.parsePriceToMinor("abc")).toBeNull();
    expect(feedParse.parsePriceToMinor("")).toBeNull();
  });
  test("JSON feeds accept arrays and wrapped item lists", () => {
    expect(feedParse.parseJsonFeed('[{"id":1}]')).toHaveLength(1);
    expect(feedParse.parseJsonFeed('{"items":[{"id":1},{"id":2}]}')).toHaveLength(2);
    expect(() => feedParse.parseJsonFeed('{"nope":1}')).toThrow("feed_json_shape");
  });
  test("Google Merchant items lose their g: prefix, single or many", () => {
    const many = feedParse.parseFeed(
      "<rss><channel><item><g:id>9</g:id><g:title>GM</g:title><g:price>3.50 USD</g:price></item><item><g:id>10</g:id></item></channel></rss>",
      "google_merchant",
    );
    expect(many).toHaveLength(2);
    expect(many[0].price).toBe("3.50 USD");
    const one = feedParse.parseFeed(
      "<rss><channel><item><g:id>9</g:id></item></channel></rss>",
      "google_merchant",
    );
    expect(one).toHaveLength(1);
  });
  test("normalization requires id, name and a feed price; urls must be https", () => {
    const base = {
      id: "A1",
      name: "Snake",
      price: "12.99",
      link: "https://shop.example.com/x",
    };
    const ok = feedParse.normalizeItem(base, { url: "link" }, { currency: "USD" });
    expect(ok.item.priceCents).toBe(1299);
    expect(ok.item.imageDeferred).toBe(false);
    expect(
      feedParse.normalizeItem({ ...base, price: "" }, { url: "link" }).error,
    ).toBe("invalid_price");
    expect(
      feedParse.normalizeItem(
        { ...base, link: "http://shop.example.com/x" },
        { url: "link" },
        { currency: "USD" },
      ).error,
    ).toBe("invalid_url");
    expect(feedParse.normalizeItem({ name: "x", price: "1.00" }, {}).error).toBe(
      "missing_id",
    );
    expect(feedParse.parseAvailability("out of stock")).toBe(false);
    expect(feedParse.parseAvailability("in_stock")).toBe(true);
  });
});

describe("reviewed category mapping never guesses", () => {
  const mappings = [
    { category_path: "Tools", node_id: 7 },
    { category_path: "Tools > Plumbing", node_id: 8 },
  ];
  test("exact rule wins, then a reviewed parent rule", () => {
    expect(resolveCategory(mappings, "Tools > Plumbing").nodeId).toBe(8);
    expect(resolveCategory(mappings, "Tools > Plumbing > Wrenches").nodeId).toBe(8);
    expect(resolveCategory(mappings, "Tools > Electrical").nodeId).toBe(7);
  });
  test("unmapped stays unmapped", () => {
    expect(resolveCategory(mappings, "Garden > Hoses")).toBeNull();
    expect(resolveCategory([], "Tools")).toBeNull();
    expect(resolveCategory(mappings, "")).toBeNull();
  });
});

describe("postback fraud state machine", () => {
  test("transitions follow the conversion lifecycle", () => {
    expect(fraud.transitionAllowed("pending", "approved")).toBe(true);
    expect(fraud.transitionAllowed("approved", "paid")).toBe(true);
    expect(fraud.transitionAllowed("paid", "reversed")).toBe(true);
    expect(fraud.transitionAllowed("reversed", "approved")).toBe(false);
    expect(fraud.transitionAllowed("flagged", "approved")).toBe(false);
    expect(fraud.transitionAllowed("flagged", "reversed")).toBe(true);
  });
  test("amounts move only as corrections or partial reversals", () => {
    const existing = { sale_minor: "10000", commission_minor: "1000", status: "approved" };
    expect(
      fraud.amountsChangeAllowed(existing, {
        sale_minor: 10000,
        commission_minor: 1000,
        status: "paid",
      }),
    ).toBe(true);
    expect(
      fraud.amountsChangeAllowed(existing, {
        sale_minor: 10000,
        commission_minor: 400,
        status: "reversed",
      }),
    ).toBe(true);
    expect(
      fraud.amountsChangeAllowed(existing, {
        sale_minor: 10000,
        commission_minor: 2000,
        status: "paid",
      }),
    ).toBe(false);
    expect(
      fraud.amountsChangeAllowed(
        { ...existing, status: "pending" },
        { sale_minor: 9000, commission_minor: 900, status: "pending" },
      ),
    ).toBe(true);
  });
  test("screening flags impossible commissions using the anti-fraud patterns", async () => {
    const conn = {
      query: jest.fn(async () => ({ rows: [{ n: 0 }] })),
    };
    const flags = await fraud.screenConversion(conn, {
      partnerId: 1,
      clickId: crypto.randomUUID(),
      recipientUserId: null,
      saleMinor: 10000,
      commissionMinor: 6000,
    });
    expect(flags).toContainEqual({
      flag: "excessive_commission",
      severity: "high",
    });
    expect(fraud.shouldHold(flags)).toBe(true);
    const clean = await fraud.screenConversion(conn, {
      partnerId: 1,
      clickId: crypto.randomUUID(),
      recipientUserId: null,
      saleMinor: 10000,
      commissionMinor: 500,
    });
    expect(fraud.shouldHold(clean)).toBe(false);
  });
});

describe("partner postback route: adjustments, reversals, assisted, holds", () => {
  const express = require("express");
  const HELPER_ID = "00000000-0000-4000-8000-0000000000aa";
  const CLICK_ID = "00000000-0000-4000-8000-0000000000bb";
  let server, baseUrl, state;
  function freshState() {
    return {
      receipts: new Set(),
      conversions: new Map(),
    };
  }
  // The shared test setup replaces withTransaction with a pass-through
  // whose client delegates to pool.query, so the fake lives on db.query.
  function installFakeDb() {
    db.query.mockImplementation(async (sql, params) => {
      if (sql.includes("FROM affiliate_partners WHERE code"))
        return {
          rows: [{ id: 1, currencies: ["USD"], cookie_window_days: 30 }],
        };
      if (sql.includes("FROM offer_clicks"))
        return {
          rows: [
            {
              offer_id: 10,
              created_at: new Date().toISOString(),
              recipient_user_id: "00000000-0000-4000-8000-0000000000cc",
            },
          ],
        };
      if (sql.includes("SELECT * FROM affiliate_conversions"))
        return {
          rows: [...state.conversions.values()].filter(
            (r) => r.order_ref_hash === params[1],
          ),
        };
      if (sql.includes("INSERT INTO growth_partner_receipts")) {
        if (state.receipts.has(params[1])) return { rows: [], rowCount: 0 };
        state.receipts.add(params[1]);
        return { rows: [], rowCount: 1 };
      }
      if (sql.includes("FROM users WHERE id=$1 AND is_active"))
        return { rows: params[0] === HELPER_ID ? [{ id: HELPER_ID }] : [] };
      if (sql.includes("COUNT(*)::int AS n")) return { rows: [{ n: 0 }] };
      if (sql.includes("INSERT INTO affiliate_conversions")) {
        const row = {
          partner_id: params[0],
          click_id: params[1],
          order_ref_hash: params[2],
          sale_minor: String(params[3]),
          commission_minor: String(params[4]),
          currency: params[5],
          status: params[6],
          assisted: params[7],
          assisted_helper_id: params[8],
          fraud_flags: JSON.parse(params[9]),
        };
        state.conversions.set(params[2], row);
        return { rows: [], rowCount: 1 };
      }
      if (sql.includes("UPDATE affiliate_conversions")) {
        const row = state.conversions.get(params[1]);
        Object.assign(row, {
          sale_minor: String(params[2]),
          commission_minor: String(params[3]),
          status: params[4],
          assisted: params[5],
          assisted_helper_id: params[6],
          fraud_flags: JSON.parse(params[7]),
        });
        return { rows: [], rowCount: 1 };
      }
      throw new Error(`unexpected sql: ${sql.slice(0, 60)}`);
    });
  }
  async function postback(body) {
    const raw = Buffer.from(JSON.stringify(body));
    const stamp = String(Date.now());
    const signature = crypto
      .createHmac(
        "sha256",
        process.env.GROWTH_PARTNER_POSTBACK_ACME_SECRET,
      )
      .update(stamp)
      .update(".")
      .update(raw)
      .digest("hex");
    const res = await fetch(`${baseUrl}/acme/postback`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-growth-timestamp": stamp,
        "x-growth-signature": signature,
      },
      body: raw,
    });
    return res.status;
  }
  const order = (over = {}) => ({
    event_id: `e${Math.random().toString(36).slice(2, 10)}`,
    click_id: CLICK_ID,
    order_ref: "order-1",
    sale_minor: 10000,
    commission_minor: 1000,
    currency: "USD",
    status: "pending",
    ...over,
  });
  beforeAll(async () => {
    installFakeDb();
    const app = express();
    app.use((req, res, next) => {
      const chunks = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        req.growthRawBody = Buffer.concat(chunks);
        next();
      });
    });
    app.use("/partners", require("../routes/partners"));
    await new Promise((resolve) => {
      server = app.listen(0, "127.0.0.1", resolve);
    });
    baseUrl = `http://127.0.0.1:${server.address().port}/partners`;
  });
  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
  });
  beforeEach(() => {
    state = freshState();
  });
  const onlyConversion = () => [...state.conversions.values()][0];

  test("new conversion, late approval, replay dedupe", async () => {
    const first = order();
    expect(await postback(first)).toBe(204);
    expect(onlyConversion().status).toBe("pending");
    expect(await postback(order({ status: "approved", event_id: "e2" }))).toBe(204);
    expect(onlyConversion().status).toBe("approved");
    // A true replay repeats the original event_id: the receipt ledger
    // dedupes it and the stored conversion is left untouched.
    expect(await postback(first)).toBe(204);
    expect(onlyConversion().status).toBe("approved");
    expect(state.conversions.size).toBe(1);
    // A different event carrying a regressed status is not a replay; the
    // state machine rejects it.
    expect(await postback(order({ event_id: "e3" }))).toBe(400);
  });
  test("partial reversal shrinks amounts; paid can still be reversed", async () => {
    await postback(order({ status: "approved" }));
    expect(
      await postback(
        order({ status: "reversed", commission_minor: 400, event_id: "e2" }),
      ),
    ).toBe(204);
    expect(onlyConversion().status).toBe("reversed");
    expect(onlyConversion().commission_minor).toBe("400");
    expect(
      await postback(order({ status: "approved", event_id: "e3" })),
    ).toBe(400);
  });
  test("amount increases after approval are denied", async () => {
    await postback(order({ status: "approved" }));
    expect(
      await postback(
        order({ status: "paid", commission_minor: 2000, event_id: "e2" }),
      ),
    ).toBe(400);
    expect(onlyConversion().commission_minor).toBe("1000");
  });
  test("reversal of an unknown order is denied", async () => {
    expect(await postback(order({ status: "reversed" }))).toBe(400);
    expect(state.conversions.size).toBe(0);
  });
  test("helper-assisted sales are recorded assisted only", async () => {
    expect(
      await postback(order({ assisted: true, helper_id: HELPER_ID })),
    ).toBe(204);
    expect(onlyConversion().assisted).toBe(true);
    expect(onlyConversion().assisted_helper_id).toBe(HELPER_ID);
    expect(
      await postback(
        order({
          order_ref: "order-2",
          assisted: true,
          helper_id: "00000000-0000-4000-8000-0000000000ff",
          event_id: "e9",
        }),
      ),
    ).toBe(400);
  });
  test("implausible commission is held as flagged, never payable", async () => {
    expect(await postback(order({ commission_minor: 6000 }))).toBe(204);
    expect(onlyConversion().status).toBe("flagged");
    expect(
      await postback(order({ status: "approved", commission_minor: 6000, event_id: "e2" })),
    ).toBe(400);
    expect(
      await postback(order({ status: "reversed", commission_minor: 0, sale_minor: 0, event_id: "e3" })),
    ).toBe(204);
    expect(onlyConversion().status).toBe("reversed");
  });
});

describe("campaign editing and holdout lift", () => {
  const copy = Object.fromEntries(
    ["en", "es", "fr", "ht", "ar"].map((l) => [
      l,
      { title: "T", body: "B", button: "Go", push_title: "T", push_body: "B" },
    ]),
  );
  function fakeConn() {
    const calls = [];
    return {
      calls,
      query: jest.fn(async (sql, params) => {
        calls.push({ sql, params });
        return { rows: [], rowCount: 1 };
      }),
    };
  }
  const campaign = (over = {}) => ({
    id: 5,
    name: "C",
    offer_id: 1,
    segment_version_id: 2,
    channels: ["in_app"],
    copy,
    holdout_pct: 10,
    scheduled_at: null,
    status: "draft",
    approved_by: null,
    approved_at: null,
    ...over,
  });
  test("draft edits apply without touching approval", async () => {
    const conn = fakeConn();
    const result = await campaigns.editCampaign(
      conn,
      campaign(),
      { id: "u1" },
      { name: "New" },
    );
    expect(result).toEqual({ status: "draft", reapproval: false });
  });
  test("content change after approval forces re-approval", async () => {
    const conn = fakeConn();
    const approved = campaign({
      status: "approved",
      approved_by: "admin-1",
      approved_at: new Date(),
    });
    const result = await campaigns.editCampaign(
      conn,
      approved,
      { id: "u1" },
      { copy: { ...copy, en: { ...copy.en, title: "Changed" } } },
    );
    expect(result).toEqual({ status: "draft", reapproval: true });
    const update = conn.calls.find((c) => c.sql.includes("UPDATE offer_campaigns"));
    expect(update.params[9]).toBeNull();
  });
  test("schedule-only edit on a scheduled campaign keeps approval", async () => {
    const conn = fakeConn();
    const scheduled = campaign({
      status: "scheduled",
      approved_by: "admin-1",
      approved_at: new Date(),
      scheduled_at: new Date(Date.now() + 86400000),
    });
    const result = await campaigns.editCampaign(
      conn,
      scheduled,
      { id: "u1" },
      { scheduled_at: new Date(Date.now() + 2 * 86400000).toISOString() },
    );
    expect(result.reapproval).toBe(false);
    expect(result.status).toBe("scheduled");
  });
  test("queued campaigns cannot be edited; unknown fields are rejected", async () => {
    const conn = fakeConn();
    await expect(
      campaigns.editCampaign(conn, campaign({ status: "queued" }), { id: "u1" }, { name: "X" }),
    ).rejects.toThrow("invalid_campaign_transition");
    await expect(
      campaigns.editCampaign(conn, campaign(), { id: "u1" }, { sql: "x" }),
    ).rejects.toThrow("invalid_campaign_edit");
  });
  test("holdout lift uses the spec 12.3 control-group math", () => {
    const lift = campaigns.holdoutLift({
      treatedN: 1000,
      treatedC: 100,
      controlN: 200,
      controlC: 10,
    });
    expect(lift.label).toBe("measured");
    expect(lift.lift).toBeCloseTo(0.05, 5);
    expect(lift.low).toBeLessThan(lift.lift);
    expect(lift.high).toBeGreaterThan(lift.lift);
    expect(
      campaigns.holdoutLift({ treatedN: 100, treatedC: 5, controlN: 0, controlC: 0 }).label,
    ).toBe("no_holdout");
  });
});

describe("precise quiet hours (spec 16.2)", () => {
  test("held push lands at 08:00 recipient-local plus jitter, DST aware", () => {
    const winter = core.quietWindow(
      "America/New_York",
      new Date("2026-01-15T02:00:00Z"),
      15,
    );
    expect(winter.quiet).toBe(true);
    expect(winter.nextAttemptAt.toISOString()).toBe("2026-01-15T13:15:00.000Z");
    const summer = core.quietWindow(
      "America/New_York",
      new Date("2026-07-15T03:30:00Z"),
      0,
    );
    expect(summer.nextAttemptAt.toISOString()).toBe("2026-07-15T12:00:00.000Z");
  });
  test("unknown zone falls back to the 12:00-18:00 UTC window", () => {
    expect(core.quietWindow(null, new Date("2026-01-15T09:00:00Z"), 0).quiet).toBe(true);
    expect(
      core.quietWindow(null, new Date("2026-01-15T09:00:00Z"), 0).nextAttemptAt.toISOString(),
    ).toBe("2026-01-15T12:00:00.000Z");
    expect(core.quietWindow(null, new Date("2026-01-15T13:00:00Z"), 0).quiet).toBe(false);
  });
  test("timezone resolution follows profile, then country, then unknown", () => {
    expect(core.resolveTimezone({ timezone: "Asia/Tokyo", country: "US" })).toBe("Asia/Tokyo");
    expect(core.resolveTimezone({ country: "HT" })).toBe("America/Port-au-Prince");
    expect(core.resolveTimezone({ timezone: "Bogus/Zone", country: "FR" })).toBe("Europe/Paris");
    expect(core.resolveTimezone({})).toBeNull();
  });
});

describe("legacy marketing cap logging", () => {
  test("records the contact and never breaks the legacy send on failure", async () => {
    const runner = { query: jest.fn(async () => ({ rows: [] })) };
    await recordMarketingContact(runner, {
      userId: "u1",
      source: "discover_digest",
      channel: "email",
    });
    expect(runner.query).toHaveBeenCalledWith(
      expect.stringContaining("marketing_contact_log"),
      ["u1", "discover_digest", "email"],
    );
    const broken = {
      query: jest.fn(async () => {
        throw new Error("table missing");
      }),
    };
    await expect(
      recordMarketingContact(broken, {
        userId: "u1",
        source: "customer_reengagement",
        channel: "in_app",
      }),
    ).resolves.toBeUndefined();
  });
});
