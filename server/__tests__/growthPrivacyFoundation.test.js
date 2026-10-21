"use strict";
// Track 1 (privacy foundation) regression coverage for the Demand & Sales
// Engine: consent IP-HMAC evidence, explicit export/result caps, notice
// delivery behavior, financial-retention cleanup, and gate integration with
// synthetic subjects. All stores are mocked; no live Postgres/Redis/
// ClickHouse is required.
jest.mock("../db", () => ({ query: jest.fn(), connect: jest.fn() }));
jest.mock("../jobs/jobLockingService", () => ({
  withFencedJobLock: jest.fn(),
}));
jest.mock("../utils/email", () => ({
  sendEmailBatch: jest.fn(),
  sendOTPEmail: jest.fn(),
}));
jest.mock("../services/auditService", () => ({
  logAdminAction: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("@clickhouse/client", () => ({
  createClient: jest.fn(() => ({ query: jest.fn(), close: jest.fn() })),
}));
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const db = require("../db");
const identity = require("../growth/identity");
const PEPPER = "synthetic-growth-subject-pepper-test-only";
const userId = "00000000-0000-4000-8000-000000000001";
const savedEnv = {};
beforeEach(() => {
  jest.clearAllMocks();
  for (const name of [
    "GROWTH_SUBJECT_PEPPER",
    "GROWTH_TRACKING_HARD_OFF",
    "GROWTH_CLICKHOUSE_URL",
    "GROWTH_TRUST_CLOUDFLARE",
    "GROWTH_POLICY_NOTICE_DELIVERY_ENABLED",
  ]) {
    if (!(name in savedEnv)) savedEnv[name] = process.env[name];
    delete process.env[name];
  }
  process.env.GROWTH_SUBJECT_PEPPER = PEPPER;
  require("../services/auditService").logAdminAction.mockResolvedValue(
    undefined,
  );
});
afterAll(() => {
  for (const [name, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

// ---------------------------------------------------------------------------
// Item 1: consent ledger IP-HMAC evidence (spec 4.6)
// ---------------------------------------------------------------------------
describe("consent IP-HMAC evidence", () => {
  test("ipHash is an HMAC of the IP and never the raw address", () => {
    const expected = crypto
      .createHmac("sha256", PEPPER)
      .update("ip:203.0.113.7")
      .digest("hex");
    expect(identity.ipHash("203.0.113.7")).toBe(expected);
    expect(identity.ipHash("203.0.113.7")).toMatch(/^[a-f0-9]{64}$/);
    expect(identity.ipHash("203.0.113.7")).not.toContain("203.0.113.7");
    expect(identity.ipHash("198.51.100.9")).not.toBe(expected);
    expect(identity.ipHash("")).toBeNull();
    expect(identity.ipHash(undefined)).toBeNull();
    expect(identity.ipHash(null)).toBeNull();
  });

  test("consents.record stores ip_hash on the ledger insert", async () => {
    const calls = [];
    const conn = {
      query: jest.fn(async (sql, params) => {
        calls.push([sql, params]);
        if (sql.includes("INSERT INTO tracking_consents"))
          return { rows: [{ id: 42 }] };
        return { rows: [], rowCount: 1 };
      }),
    };
    await require("../growth/consents").record(conn, {
      userId,
      purpose: "activity",
      granted: true,
      source: "banner",
      jurisdiction: "FR",
      version: "growth-v1",
      ip: "203.0.113.7",
    });
    const insert = calls.find(([sql]) =>
      sql.includes("INSERT INTO tracking_consents"),
    );
    expect(insert[0]).toContain("ip_hash");
    expect(insert[1][6]).toBe(identity.ipHash("203.0.113.7"));
    expect(insert[1]).not.toContain("203.0.113.7");
  });

  test("consents.record stores NULL ip_hash when no request IP exists", async () => {
    const calls = [];
    const conn = {
      query: jest.fn(async (sql, params) => {
        calls.push([sql, params]);
        if (sql.includes("INSERT INTO tracking_consents"))
          return { rows: [{ id: 43 }] };
        return { rows: [], rowCount: 1 };
      }),
    };
    await require("../growth/consents").record(conn, {
      userId,
      purpose: "activity_offers",
      granted: true,
      source: "settings",
      jurisdiction: "FR",
      version: "growth-v1",
    });
    const insert = calls.find(([sql]) =>
      sql.includes("INSERT INTO tracking_consents"),
    );
    expect(insert[1][6]).toBeNull();
  });

  test("migration 936 adds ip_hash and applied migration 916 is untouched", () => {
    const dir = path.join(__dirname, "../migrations");
    const m936 = fs.readFileSync(
      path.join(dir, "936_tracking_consent_ip_hash.sql"),
      "utf8",
    );
    expect(m936).toContain("ALTER TABLE tracking_consents");
    expect(m936).toContain("ADD COLUMN ip_hash CHAR(64)");
    const m916 = fs.readFileSync(
      path.join(dir, "916_tracking_consents_and_jurisdictions.sql"),
      "utf8",
    );
    expect(m916).not.toContain("ip_hash");
  });

  test("forward privacy migrations align jurisdiction and retention policy", () => {
    const dir = path.join(__dirname, "../migrations");
    const m956 = fs.readFileSync(
      path.join(dir, "956_growth_jurisdiction_optout_rules.sql"),
      "utf8",
    );
    expect(m956).toContain("WHERE code='US'");
    expect(m956).toContain("('US-CO'");
    expect(m956).toContain("WHERE code IN ('CA','CA-QC','CH')");
    const c005 = fs.readFileSync(
      path.join(__dirname, "../migrations-clickhouse/C005_activity_events_retention.sql"),
      "utf8",
    );
    expect(c005).toContain("MODIFY TTL day + INTERVAL 90 DAY DELETE");
    const m957 = fs.readFileSync(
      path.join(dir, "957_growth_campaign_personalization.sql"),
      "utf8",
    );
    expect(m957).toContain("is_personalized BOOLEAN NOT NULL DEFAULT TRUE");
    expect(fs.readFileSync(path.join(__dirname, "../growth/policyCopy.json"), "utf8"))
      .not.toContain("30 days under consent");
  });
});

// ---------------------------------------------------------------------------
// Item 2: export and ClickHouse result caps fail explicitly
// ---------------------------------------------------------------------------
describe("explicit result caps", () => {
  test("ClickHouse clients are configured to throw on result overflow", () => {
    process.env.GROWTH_CLICKHOUSE_URL = "https://store.example.test";
    process.env.GROWTH_CLICKHOUSE_RIGHTS_USER = "rights-test";
    process.env.GROWTH_CLICKHOUSE_RIGHTS_PASSWORD = "synthetic";
    const { createClient } = require("@clickhouse/client");
    require("../growth/clickhouse").getClient("rights");
    expect(createClient).toHaveBeenCalledWith(
      expect.objectContaining({
        clickhouse_settings: expect.objectContaining({
          max_result_rows: "1000000",
          result_overflow_mode: "throw",
        }),
      }),
    );
    delete process.env.GROWTH_CLICKHOUSE_RIGHTS_USER;
    delete process.env.GROWTH_CLICKHOUSE_RIGHTS_PASSWORD;
  });

  function exportConn(clickhouseRows) {
    const clickhouse = require("../growth/clickhouse");
    jest.spyOn(clickhouse, "getClient").mockReturnValue({
      query: jest.fn(async () => ({
        json: async () => clickhouseRows,
      })),
    });
    return {
      query: jest.fn(async (sql) => {
        if (sql.includes("growth_device_links")) return { rows: [] };
        return { rows: [] };
      }),
    };
  }

  test("growth export throws instead of truncating activity events over the cap", async () => {
    process.env.GROWTH_CLICKHOUSE_URL = "https://store.example.test";
    const { ACTIVITY_EXPORT_ROW_CAP } = require("../growth/rights");
    const conn = exportConn(
      Array.from({ length: ACTIVITY_EXPORT_ROW_CAP + 1 }, () => ({
        event_name: "page.view",
      })),
    );
    await expect(
      require("../growth/rights").exportData(conn, userId),
    ).rejects.toMatchObject({
      message: "growth_export_result_limit_exceeded",
      code: "EXPORT_RESULT_LIMIT_EXCEEDED",
    });
    const clickhouse = require("../growth/clickhouse");
    const queryArg = clickhouse.getClient.mock.results.at(-1).value.query.mock
      .calls[0][0];
    expect(queryArg.query).toContain(
      `LIMIT ${ACTIVITY_EXPORT_ROW_CAP + 1}`,
    );
    clickhouse.getClient.mockRestore();
  });

  test("growth export returns activity events at or under the cap", async () => {
    process.env.GROWTH_CLICKHOUSE_URL = "https://store.example.test";
    const conn = exportConn([
      { event_name: "page.view" },
      { event_name: "job.view" },
    ]);
    const result = await require("../growth/rights").exportData(conn, userId);
    expect(result.activity_events).toHaveLength(2);
    require("../growth/clickhouse").getClient.mockRestore();
  });

  test("activity export omits raw props and internal entity identifiers", async () => {
    process.env.GROWTH_CLICKHOUSE_URL = "https://store.example.test";
    const clickhouse = require("../growth/clickhouse");
    jest.spyOn(clickhouse, "getClient").mockReturnValue({
      query: jest.fn(async () => ({
        json: async () => [{ event_name: "job.view", route: "/jobs" }],
      })),
    });
    const conn = {
      query: jest.fn(async (sql) =>
        sql.includes("growth_device_links") ? { rows: [] } : { rows: [] }),
    };
    const result = await require("../growth/rights").exportData(conn, userId);
    expect(result.activity_events[0]).toEqual({ event_name: "job.view", route: "/jobs" });
    const queryArg = clickhouse.getClient.mock.results.at(-1).value.query.mock.calls[0][0];
    expect(queryArg.query).not.toContain("props");
    clickhouse.getClient.mockRestore();
  });

  test("privacy activity export throws instead of truncating a section", async () => {
    const { EXPORT_ROW_CAP } = require("../services/privacyActivityData");
    const conn = {
      query: jest.fn(async (sql) => {
        if (sql.includes("FROM site_visits"))
          return {
            rows: Array.from({ length: EXPORT_ROW_CAP + 1 }, () => ({})),
          };
        return { rows: [] };
      }),
    };
    await expect(
      require("../services/privacyActivityData").exportData(conn, userId),
    ).rejects.toMatchObject({
      message: "privacy_export_result_limit_exceeded",
      code: "EXPORT_RESULT_LIMIT_EXCEEDED",
      section: "site_visits",
    });
  });

  test("privacy activity export caps every section query at cap+1", async () => {
    const { EXPORT_ROW_CAP } = require("../services/privacyActivityData");
    const sqls = [];
    const conn = {
      query: jest.fn(async (sql) => {
        sqls.push(sql);
        return { rows: [] };
      }),
    };
    const result = await require("../services/privacyActivityData").exportData(
      conn,
      userId,
    );
    expect(result).toEqual({
      site_visits: [],
      discover_search_log: [],
      promotion_link_events: [],
    });
    expect(sqls).toHaveLength(3);
    for (const sql of sqls)
      expect(sql).toContain(`LIMIT ${EXPORT_ROW_CAP + 1}`);
  });
});

// ---------------------------------------------------------------------------
// Item 4: account deletion respects financial retention
// ---------------------------------------------------------------------------
describe("deletion cleanup retains financial and suppression records", () => {
  test("privacyActivityData.erase removes activity stores only", async () => {
    const sqls = [];
    const conn = {
      query: jest.fn(async (sql) => {
        sqls.push(sql);
        return { rows: [], rowCount: sqls.length };
      }),
    };
    const summary = await require("../services/privacyActivityData").erase(
      conn,
      userId,
    );
    expect(summary).toEqual({
      site_visits: 1,
      discover_search_log: 2,
      promotion_link_events: 3,
    });
    const joined = sqls.join("\n");
    expect(joined).toContain("DELETE FROM site_visits");
    expect(joined).toContain("DELETE FROM discover_search_log");
    expect(joined).toContain("DELETE FROM promotion_link_events");
    expect(joined).not.toContain("affiliate_conversions");
    expect(joined).not.toContain("marketing_suppressions");
    expect(joined).not.toContain("DELETE FROM payments");
  });

  test("growth rights.erase removes profiles but keeps consent evidence, conversions and suppressions", async () => {
    const sqls = [];
    const conn = {
      query: jest.fn(async (sql) => {
        sqls.push(sql);
        return { rows: [], rowCount: 1 };
      }),
    };
    await require("../growth/rights").erase(conn, userId, "account_erasure");
    const joined = sqls.join("\n");
    expect(joined).toContain("INSERT INTO growth_erasure_queue");
    expect(joined).toContain("DELETE FROM user_interest_profiles");
    expect(joined).toContain("DELETE FROM propensity_scores");
    expect(joined).toContain("DELETE FROM growth_intent_dismissals");
    expect(joined).toContain("DELETE FROM activity_outbox");
    // Financial conversions are a retained financial record; suppression
    // records keep an unsubscribe effective; the append-only consent ledger
    // survives profile/raw erasure while the current pointer is removed with
    // the deleted account.
    expect(joined).not.toContain("affiliate_conversions");
    expect(joined).not.toContain("marketing_suppressions");
    expect(joined).not.toContain("DELETE FROM tracking_consents");
    expect(joined).toContain("DELETE FROM tracking_consent_current");
    expect(joined).toContain("DELETE FROM offer_campaign_recipients");
  });

  test("privacyRetentionService.eraseUser never deletes conversions, suppressions or payments", async () => {
    const sqls = [];
    const client = {
      query: jest.fn(async (sql) => {
        sqls.push(sql);
        if (sql.includes("SELECT profile_photo_url"))
          return { rows: [{ profile_photo_url: null }], rowCount: 1 };
        return { rows: [], rowCount: 1 };
      }),
    };
    const summary = await require("../services/privacyRetentionService").eraseUser(
      client,
      userId,
    );
    expect(summary.users).toBe(1);
    expect(summary.site_visits).toBe(1);
    const joined = sqls.join("\n");
    expect(joined).not.toContain("affiliate_conversions");
    expect(joined).not.toContain("marketing_suppressions");
    expect(joined).not.toMatch(/DELETE FROM payments/);
    expect(joined).not.toMatch(/DELETE FROM oxsteed_credit/);
    expect(summary.growth).toBeDefined();
  });

  test("consent withdrawal preserves the current denial pointer", async () => {
    const sqls = [];
    const client = {
      query: jest.fn(async (sql) => {
        sqls.push(sql);
        return { rows: [], rowCount: 0 };
      }),
    };
    await require("../growth/rights").erase(client, userId, "withdraw_activity");
    expect(sqls.join("\n")).not.toContain("DELETE FROM tracking_consent_current");
  });
});

// ---------------------------------------------------------------------------
// Item 3: policy notice delivery behavior (mocked Resend + stateful fake DB)
// ---------------------------------------------------------------------------
const { withFencedJobLock } = require("../jobs/jobLockingService");
const { sendEmailBatch } = require("../utils/email");
const { logAdminAction } = require("../services/auditService");
const policyNotice = require("../growth/policyNotice");
const noticeDelivery = require("../jobs/policyNoticeDelivery");
const ADMIN_ID = "00000000-0000-4000-8000-000000000099";

function createNoticeStore({ campaign, rollout, users, deliveries }) {
  const store = {
    now: Date.parse("2026-11-02T10:00:00Z"),
    campaign,
    rollout,
    users: new Map(users.map((u) => [u.id, u])),
    deliveries,
    batches: [],
    budget: new Map(),
    batchInserts: 0,
  };
  const today = () => new Date(store.now).toISOString().slice(0, 10);
  const eligible = (d) => {
    const u = store.users.get(d.user_id);
    return u && !u.deleted_at && !u.is_banned;
  };
  store.conn = {
    query: jest.fn(async (sql, params = []) => {
      if (/FROM policy_notice_campaigns WHERE status='sending'/.test(sql))
        return {
          rows:
            store.campaign.status === "sending" ? [store.campaign] : [],
        };
      if (
        /UPDATE policy_notice_deliveries SET status='failed' WHERE campaign_id=\$1\s+AND status='pending' AND batch_id IS NULL/.test(
          sql,
        )
      ) {
        let rowCount = 0;
        for (const d of store.deliveries)
          if (
            d.campaign_id === params[0] &&
            d.status === "pending" &&
            !d.batch_id &&
            store.now > Date.parse(params[1]) + 24 * 3600000
          ) {
            d.status = "failed";
            rowCount++;
          }
        return { rows: [], rowCount };
      }
      if (/UPDATE policy_notice_batches SET status='failed'/.test(sql)) {
        const failedRows = [];
        for (const b of store.batches)
          if (
            b.campaign_id === params[0] &&
            ["pending", "sending"].includes(b.status) &&
            b.created_at < store.now - 23 * 3600000
          ) {
            b.status = "failed";
            b.lease_token = null;
            b.payload = [];
            failedRows.push({ delivery_ids: b.delivery_ids });
          }
        return { rows: failedRows, rowCount: failedRows.length };
      }
      if (
        /UPDATE policy_notice_deliveries SET status='failed' WHERE id=ANY/.test(
          sql,
        )
      ) {
        let rowCount = 0;
        for (const d of store.deliveries)
          if (params[0].includes(d.id) && d.status !== "sent") {
            d.status = "failed";
            rowCount++;
          }
        return { rows: [], rowCount };
      }
      if (/SELECT \* FROM policy_notice_batches WHERE campaign_id/.test(sql)) {
        const claimable = store.batches
          .filter(
            (b) =>
              b.campaign_id === params[0] &&
              ((b.status === "pending" && b.next_attempt_at <= store.now) ||
                (b.status === "sending" && b.lease_expires_at < store.now)),
          )
          .sort((a, b) => a.created_at - b.created_at);
        return { rows: claimable.slice(0, 1) };
      }
      if (/FROM policy_notice_daily_budget WHERE day=CURRENT_DATE/.test(sql))
        return { rows: [{ n: store.budget.get(today()) || 0 }] };
      if (/SELECT d\.id,d\.language,u\.email/.test(sql)) {
        const rows = store.deliveries
          .filter(
            (d) =>
              d.campaign_id === params[0] &&
              d.status === "pending" &&
              !d.batch_id &&
              eligible(d),
          )
          .sort((a, b) => a.id - b.id)
          .slice(0, params[1])
          .map((d) => ({
            id: d.id,
            language: d.language,
            email: store.users.get(d.user_id).email,
          }));
        return { rows };
      }
      if (/INSERT INTO policy_notice_batches/.test(sql)) {
        const batch = {
          id: crypto.randomUUID(),
          campaign_id: params[0],
          delivery_ids: params[1],
          payload: JSON.parse(params[2]),
          status: "pending",
          attempts: 0,
          lease_token: null,
          lease_expires_at: null,
          created_at: store.now,
          next_attempt_at: store.now,
          sent_at: null,
        };
        store.batches.push(batch);
        store.batchInserts++;
        return { rows: [batch], rowCount: 1 };
      }
      if (/SET batch_id=\$2,status='sending'/.test(sql)) {
        let rowCount = 0;
        for (const d of store.deliveries)
          if (params[0].includes(d.id)) {
            d.batch_id = params[1];
            d.status = "sending";
            rowCount++;
          }
        return { rows: [], rowCount };
      }
      if (
        /UPDATE policy_notice_deliveries d SET status='suppressed'/.test(sql)
      ) {
        let rowCount = 0;
        for (const d of store.deliveries)
          if (
            d.campaign_id === params[0] &&
            d.status === "pending" &&
            !d.batch_id &&
            !eligible(d)
          ) {
            d.status = "suppressed";
            rowCount++;
          }
        return { rows: [], rowCount };
      }
      if (/INSERT INTO policy_notice_daily_budget/.test(sql)) {
        const current = store.budget.get(today()) || 0;
        if (current + params[0] <= params[1]) {
          store.budget.set(today(), current + params[0]);
          return { rows: [{ day: today() }], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      }
      if (
        /UPDATE policy_notice_batches SET status='sending',attempts=attempts\+1/.test(
          sql,
        )
      ) {
        const batch = store.batches.find((b) => b.id === params[0]);
        batch.status = "sending";
        batch.attempts++;
        batch.lease_token = params[1];
        batch.lease_expires_at = store.now + 5 * 60000;
        return { rows: [batch], rowCount: 1 };
      }
      if (
        /UPDATE policy_notice_batches SET status='pending',lease_token=NULL,next_attempt_at/.test(
          sql,
        )
      ) {
        const batch = store.batches.find((b) => b.id === params[0]);
        if (batch && batch.lease_token === params[1]) {
          batch.status = "pending";
          batch.lease_token = null;
          batch.next_attempt_at = store.now + 5 * 60000;
          return { rows: [], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      }
      if (/UPDATE policy_notice_batches SET status='sent'/.test(sql)) {
        const batch = store.batches.find((b) => b.id === params[0]);
        if (
          batch &&
          batch.lease_token === params[1] &&
          batch.lease_expires_at > store.now
        ) {
          batch.status = "sent";
          batch.sent_at = store.now;
          batch.lease_token = null;
          batch.payload = [];
          return { rows: [], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      }
      if (/UPDATE policy_notice_deliveries SET status='sent'/.test(sql)) {
        const d = store.deliveries.find((x) => x.id === params[0]);
        if (d) {
          d.status = "sent";
          d.sent_at = new Date(store.now).toISOString();
          d.provider_message_id = params[1];
        }
        return { rows: [], rowCount: d ? 1 : 0 };
      }
      if (/SET state='notice_sending',first_notice_sent_at/.test(sql)) {
        if (store.rollout.state === "notice_sending") {
          store.rollout.first_notice_sent_at ||=
            new Date(store.now).toISOString();
          store.rollout.last_notice_sent_at = new Date(
            store.now,
          ).toISOString();
        }
        return { rows: [], rowCount: 1 };
      }
      if (/SELECT \* FROM activity_tracking_rollout WHERE id=1/.test(sql))
        return { rows: [store.rollout] };
      if (/SELECT created_by FROM policy_notice_campaigns/.test(sql))
        return {
          rows:
            store.campaign.policy_version === params[0]
              ? [{ created_by: store.campaign.created_by }]
              : [],
        };
      if (/COUNT\(\*\) FILTER/.test(sql)) {
        const mine = store.deliveries.filter(
          (d) => d.campaign_id === store.campaign.id,
        );
        const remaining = mine.filter((d) =>
          ["pending", "sending"].includes(d.status),
        ).length;
        const sent = mine
          .map((d) => d.sent_at)
          .filter(Boolean)
          .sort();
        return {
          rows: [
            { remaining, last_sent: sent.length ? sent.at(-1) : null },
          ],
        };
      }
      if (/UPDATE policy_notice_campaigns SET status='paused'/.test(sql)) {
        store.campaign.status = "paused";
        return { rows: [], rowCount: 1 };
      }
      if (/SET state='paused'/.test(sql)) {
        store.rollout.state = "paused";
        return { rows: [], rowCount: 1 };
      }
      if (/SET state='notice_complete'/.test(sql)) {
        store.rollout.state = "notice_complete";
        store.rollout.last_notice_sent_at = params[0];
        store.rollout.effective_at =
          params[1] instanceof Date
            ? params[1].toISOString()
            : params[1];
        return { rows: [], rowCount: 1 };
      }
      if (/UPDATE policy_notice_campaigns SET status='complete'/.test(sql)) {
        store.campaign.status = "complete";
        return { rows: [], rowCount: 1 };
      }
      if (/SET state='effective'/.test(sql)) {
        const r = store.rollout;
        if (
          r.state === "notice_complete" &&
          Date.parse(r.effective_at) <= store.now &&
          r.legal_review_ref &&
          r.translations_reviewed &&
          r.rights_verified
        ) {
          r.state = "effective";
          return { rows: [{ policy_version: r.policy_version }], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      }
      throw new Error(`unhandled notice-store query: ${sql}`);
    }),
  };
  return store;
}

function noticeFixtures({ dailyCap = 100 } = {}) {
  const planned = new Date(
    Date.parse("2026-11-02T10:00:00Z") + 2 * 86400000,
  ).toISOString();
  const campaign = {
    id: 1,
    policy_version: "growth-v1",
    status: "sending",
    planned_last_send_at: planned,
    daily_cap: dailyCap,
    created_by: ADMIN_ID,
    content_digest: policyNotice.contentDigest(),
  };
  const rollout = {
    id: 1,
    policy_version: "growth-v1",
    state: "notice_sending",
    planned_effective_at: new Date(
      Date.parse(planned) + 14 * 86400000,
    ).toISOString(),
    effective_at: null,
    first_notice_sent_at: null,
    last_notice_sent_at: null,
    legal_review_ref: "legal-1",
    translations_reviewed: true,
    rights_verified: true,
  };
  const users = [1, 2, 3, 4, 5].map((i) => ({
    id: `user-${i}`,
    email: `user${i}@example.test`,
    deleted_at: null,
    is_banned: false,
  }));
  const deliveries = [1, 2, 3, 4, 5].map((i) => ({
    id: i,
    campaign_id: 1,
    user_id: `user-${i}`,
    language: "en",
    status: "pending",
    batch_id: null,
    sent_at: null,
    provider_message_id: null,
  }));
  return { campaign, rollout, users, deliveries };
}

function installNoticeStore(store) {
  const fence = {
    fencedTransaction: async (work) => work(store.conn),
    db: store.conn,
  };
  withFencedJobLock.mockImplementation(async (name, handler) =>
    handler(fence),
  );
  process.env.GROWTH_POLICY_NOTICE_DELIVERY_ENABLED = "true";
  sendEmailBatch.mockImplementation(async (payload) =>
    payload.map((message, i) => ({ id: `provider-${i}` })),
  );
  return store;
}

describe("policy notice delivery", () => {
  test("delivery job stays off without its explicit switch", async () => {
    delete process.env.GROWTH_POLICY_NOTICE_DELIVERY_ENABLED;
    await expect(noticeDelivery.run()).resolves.toEqual({ skipped: true });
    expect(withFencedJobLock).not.toHaveBeenCalled();
  });

  test("suppressed recipients are never sent; ineligible pendings become suppressed; campaign completes", async () => {
    const fx = noticeFixtures();
    fx.users[3].is_banned = true; // user-4 can no longer receive mail
    fx.deliveries[4].status = "suppressed"; // hard bounce recorded at scheduling
    const store = installNoticeStore(createNoticeStore(fx));

    await expect(noticeDelivery.run()).resolves.toEqual({ processed: 3 });
    expect(sendEmailBatch).toHaveBeenCalledTimes(1);
    const payload = sendEmailBatch.mock.calls[0][0];
    expect(payload.map((m) => m.to[0]).sort()).toEqual([
      "user1@example.test",
      "user2@example.test",
      "user3@example.test",
    ]);
    expect(store.deliveries[4].status).toBe("suppressed");

    await expect(noticeDelivery.run()).resolves.toEqual({ processed: 0 });
    expect(sendEmailBatch).toHaveBeenCalledTimes(1);
    expect(store.deliveries[3].status).toBe("suppressed");
    expect(store.campaign.status).toBe("complete");
    expect(store.rollout.state).toBe("notice_complete");
    // effective date is never earlier than the date quoted in the notices
    expect(store.rollout.effective_at).toBe(
      store.rollout.planned_effective_at,
    );
  });

  test("no accepted sends pauses the campaign and rollout with an audit entry", async () => {
    const fx = noticeFixtures();
    for (const d of fx.deliveries) d.status = "suppressed";
    const store = installNoticeStore(createNoticeStore(fx));
    await expect(noticeDelivery.run()).resolves.toEqual({ processed: 0 });
    expect(sendEmailBatch).not.toHaveBeenCalled();
    expect(store.campaign.status).toBe("paused");
    expect(store.rollout.state).toBe("paused");
    expect(logAdminAction).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "growth_notice_no_accepted_delivery",
      }),
    );
  });

  test("daily quota blocks same-day sends and resets after midnight", async () => {
    const fx = noticeFixtures({ dailyCap: 2 });
    fx.deliveries = fx.deliveries.slice(0, 4);
    const store = installNoticeStore(createNoticeStore(fx));
    await expect(noticeDelivery.run()).resolves.toEqual({ processed: 2 });
    await expect(noticeDelivery.run()).resolves.toEqual({ processed: 0 });
    expect(sendEmailBatch).toHaveBeenCalledTimes(1);
    store.now = Date.parse("2026-11-03T09:00:00Z");
    await expect(noticeDelivery.run()).resolves.toEqual({ processed: 2 });
    expect(sendEmailBatch).toHaveBeenCalledTimes(2);
    expect(sendEmailBatch.mock.calls.map(([p]) => p.length)).toEqual([2, 2]);
  });

  test("a failed attempt consumes quota, retries next day with the identical frozen payload", async () => {
    const fx = noticeFixtures({ dailyCap: 2 });
    fx.deliveries = fx.deliveries.slice(0, 2);
    const store = installNoticeStore(createNoticeStore(fx));
    sendEmailBatch.mockRejectedValueOnce(new Error("provider timeout"));
    await expect(noticeDelivery.run()).resolves.toEqual({ retrying: true });
    const firstPayload = sendEmailBatch.mock.calls[0][0];
    // The ambiguous attempt reserved the whole day's quota.
    store.now += 6 * 60000;
    await expect(noticeDelivery.run()).resolves.toEqual({ processed: 0 });
    expect(sendEmailBatch).toHaveBeenCalledTimes(1);
    store.now = Date.parse("2026-11-03T09:00:00Z");
    await expect(noticeDelivery.run()).resolves.toEqual({ processed: 2 });
    expect(sendEmailBatch).toHaveBeenCalledTimes(2);
    // Payload was frozen at batch creation: the retry sends byte-identical
    // content and no second batch was ever created.
    expect(sendEmailBatch.mock.calls[1][0]).toEqual(firstPayload);
    expect(store.batchInserts).toBe(1);
    expect(store.batches[0].attempts).toBe(2);
    expect(store.batches[0].status).toBe("sent");
    expect(store.batches[0].payload).toEqual([]);
  });

  test("content changed after review freezes the plan before any send", async () => {
    const fx = noticeFixtures();
    fx.campaign.content_digest = "tampered-digest";
    installNoticeStore(createNoticeStore(fx));
    await expect(noticeDelivery.run()).rejects.toThrow(
      "policy_content_changed_after_review",
    );
    expect(sendEmailBatch).not.toHaveBeenCalled();
  });

  test("a stale batch past the provider idempotency window fails its deliveries", async () => {
    const fx = noticeFixtures();
    fx.deliveries = [
      {
        id: 9,
        campaign_id: 1,
        user_id: "user-1",
        language: "en",
        status: "sending",
        batch_id: "stale-batch",
        sent_at: null,
        provider_message_id: null,
      },
    ];
    const store = installNoticeStore(createNoticeStore(fx));
    store.batches.push({
      id: "stale-batch",
      campaign_id: 1,
      delivery_ids: [9],
      payload: [{ to: ["user1@example.test"] }],
      status: "sending",
      attempts: 1,
      lease_token: "old-token",
      lease_expires_at: store.now - 3600000,
      created_at: store.now - 24 * 3600000,
      next_attempt_at: store.now - 3600000,
      sent_at: null,
    });
    await expect(noticeDelivery.run()).resolves.toEqual({ processed: 0 });
    expect(store.batches[0].status).toBe("failed");
    expect(store.deliveries[0].status).toBe("failed");
    expect(sendEmailBatch).not.toHaveBeenCalled();
    expect(logAdminAction).toHaveBeenCalledWith(
      expect.objectContaining({ action: "growth_notice_batches_failed" }),
    );
  });
});

describe("policy notice scheduling and provider webhooks", () => {
  test("schedule marks hard-bounce and complaint addresses suppressed at creation", async () => {
    const sqls = [];
    const conn = {
      query: jest.fn(async (sql) => {
        sqls.push(sql);
        if (sql.includes("FROM activity_tracking_rollout"))
          return {
            rows: [{ state: "draft", policy_version: "growth-v1" }],
          };
        if (sql.includes("COUNT(*)"))
          return { rows: [{ n: 3 }] };
        if (sql.includes("INSERT INTO policy_notice_campaigns"))
          return {
            rows: [{ id: 5, policy_version: "growth-v1", status: "scheduled" }],
          };
        return { rows: [] };
      }),
    };
    const campaign = await policyNotice.schedule(conn, {
      user: { id: ADMIN_ID },
      plannedLastSendAt: new Date(Date.now() + 86400000).toISOString(),
      legalReviewRef: "legal-review-1",
      translationReviewRef: "translation-review-1",
      rightsReviewRef: "rights-review-1",
    });
    expect(campaign.id).toBe(5);
    const insert = sqls.find((s) =>
      s.includes("INSERT INTO policy_notice_deliveries"),
    );
    expect(insert).toContain("business_broadcast_suppressions");
    expect(insert).toContain("('hard_bounce','complaint')");
    expect(insert).toContain("'suppressed'");
  });

  test("schedule refuses to run without all three review references", async () => {
    const conn = { query: jest.fn() };
    await expect(
      policyNotice.schedule(conn, {
        user: { id: ADMIN_ID },
        plannedLastSendAt: new Date(Date.now() + 86400000).toISOString(),
      }),
    ).rejects.toThrow("growth_launch_review_required");
    expect(conn.query).not.toHaveBeenCalled();
  });

  test("provider events are first-write-wins so late duplicates cannot move timestamps", async () => {
    const calls = [];
    const conn = {
      query: jest.fn(async (sql, params) => {
        calls.push([sql, params]);
        return { rows: [{ id: 7 }] };
      }),
    };
    const applied = await policyNotice.applyProviderEvent(conn, {
      type: "email.delivered",
      data: { email_id: "provider-1" },
    });
    expect(applied).toEqual({ outcome: "applied", deliveryId: 7 });
    // COALESCE keeps the earliest delivered_at even when Stripe/Resend
    // redelivers the same event after the row already has a timestamp.
    expect(calls[0][0]).toContain("delivered_at=COALESCE(delivered_at,NOW())");
    expect(calls[0][1]).toEqual(["provider-1"]);
    await policyNotice.applyProviderEvent(conn, {
      type: "email.bounced",
      data: { id: "provider-2" },
    });
    expect(calls[1][0]).toContain("bounced_at=COALESCE(bounced_at,NOW())");
    await policyNotice.applyProviderEvent(conn, {
      type: "email.complained",
      data: { email_id: "provider-3" },
    });
    expect(calls[2][0]).toContain(
      "complained_at=COALESCE(complained_at,NOW())",
    );
  });

  test("provider events for unknown messages and non-terminal types are ignored", async () => {
    const conn = {
      query: jest.fn(async () => ({ rows: [] })),
    };
    await expect(
      policyNotice.applyProviderEvent(conn, {
        type: "email.delivered",
        data: { email_id: "missing" },
      }),
    ).resolves.toBeNull();
    await expect(
      policyNotice.applyProviderEvent(conn, {
        type: "email.opened",
        data: { email_id: "provider-1" },
      }),
    ).resolves.toBeNull();
    expect(conn.query).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Item 6: gate integration with synthetic subjects and mocked stores
// ---------------------------------------------------------------------------
describe("gate integration across jurisdictions", () => {
  const gate = require("../growth/gate");
  beforeEach(() => {
    // The gate fails closed unless the hard-off guard is explicitly "false".
    process.env.GROWTH_TRACKING_HARD_OFF = "false";
  });
  const RULES = [
    { code: "unknown", activity_basis: "consent", offers_basis: "consent", sale_share_control: true, reviewed_at: "2026-10-20" },
    { code: "default", activity_basis: "notice", offers_basis: "notice", sale_share_control: false, reviewed_at: "2026-10-20" },
    { code: "US", activity_basis: "notice", offers_basis: "notice", sale_share_control: true, reviewed_at: "2026-10-20" },
    { code: "US-CA", activity_basis: "notice", offers_basis: "notice", sale_share_control: true, reviewed_at: "2026-10-20" },
    { code: "FR", activity_basis: "consent", offers_basis: "consent", sale_share_control: false, reviewed_at: "2026-10-20" },
  ];
  const ROLLOUT = {
    id: 1,
    policy_version: "growth-v1",
    state: "effective",
    effective_at: new Date(Date.now() - 86400000).toISOString(),
    legal_review_ref: "legal-1",
    translations_reviewed: true,
    rights_verified: true,
  };
  const mkUser = (over = {}) => ({
    id: userId,
    role: "customer",
    is_active: true,
    is_banned: false,
    deleted_at: null,
    is_suspended: false,
    country: "US",
    country_confirmed: true,
    city: null,
    state: "NY",
    zip_code: null,
    preferred_language: "en",
    created_at: "2026-01-01",
    adult_confirmed: true,
    is_internal: false,
    ...over,
  });
  function installGateDb({ users, consents = {} }) {
    db.query.mockImplementation(async (sql, params = []) => {
      if (sql.includes("FROM platform_settings WHERE key IN"))
        return {
          rows: [
            { key: "growth.activity_tracking_enabled", value: "true" },
          ],
        };
      if (sql.includes("FROM activity_tracking_rollout"))
        return { rows: [ROLLOUT] };
      if (sql.includes("key='growth.jurisdiction_rules'"))
        return { rows: [] };
      if (sql.includes("FROM jurisdiction_rules")) return { rows: RULES };
      if (sql.includes("FROM users u LEFT JOIN"))
        return { rows: users.filter((u) => params[0].includes(u.id)) };
      if (sql.includes("FROM tracking_consent_current")) {
        const rows = [];
        for (const [uid, list] of Object.entries(consents)) {
          const subjectKey = identity.key("subject", uid);
          if (!params[0].includes(subjectKey)) continue;
          for (const c of list)
            rows.push({
              subject_key: subjectKey,
              purpose: c.purpose,
              granted: c.granted,
              consent_text_version: c.version || "growth-v1",
            });
        }
        return { rows };
      }
      throw new Error(`unhandled gate query: ${sql}`);
    });
  }

  test("notice jurisdiction: confirmed US subject is allowed without a consent record", async () => {
    installGateDb({ users: [mkUser()] });
    await expect(gate.allow({ userId })).resolves.toMatchObject({
      allowed: true,
      basis: "notice",
    });
    await expect(
      gate.allow({ userId }, "activity_offers"),
    ).resolves.toMatchObject({ allowed: true });
    await expect(
      gate.allow({ userId }, "partner_offers"),
    ).resolves.toMatchObject({ allowed: true });
  });

  test("consent jurisdiction: FR subject needs current grants for activity and offers independently", async () => {
    installGateDb({ users: [mkUser({ country: "FR", state: null })] });
    await expect(gate.allow({ userId })).resolves.toMatchObject({
      allowed: false,
      reason: "activity_consent_required",
    });
    installGateDb({
      users: [mkUser({ country: "FR", state: null })],
      consents: { [userId]: [{ purpose: "activity", granted: true }] },
    });
    await expect(gate.allow({ userId })).resolves.toMatchObject({
      allowed: true,
      basis: "consent",
    });
    await expect(
      gate.allow({ userId }, "activity_offers"),
    ).resolves.toMatchObject({
      allowed: false,
      reason: "offers_consent_required",
    });
    installGateDb({
      users: [mkUser({ country: "FR", state: null })],
      consents: {
        [userId]: [
          { purpose: "activity", granted: true },
          { purpose: "activity_offers", granted: true },
        ],
      },
    });
    await expect(
      gate.allow({ userId }, "activity_offers"),
    ).resolves.toMatchObject({ allowed: true });
  });

  test("unknown jurisdiction fails closed as consent basis", async () => {
    installGateDb({
      users: [mkUser({ country: null, country_confirmed: false, state: null })],
    });
    const result = await gate.allow({ userId });
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("activity_consent_required");
    expect(result.context.jurisdiction.code).toBe("unknown");
  });

  test("GPC in a US opt-out state blocks partner offers but not activity", async () => {
    process.env.GROWTH_TRUST_CLOUDFLARE = "true";
    installGateDb({ users: [mkUser({ state: "CA" })] });
    const req = {
      headers: {
        "cf-ipcountry": "US",
        "cf-region-code": "CA",
        "sec-gpc": "1",
      },
    };
    await expect(gate.allow({ userId, req })).resolves.toMatchObject({
      allowed: true,
    });
    await expect(
      gate.allow({ userId, req }, "partner_offers"),
    ).resolves.toMatchObject({
      allowed: false,
      reason: "sale_share_optout",
    });
    await expect(
      gate.allow({ userId, req }, "activity_offers"),
    ).resolves.toMatchObject({
      allowed: false,
      reason: "sale_share_optout",
    });
    await expect(
      gate.allow({ userId, req }, "partner_offers", { personalized: false }),
    ).resolves.toMatchObject({ allowed: true });
    const noGpc = { headers: { "cf-ipcountry": "US", "cf-region-code": "CA" } };
    await expect(
      gate.allow({ userId, req: noGpc }, "partner_offers"),
    ).resolves.toMatchObject({ allowed: true });
  });

  test("withdrawal survives a policy version change while stale grants do not", async () => {
    installGateDb({
      users: [mkUser()],
      consents: {
        [userId]: [
          { purpose: "activity", granted: false, version: "growth-v0" },
        ],
      },
    });
    await expect(gate.allow({ userId })).resolves.toMatchObject({
      allowed: false,
      reason: "activity_withdrawn",
    });
    installGateDb({
      users: [mkUser({ country: "FR", state: null })],
      consents: {
        [userId]: [
          { purpose: "activity", granted: true, version: "growth-v0" },
        ],
      },
    });
    await expect(gate.allow({ userId })).resolves.toMatchObject({
      allowed: false,
      reason: "activity_consent_required",
    });
  });

  test("eligibility changes exclude the subject: unconfirmed adult and staff role", async () => {
    installGateDb({ users: [mkUser({ adult_confirmed: false })] });
    await expect(gate.allow({ userId })).resolves.toMatchObject({
      allowed: false,
      reason: "age_or_identity_unknown",
    });
    installGateDb({ users: [mkUser({ role: "admin" })] });
    await expect(gate.allow({ userId })).resolves.toMatchObject({
      allowed: false,
      reason: "excluded_subject",
    });
  });
});
