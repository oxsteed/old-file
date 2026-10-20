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
    // and the current denial survive profile/raw erasure.
    expect(joined).not.toContain("affiliate_conversions");
    expect(joined).not.toContain("marketing_suppressions");
    expect(joined).not.toContain("DELETE FROM tracking_consents");
    expect(joined).not.toContain("DELETE FROM tracking_consent_current");
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
  });
});
