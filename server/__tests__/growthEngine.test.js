"use strict";
jest.mock("../db", () => ({ query: jest.fn(), connect: jest.fn() }));
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const gate = require("../growth/gate");
const { effectiveDate } = require("../growth/rollout");
const { validateEvent, scrubQuery } = require("../growth/events/validate");
const { compile } = require("../growth/segments/compile");
const { validateCopy, holdout } = require("../growth/campaigns");
const core = require("../services/delivery/core");
const { scoreRules } = require("../growth/classify");
const { score, gap } = require("../growth/recommend/score");
const { sign, verify, destination } = require("../growth/partners/tokens");
const db = require("../db");
const now = Date.parse("2026-10-20T12:00:00Z");
const userId = "00000000-0000-4000-8000-000000000001";
function context() {
  return {
    enabled: true,
    rollout: {
      state: "effective",
      effective_at: "2026-10-19",
      legal_review_ref: "test-legal",
      translations_reviewed: true,
      rights_verified: true,
    },
    user: { id: userId, role: "customer", is_active: true },
    eligibility: { adult_confirmed: true },
    consents: {},
    jurisdiction: {
      code: "US",
      basis: "notice",
      offersBasis: "notice",
      saleShare: false,
      reviewed: true,
    },
  };
}
function allowed(
  ctx,
  purpose = "activity",
  env = { GROWTH_TRACKING_HARD_OFF: "false" },
) {
  return gate.decide(ctx, purpose, now, env).allowed;
}
const event = (props = { route: "/jobs" }) => ({
  event_id: crypto.randomUUID(),
  name: "page.view",
  schema_ver: 1,
  occurred_at: new Date(now).toISOString(),
  props,
});
beforeEach(() => {
  jest.clearAllMocks();
  process.env.GROWTH_LINK_SECRET =
    "synthetic-growth-link-test-key-32-characters";
});
test("all rollout and operational switches fail closed", () => {
  expect(allowed(context())).toBe(true);
  for (const env of [
    {},
    { GROWTH_TRACKING_HARD_OFF: "true" },
    { GROWTH_TRACKING_HARD_OFF: "0" },
  ])
    expect(allowed(context(), "activity", env)).toBe(false);
  for (const state of [
    "draft",
    "notice_scheduled",
    "notice_sending",
    "notice_complete",
    "paused",
  ]) {
    const c = context();
    c.rollout.state = state;
    expect(allowed(c)).toBe(false);
  }
  for (const field of [
    "legal_review_ref",
    "translations_reviewed",
    "rights_verified",
  ]) {
    const c = context();
    c.rollout[field] = null;
    expect(allowed(c)).toBe(false);
  }
  const c = context();
  c.rollout.effective_at = "2026-10-21";
  expect(allowed(c)).toBe(false);
  c.rollout.effective_at = null;
  expect(allowed(c)).toBe(false);
});
test("age, staff, impersonation and account status exclude every purpose", () => {
  for (const purpose of [
    "activity",
    "activity_offers",
    "partner_offers",
    "offer_push",
  ]) {
    for (const role of ["admin", "super_admin", "support", "unknown"]) {
      const c = context();
      c.user.role = role;
      expect(allowed(c, purpose)).toBe(false);
    }
    for (const flag of ["is_banned", "is_suspended", "deleted_at"]) {
      const c = context();
      c.user[flag] = true;
      expect(allowed(c, purpose)).toBe(false);
    }
    const c = context();
    c.impersonated = true;
    expect(allowed(c, purpose)).toBe(false);
    c.impersonated = false;
    c.eligibility.adult_confirmed = false;
    expect(allowed(c, purpose)).toBe(false);
  }
});
test("collection and profiling consents are independent and push always needs explicit opt-in", () => {
  const c = context();
  c.jurisdiction.basis = "consent";
  c.jurisdiction.offersBasis = "consent";
  expect(allowed(c)).toBe(false);
  c.consents.activity = true;
  expect(allowed(c)).toBe(true);
  expect(allowed(c, "activity_offers")).toBe(false);
  c.consents.activity_offers = true;
  expect(allowed(c, "activity_offers")).toBe(true);
  expect(allowed(c, "offer_push")).toBe(false);
  c.consents.offer_push = true;
  expect(allowed(c, "offer_push")).toBe(true);
});
test("GPC and sale/share opt-out limit partner targeting in opt-out jurisdictions", () => {
  const c = context();
  c.gpc = true;
  expect(allowed(c, "partner_offers")).toBe(true);
  c.jurisdiction.saleShare = true;
  expect(allowed(c, "partner_offers")).toBe(false);
  expect(allowed(c, "activity_offers")).toBe(false);
  c.gpc = false;
  c.consents.sale_share_optout = true;
  expect(allowed(c, "partner_offers")).toBe(false);
});
test("strictest jurisdiction signal wins and unreviewed defaults cannot enable collection", () => {
  const rules = [
    {
      code: "US",
      activity_basis: "notice",
      offers_basis: "notice",
      sale_share_control: true,
      reviewed_at: "2026-10-20",
    },
    {
      code: "FR",
      activity_basis: "consent",
      offers_basis: "consent",
      reviewed_at: "2026-10-20",
    },
    {
      code: "unknown",
      activity_basis: "consent",
      offers_basis: "consent",
      reviewed_at: "2026-10-20",
    },
  ];
  expect(gate.resolveJurisdiction(["US", "FR"], rules)).toMatchObject({
    basis: "consent",
    saleShare: true,
    reviewed: true,
  });
  expect(gate.resolveJurisdiction([], rules).basis).toBe("consent");
  expect(gate.resolveJurisdiction(["BR"], rules).reviewed).toBe(false);
});
test("effective date is last accepted send +14 days and never earlier than quoted", () => {
  expect(effectiveDate("2026-10-01", "2026-10-12").toISOString()).toBe(
    "2026-10-15T00:00:00.000Z",
  );
  expect(effectiveDate("2026-10-01", "2026-10-20").toISOString()).toBe(
    "2026-10-20T00:00:00.000Z",
  );
  expect(() => effectiveDate("bad", "2026-10-20")).toThrow();
});
test("event schemas reject identity spoofing, private fields, arbitrary paths and domain events from browsers", () => {
  expect(validateEvent(event(), { now })).not.toBeNull();
  for (const props of [
    { route: "/jobs/real-person-name" },
    { route: "/jobs", email: "private@example.test" },
    { route: "/wallet" },
    { route: "/jobs?email=x" },
    { route: "/jobs", input: "secret" },
  ])
    expect(validateEvent(event(props), { now })).toBeNull();
  expect(
    validateEvent({ ...event(), subject_key: "spoofed" }, { now }),
  ).toBeNull();
  expect(
    validateEvent(
      {
        ...event(),
        name: "job.posted",
        props: { job_id: crypto.randomUUID() },
      },
      { now },
    ),
  ).toBeNull();
  expect(
    validateEvent(
      {
        ...event(),
        name: "job.posted",
        props: { job_id: crypto.randomUUID() },
      },
      { now, domain: true },
    ),
  ).not.toBeNull();
  expect(
    validateEvent(
      { ...event(), name: "credit.loaded", props: {} },
      { now, domain: true },
    ),
  ).toBeNull();
});
test("normalized searches remove email, phone, addresses and URLs", () => {
  const value = scrubQuery(
    "Clogged drain private@example.test +1 (555) 123-4567 123 Main Street https://example.test/private",
  );
  expect(value).toBe("clogged drain");
  expect(scrubQuery("x".repeat(300))).toHaveLength(100);
});
test("segments use bound SQL values, enforce mandatory exclusions and reject unsupported clauses", () => {
  const built = compile(
    {
      roles: ["helper"],
      area: { type: "country", country: "US" },
      intents: [
        {
          code: "services.plumbing.drain_clog",
          min_score: 0.5,
          window_days: 60,
        },
      ],
    },
    { global: false, regions: [{ type: "country_only", countries: ["US"] }] },
  );
  expect(built.sql).not.toContain("drain_clog");
  expect(built.params).toContain("services.plumbing.drain_clog");
  expect(built.sql).toContain("NOT n.sensitive");
  expect(built.sql).toContain("adult_confirmed=TRUE");
  expect(built.sql).toContain("jsonb_array_elements");
  for (const definition of [
    { roles: ["helper'); DROP TABLE users;--"] },
    { roles: ["helper"], sql: "SELECT 1" },
    { roles: ["helper"], facts: [{ fact: "credit_balance" }] },
    {
      roles: ["helper"],
      area: { type: "country", country: "US", hidden_sql: "true" },
    },
  ])
    expect(() => compile(definition, { global: true })).toThrow();
});
test("five-language copy and push limits are required including disclosure", () => {
  const copy = Object.fromEntries(
    ["en", "es", "fr", "ht", "ar"].map((l) => [
      l,
      {
        title: "Offer",
        body: "Message",
        button: "See",
        push_title: "Offer",
        push_body: "Details",
        disclosure: "Paid link",
      },
    ]),
  );
  expect(validateCopy(copy, ["in_app", "push"], { affiliate: true })).toBe(
    copy,
  );
  copy.ar.push_title = "ع".repeat(51);
  expect(() => validateCopy(copy, ["push"])).toThrow();
  copy.ar.push_title = "عرض";
  delete copy.ht;
  expect(() => validateCopy(copy, ["in_app"])).toThrow();
});
test.each([
  ["America/New_York", "2026-10-20T01:00:00Z", true],
  ["Europe/Paris", "2026-10-20T10:00:00Z", false],
  ["Asia/Tokyo", "2026-10-20T12:00:00Z", true],
  ["America/New_York", "2026-11-01T06:30:00Z", true],
  ["invalid", "2026-10-20T12:00:00Z", true],
])("quiet hours handle %s at %s", (tz, at, quiet) =>
  expect(core.quietHours(tz, new Date(at))).toBe(quiet),
);
test("holdout assignments are stable", () => {
  expect(holdout("u", "c", 10)).toBe(holdout("u", "c", 10));
  expect(holdout("u", "c", 0)).toBe(false);
});
test("offer links authenticate claims and expiry and reject unsafe destinations", () => {
  const token = sign({ delivery_id: "5", exp: now + 1000 });
  expect(verify(token, now).delivery_id).toBe("5");
  expect(verify(token, now + 2000)).toBeNull();
  expect(verify(`${token}x`, now)).toBeNull();
  for (const target of [
    "https://partner.test.evil.test/item",
    "http://partner.test/item",
    "https://user:pass@partner.test/item",
    "https://partner.test:8443/item",
  ])
    expect(() =>
      destination(target, ["partner.test"], crypto.randomUUID()),
    ).toThrow();
  expect(
    new URL(
      destination(
        "https://partner.test/item",
        ["partner.test"],
        "random-click",
      ),
    ).searchParams.get("subid"),
  ).toBe("random-click");
});
test("classification ignores sensitive nodes and deterministic rules win without AI", () => {
  const ranked = scoreRules(
    { text: "blocked drain", locale: "en", category_id: 3 },
    [
      {
        code: "services.plumbing",
        node_id: 1,
        kind: "keyword",
        pattern: "drain",
        locale: "en",
        status: "active",
      },
      {
        code: "services.plumbing",
        node_id: 1,
        kind: "category_id",
        pattern: "3",
        locale: "en",
        status: "active",
      },
      {
        code: "sensitive.health",
        node_id: 2,
        kind: "keyword",
        pattern: "drain",
        locale: "en",
        status: "active",
        sensitive: true,
      },
    ],
  );
  expect(ranked).toHaveLength(1);
  expect(ranked[0].confidence).toBe(0.9);
});
test("ranking has smoothed priors and rejects invalid evidence", () => {
  expect(
    score({ reach: 10, commission_minor: 100 }).expected_minor,
  ).toBeGreaterThan(0);
  expect(gap(10, 1)).toBeGreaterThan(0);
  expect(() => score({ reach: 10, clicks: 2, delivered: 1 })).toThrow();
});
test("ClickHouse writer discards denied subjects and never inserts while the gate is off", async () => {
  const { writeBatch } = require("../growth/ingest/writer");
  const pipe = {
    xack: jest.fn(),
    xdel: jest.fn(),
    exec: jest.fn().mockResolvedValue([]),
  };
  const conn = { multi: jest.fn(() => pipe) },
    store = { insert: jest.fn() },
    allow = jest.fn().mockResolvedValue({ allowed: false });
  const result = await writeBatch(
    [
      [
        "1-0",
        ["payload", JSON.stringify({ userId, event: event(), domain: false })],
      ],
    ],
    { conn, store, allow },
  );
  expect(result).toEqual({ stored: 0, discarded: 1 });
  expect(store.insert).not.toHaveBeenCalled();
  expect(pipe.xack).toHaveBeenCalled();
});
test("all raw writes call the authoritative gate and growth cannot import outside AI or financial services", () => {
  function walk(dir) {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .flatMap((f) =>
        f.isDirectory()
          ? walk(path.join(dir, f.name))
          : [path.join(dir, f.name)],
      );
  }
  for (const file of walk(path.join(__dirname, "../growth")).filter((f) =>
    f.endsWith(".js"),
  )) {
    const src = fs.readFileSync(file, "utf8");
    expect(src).not.toMatch(
      /require\([^)]*(?:metaChatProvider|aiChatProvider|chatController|oxsteedCredit|creditAccount|paymentRails)/i,
    );
    expect(src).not.toMatch(/openrouter\.ai|api\.meta\.ai|api\.openai\.com/);
    if (/table:\s*['"]growth\.activity_events['"]/.test(src))
      expect(src).toContain("gate.allow");
  }
});
test("privacy content changes never trigger the existing re-acceptance gate", async () => {
  const config = require("../constants/termsConfig").TERMS_CONFIG;
  const previous = config.privacy_policy.contentVersion;
  config.privacy_policy.contentVersion = "growth-v999";
  db.query.mockResolvedValue({
    rows: [
      {
        consent_type: "terms_of_service",
        version: config.terms_of_service.version,
      },
      {
        consent_type: "privacy_policy",
        version: config.privacy_policy.version,
      },
    ],
  });
  const next = jest.fn(),
    res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
  await require("../middleware/requireTermsAcceptance")(
    { user: { id: userId } },
    res,
    next,
  );
  expect(next).toHaveBeenCalled();
  expect(res.status).not.toHaveBeenCalled();
  config.privacy_policy.contentVersion = previous;
});

test("explicit objections remain effective in notice-basis jurisdictions", () => {
  const c = context();
  c.consents.activity = false;
  for (const purpose of [
    "activity",
    "activity_offers",
    "partner_offers",
    "offer_push",
  ])
    expect(allowed(c, purpose)).toBe(false);
  c.consents.activity = true;
  c.consents.activity_offers = false;
  expect(allowed(c)).toBe(true);
  expect(allowed(c, "activity_offers")).toBe(false);
  expect(allowed(c, "partner_offers")).toBe(false);
});
test("withdrawal erasure preserves the authoritative current denial", async () => {
  const saved = process.env.GROWTH_SUBJECT_PEPPER;
  process.env.GROWTH_SUBJECT_PEPPER =
    "synthetic-growth-subject-pepper-test-only";
  try {
    const conn = {
      query: jest.fn().mockResolvedValue({ rows: [], rowCount: 1 }),
    };
    await require("../growth/rights").erase(conn, userId, "withdraw_activity");
    const sql = conn.query.mock.calls.map((c) => c[0]).join("\n");
    expect(sql).toContain("growth_erasure_queue");
    expect(sql).toContain("DELETE FROM user_interest_profiles");
    expect(sql).not.toContain("DELETE FROM tracking_consent_current");
  } finally {
    if (saved === undefined) delete process.env.GROWTH_SUBJECT_PEPPER;
    else process.env.GROWTH_SUBJECT_PEPPER = saved;
  }
});
test("a failed gate query aborts a transactional business write instead of hiding a PostgreSQL rollback", async () => {
  const error = new Error("synthetic database failure");
  const conn = {
    query: jest.fn().mockRejectedValue(error),
    release: jest.fn(),
  };
  await expect(gate.allow({ userId, db: conn })).rejects.toThrow(error);
  db.query.mockRejectedValueOnce(error);
  expect(await gate.allow({ userId })).toEqual({
    allowed: false,
    reason: "gate_unavailable",
  });
});
test("telemetry removes growth event properties and authentication proof even in nested data", () => {
  const { scrubGrowthTelemetry } = require("../utils/telemetryPrivacy");
  const result = scrubGrowthTelemetry({
    request: {
      url: "https://oxsteed.com/api/activity/batch",
      data: { events: [{ props: { email: "private" } }] },
    },
    extra: {
      totp: "123456",
      query_norm: "private",
      nested: { stepUpCode: "123456" },
    },
  });
  expect(result.request.data).toBe("[REDACTED]");
  expect(result.extra.totp).toBe("[REDACTED]");
  expect(result.extra.query_norm).toBe("[REDACTED]");
  expect(result.extra.nested.stepUpCode).toBe("[REDACTED]");
});
