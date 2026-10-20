"use strict";
// Track 4 completion tests: domain rollup weights, propensity scorecards,
// segment DSL completion, suggestion ranking validation, governed growth
// metrics and region anchors, migration 939 shape. Pure/unit level with
// the db module mocked, following growthEngine.test.js patterns.
jest.mock("../db", () => ({ query: jest.fn(), connect: jest.fn() }));

const fs = require("fs");
const path = require("path");
const insights = require("../growth/insights");
const propensity = require("../growth/propensity");
const segments = require("../growth/segments/compile");
const facts = require("../growth/segments/facts");
const produce = require("../growth/recommend/produce");
const { METRICS } = require("../analytics/metricsRegistry");
const { METRIC_PERMISSIONS } = require("../analytics/metricAccess");
const snapshots = require("../analytics/metricSnapshots");
const regionScope = require("../analytics/regionScope");
const queryBuilder = require("../analytics/queryBuilder");
const { ROLE_SQL } = require("../growth/roles");

const GROWTH_METRICS = [
  "growth_campaign_recipients",
  "growth_offer_ctr_pct",
  "growth_offer_optout_rate_pct",
  "growth_push_open_rate_pct",
  "growth_affiliate_commission_cents",
  "growth_promo_redeemed_cents",
  "demand_unfilled_rate_pct",
  "demand_gap_index",
];
const MONEY_GROWTH = [
  "growth_affiliate_commission_cents",
  "growth_promo_redeemed_cents",
];

// ---- spec 10.1 signal weights -------------------------------------------

test("signal weights follow spec 10.1 and unknown signals default to 1.0", () => {
  expect(insights.SIGNAL_WEIGHTS["job.posted"]).toBe(1.0);
  expect(insights.SIGNAL_WEIGHTS["job.published"]).toBe(1.0);
  expect(insights.SIGNAL_WEIGHTS["job.completed"]).toBe(1.0);
  expect(insights.SIGNAL_WEIGHTS["job.unfilled_expired"]).toBe(1.5);
  expect(insights.SIGNAL_WEIGHTS["search"]).toBe(0.3);
  expect(insights.SIGNAL_WEIGHTS["search.zero_result"]).toBe(0.8);
  expect(insights.SIGNAL_WEIGHTS["planned_need"]).toBe(0.7);
  expect(insights.SIGNAL_WEIGHTS["saved_search"]).toBe(0.5);
  expect(insights.SIGNAL_WEIGHTS["booking.requested"]).toBe(1.0);
  expect(insights.SIGNAL_WEIGHTS["food.order"]).toBe(1.0);
  expect(insights.SIGNAL_WEIGHTS["marketplace.order"]).toBe(1.0);
  expect(insights.SIGNAL_WEIGHTS["direct.request"]).toBe(1.0);
  expect(insights.weightOf("job.posted")).toBe(1.0);
  expect(insights.weightOf("something.new")).toBe(1.0);
  expect(insights.K).toBe(5);
});

// ---- spec 10.4 propensity scorecards ------------------------------------

test("scoreFacts: full customer_return facts score 1 with top-3 reasons by points", () => {
  const out = propensity.scoreFacts("customer_return", {
    jobs_completed: 2,
    orders_paid: 1,
    planned_active: 1,
    saved_searches: 3,
    days_since_activity: 45,
  });
  expect(out.score).toBe(1);
  expect(out.reasons).toHaveLength(3);
  expect(out.reasons[0]).toEqual({
    key: "repeat_history",
    label: "3+ completed jobs or paid orders",
    points: 30,
  });
  expect(out.reasons.map((r) => r.points)).toEqual([30, 25, 25]);
});

test("scoreFacts: partial facts score proportionally and keep the fired reason", () => {
  const out = propensity.scoreFacts("customer_return", {
    jobs_completed: 0,
    orders_paid: 0,
    planned_active: 0,
    saved_searches: 2,
    days_since_activity: 10,
  });
  expect(out.score).toBe(0.2);
  expect(out.reasons).toEqual([
    { key: "saved_searches", label: "2+ saved searches", points: 20 },
  ]);
});

test("scoreFacts: ineligible prospects return null and unknown models throw", () => {
  expect(
    propensity.scoreFacts("customer_return", {
      jobs_completed: 5,
      orders_paid: 0,
      planned_active: 0,
      saved_searches: 0,
      days_since_activity: null,
    }),
  ).toBeNull();
  expect(() => propensity.scoreFacts("nope", {})).toThrow(
    "unknown_propensity_model",
  );
  expect(Object.keys(propensity.MODELS).sort()).toEqual([
    "business_invoicing_adoption",
    "customer_return",
    "customer_to_helper",
    "helper_tier_upgrade",
    "restaurant_delivery_adoption",
  ]);
  for (const def of Object.values(propensity.MODELS)) {
    const max = def.rules.reduce((s, r) => s + r.points, 0);
    expect(max).toBe(100);
  }
});

test("canonical role SQL is enum-safe: ownership-derived business and restaurant", () => {
  // The user_role enum is customer/helper/helper_pro/broker/admin/
  // super_admin/employee; the previous expression compared u.role to
  // 'business_owner' and threw 22P02 on any real execution.
  expect(ROLE_SQL).not.toContain("business_owner");
  expect(ROLE_SQL).not.toContain("restaurant_owner");
  expect(ROLE_SQL).toContain("food_restaurants");
  expect(ROLE_SQL).toContain("businesses");
  expect(ROLE_SQL).toContain("helper_pro");
  expect(ROLE_SQL).toContain("u.role::text");
});

// ---- spec 11.1 segment DSL completion -----------------------------------

const base = { roles: ["helper"], area: { type: "country", country: "US" } };

test("compile keeps the mandatory gate, jurisdiction and eligibility predicates", () => {
  const { sql, params } = segments.compile(base, {
    global: false,
    regions: [{ country: "US", states: ["FL"] }],
  });
  expect(sql).toContain("u.is_active=TRUE");
  expect(sql).toContain("e.adult_confirmed=TRUE");
  expect(sql).toContain("e.is_internal=FALSE");
  expect(params).toContain("US");
  expect(sql).not.toContain("'US'");
});

test("fact templates compile parameterized and reject anything unreviewed", () => {
  const def = {
    ...base,
    facts: [{ fact: "jobs_completed", op: ">=", value: 3, window_days: 90 }],
  };
  expect(() => segments.validate(def)).not.toThrow();
  const { sql, params } = segments.compile(def);
  expect(sql).toContain("FROM jobs j");
  expect(params).toContain(3);
  expect(params).toContain(90);
  expect(() =>
    segments.validate({
      ...base,
      facts: [{ fact: "raw_arbitrary_sql", op: ">=", value: 1 }],
    }),
  ).toThrow("invalid_segment_fact");
  expect(() =>
    segments.validate({
      ...base,
      facts: [{ fact: "tier", op: ">=", value: "pro" }],
    }),
  ).toThrow("invalid_segment_fact");
  expect(facts.validateFact({ fact: "tier", op: "=", value: "pro" })).toBe(true);
  expect(facts.validateFact({ fact: "has_delivery", op: "=", value: true })).toBe(true);
  expect(facts.validateFact({ fact: "menu_size", op: ">=", value: 10, window_days: 30 })).toBe(false);
});

test("lifecycle and verified filters compile to the user-row proxies", () => {
  const { sql, params } = segments.compile({
    ...base,
    lifecycle: { last_active_within_days: 30, verified: true, account_age_min_days: 60 },
  });
  expect(sql).toContain("u.last_login_at>=");
  expect(sql).toContain("COALESCE(u.identity_verified,FALSE)=");
  expect(params).toContain(30);
  expect(params).toContain(true);
  expect(() =>
    segments.validate({ ...base, lifecycle: { verified: "yes" } }),
  ).toThrow("invalid_segment_lifecycle");
});

test("propensity clause uses a percentile threshold and validates the model", () => {
  const { sql, params } = segments.compile({
    ...base,
    propensity: { model: "customer_return", min_decile: 9 },
  });
  expect(sql).toContain("percentile_cont");
  expect(sql).toContain("propensity_scores");
  expect(params).toContain(0.8);
  expect(params).toContain("customer_return");
  expect(() =>
    segments.validate({
      ...base,
      propensity: { model: "trained_model_v2", min_decile: 5 },
    }),
  ).toThrow("invalid_segment_propensity");
  expect(() =>
    segments.validate({
      ...base,
      propensity: { model: "customer_return", min_decile: 11 },
    }),
  ).toThrow("invalid_segment_propensity");
});

test("admin_region and cluster areas fail closed when unresolved", () => {
  const regionDef = { roles: ["customer"], area: { type: "admin_region", region_id: 7 } };
  expect(segments.compile(regionDef).sql).toContain("FALSE");
  const resolvedRegion = segments.compile(regionDef, { global: true, regions: [] }, {
    adminRegions: [{ country: "US", states: ["FL"] }],
  });
  expect(resolvedRegion.sql).not.toContain("AND FALSE");
  const clusterDef = { roles: ["customer"], area: { type: "cluster", cluster_id: "c_20261020_US_1_2" } };
  expect(segments.compile(clusterDef).sql).toContain("FALSE");
  const resolvedCluster = segments.compile(clusterDef, { global: true, regions: [] }, {
    clusterPostalRefs: [11, 12],
  });
  expect(resolvedCluster.sql).toContain("g.id=ANY");
  expect(resolvedCluster.params).toContainEqual([11, 12]);
  expect(() =>
    segments.validate({ roles: ["customer"], area: { type: "cluster", cluster_id: "bad id!" } }),
  ).toThrow("invalid_segment_area");
});

test("exclusions compile to NOT EXISTS and reject unknown tokens", () => {
  const { sql, params } = segments.compile({
    ...base,
    exclude: ["contacted_in_days:30", "dismissed_intent_in_days:7"],
  });
  expect(sql).toContain("marketing_contact_log");
  expect(sql).toContain("growth_intent_dismissals");
  expect(params).toContain(30);
  expect(params).toContain(7);
  expect(() =>
    segments.validate({ ...base, exclude: ["deleted_in_days:3"] }),
  ).toThrow("invalid_segment_exclude");
  expect(() =>
    segments.validate({ ...base, raw_sql: "1=1" }),
  ).toThrow("invalid_segment");
});

// ---- spec 12 suggestion ranking validation -------------------------------

const candidates = [
  { offer_id: 1, value_minor: 500, ctr: 0.1, cvr: 0.05 },
  { offer_id: 2, value_minor: 0, ctr: 0.2, cvr: 0.1 },
];

test("validateRanking accepts an in-set ranking and rejects invented output", () => {
  const ok = produce.validateRanking(
    { ranking: [2, 1], rationale: "Widest reach first", risks: "" },
    candidates,
  );
  expect(ok.ranking).toEqual([2, 1]);
  expect(
    produce.validateRanking({ ranking: [3], rationale: "", risks: "" }, candidates),
  ).toBeNull();
  expect(
    produce.validateRanking({ ranking: [1, 1], rationale: "", risks: "" }, candidates),
  ).toBeNull();
  expect(
    produce.validateRanking(
      { ranking: [1], rationale: "Guaranteed results", risks: "" },
      candidates,
    ),
  ).toBeNull();
  expect(
    produce.validateRanking(
      { ranking: [1], rationale: "Save 999 today", risks: "" },
      candidates,
    ),
  ).toBeNull();
  expect(
    produce.validateRanking(
      { ranking: [1], rationale: "A free extra", risks: "" },
      [candidates[0]],
    ),
  ).toBeNull();
  expect(
    produce.validateRanking(
      { ranking: [2], rationale: "A free extra", risks: "" },
      candidates,
    ),
  ).not.toBeNull();
  expect(produce.validateRanking(null, candidates)).toBeNull();
  expect(produce.validateRanking({ ranking: [] }, candidates)).toBeNull();
});

test("valuePerConversion: affiliate uses partner rate with a 4 percent default", () => {
  expect(
    produce.valuePerConversion(
      { type: "affiliate_product", value_minor: 10000 },
      { commission_terms: { default_rate: 0.1 } },
    ),
  ).toBe(1000);
  expect(
    produce.valuePerConversion({ type: "affiliate_product", value_minor: 10000 }, null),
  ).toBe(400);
  expect(produce.valuePerConversion({ type: "plan", value_minor: 2500 }, null)).toBe(2500);
  expect(
    produce.valuePerConversion({ type: "internal_feature", value_minor: 2500 }, null),
  ).toBe(0);
});

// ---- spec 21.1 governed metrics ------------------------------------------

test("the 8 growth metrics are registered with permissions and snapshot columns", () => {
  for (const name of GROWTH_METRICS) {
    expect(METRICS[name]).toBeDefined();
    expect(snapshots.VALUE_COLUMNS[name]).toBeDefined();
    expect(snapshots.isSnapshotMetric(name)).toBe(true);
  }
  for (const name of MONEY_GROWTH)
    expect(METRIC_PERMISSIONS[name]).toBe("view_financials");
  for (const name of GROWTH_METRICS.filter((n) => !MONEY_GROWTH.includes(n)))
    expect(METRIC_PERMISSIONS[name]).toBe("view_growth_insights");
  expect(snapshots.VALUE_COLUMNS.growth_affiliate_commission_cents).toBe(
    "growth_affiliate_commission_cents",
  );
});

test("query builder serves the non-money growth metrics and rejects unknown ones", () => {
  for (const name of [
    "growth_campaign_recipients",
    "growth_offer_ctr_pct",
    "growth_offer_optout_rate_pct",
    "growth_push_open_rate_pct",
    "demand_unfilled_rate_pct",
    "demand_gap_index",
  ]) {
    const built = queryBuilder.buildMetricSql({ metric: name, period: "30d", dimensions: [] });
    expect(built.text).toBeTruthy();
  }
  expect(() =>
    queryBuilder.buildMetricSql({ metric: "not_a_metric", period: "30d", dimensions: [] }),
  ).toThrow();
});

test("region anchors cover the growth tables and unanchored tables fail closed", () => {
  for (const table of [
    "demand_subject_daily",
    "supply_subject_daily",
    "user_interest_profiles",
    "offer_campaign_recipients",
    "offer_campaign_deliveries",
    "offer_clicks",
    "affiliate_conversions",
  ])
    expect(regionScope.ANCHORS[table]).toBeDefined();
  const scoped = regionScope.applyRegionScope(
    { text: "SELECT * FROM demand_subject_daily t", params: [] },
    { global: false, regions: [{ country: "US" }] },
  );
  expect(scoped.text).toContain("__rs_geo_postal_centroids");
  expect(() =>
    regionScope.applyRegionScope(
      { text: "SELECT * FROM wallets t", params: [] },
      { global: false, regions: [{ country: "US" }] },
    ),
  ).toThrow(expect.objectContaining({ code: "region_scope_unsupported" }));
});

// ---- migration 939 + demand endpoint shape --------------------------------

test("migration 939 is additive and carries the subject sets and support tables", () => {
  const sql = fs.readFileSync(
    path.join(__dirname, "..", "migrations", "939_growth_insights_completion.sql"),
    "utf8",
  );
  for (const table of [
    "demand_subject_daily",
    "supply_subject_daily",
    "growth_anomaly_flags",
    "offer_pair_penalties",
    "propensity_calibration_reports",
    "growth_suggestion_runs",
  ])
    expect(sql).toContain(`CREATE TABLE ${table} (`);
  expect(sql).not.toMatch(/DROP TABLE|DROP COLUMN|DELETE FROM/);
  // growth_clusters is defined canonically in migration 937, not here.
  expect(sql).not.toContain("CREATE TABLE growth_clusters");
});

test("demand endpoint serves exact distinct windows, not maximum daily counts", () => {
  const route = fs.readFileSync(
    path.join(__dirname, "..", "routes", "growthInsights.js"),
    "utf8",
  );
  expect(route).toContain("computeCells");
  expect(route).not.toMatch(/MAX\(\s*(?:d\.)?demand/i);
  const rollups = fs.readFileSync(
    path.join(__dirname, "..", "jobs", "growthNightlyRollups.js"),
    "utf8",
  );
  expect(rollups).toContain("collectDomainDay");
  expect(rollups).toContain("growth_anomaly_flags");
});
