"use strict";
// N-01: "personalized" is derived from the segment definition. A campaign
// labelled broad on an activity-based segment is refused, and evaluation
// always applies the Do-not-sell-or-share gate for personalized segments.
jest.mock("../db", () => ({ query: jest.fn(), connect: jest.fn() }));
const compile = require("../growth/segments/compile");
const campaigns = require("../growth/campaigns");

const broad = { roles: ["customer"], countries: ["US"], languages: ["en"] };

describe("segment personalization derivation", () => {
  test.each([
    ["broad role/country/language", broad, false],
    ["admin region area", { roles: ["customer"], area: { type: "admin_region", region_id: 4 } }, false],
    ["postal list + account age", { roles: ["helper"], area: { type: "postal_list", ids: [1] }, lifecycle: { account_age_min_days: 30, verified: true } }, false],
    ["contact frequency exclusion", { ...broad, exclude: ["contacted_in_days:14"] }, false],
    ["intent clause", { ...broad, intents: [{ code: "home.plumbing", min_score: 0.2, window_days: 30 }] }, true],
    ["activity fact", { ...broad, facts: [{ fact: "jobs_posted", op: ">=", value: 1 }] }, true],
    ["propensity", { ...broad, propensity: { model: "x", min_decile: 8 } }, true],
    ["behavioural cluster", { roles: ["customer"], area: { type: "cluster", cluster_id: "12" } }, true],
    ["recent activity lifecycle", { ...broad, lifecycle: { last_active_within_days: 7 } }, true],
    ["missing definition fails safe", null, true],
  ])("%s", (_label, def, expected) => {
    expect(compile.isPersonalized(def)).toBe(expected);
  });

  test("a broad label never downgrades a personalized segment", () => {
    const personalizedDef = { ...broad, intents: [{ code: "a.b", min_score: 0.1, window_days: 7 }] };
    expect(compile.effectivePersonalized(false, personalizedDef)).toBe(true);
    expect(compile.effectivePersonalized(false, broad)).toBe(false);
    expect(compile.effectivePersonalized(true, broad)).toBe(true);
    expect(compile.effectivePersonalized(undefined, broad)).toBe(true);
  });

  test("assertPersonalizationLabel refuses broad labels on activity segments", () => {
    expect(() =>
      campaigns.assertPersonalizationLabel(false, { ...broad, facts: [{ fact: "jobs_posted", op: ">=", value: 1 }] }),
    ).toThrow("campaign_segment_personalized");
    expect(() => campaigns.assertPersonalizationLabel(false, broad)).not.toThrow();
    expect(() => campaigns.assertPersonalizationLabel(true, { ...broad, propensity: { model: "x", min_decile: 2 } })).not.toThrow();
  });
});

describe("evaluate applies the derived flag to the privacy gate", () => {
  const gate = require("../growth/gate");
  afterEach(() => jest.restoreAllMocks());
  test("a flag of false on an intent segment is evaluated as personalized", async () => {
    jest.spyOn(gate, "runtimePolicy").mockResolvedValue({});
    jest.spyOn(gate, "rolloutAllows").mockReturnValue({ allowed: true });
    jest.spyOn(gate, "contexts").mockResolvedValue(new Map([["u1", { userId: "u1" }]]));
    const allow = jest.spyOn(gate, "allow").mockResolvedValue({ allowed: true });
    const conn = { query: jest.fn().mockResolvedValue({ rows: [{ id: "u1" }] }) };
    const def = { roles: ["customer"], intents: [{ code: "home.plumbing", min_score: 0.3, window_days: 30 }] };
    await compile.evaluate(conn, def, { global: true, regions: [] }, "partner_offers", { personalized: false });
    expect(allow).toHaveBeenCalledWith({ userId: "u1" }, "partner_offers", { personalized: true });
  });
  test("a broad segment keeps the broad flag", async () => {
    jest.spyOn(gate, "runtimePolicy").mockResolvedValue({});
    jest.spyOn(gate, "rolloutAllows").mockReturnValue({ allowed: true });
    jest.spyOn(gate, "contexts").mockResolvedValue(new Map([["u1", { userId: "u1" }]]));
    const allow = jest.spyOn(gate, "allow").mockResolvedValue({ allowed: true });
    const conn = { query: jest.fn().mockResolvedValue({ rows: [{ id: "u1" }] }) };
    await compile.evaluate(conn, broad, { global: true, regions: [] }, "activity_offers", { personalized: false });
    expect(allow).toHaveBeenCalledWith({ userId: "u1" }, "activity_offers", { personalized: false });
  });
});

describe("campaign edits re-derive personalization", () => {
  test("switching to a personalized segment while labelled broad is refused", async () => {
    const conn = {
      query: jest.fn(async (sql) => {
        if (/FROM growth_segment_versions/.test(sql))
          return { rows: [{ definition: { roles: ["customer"], facts: [{ fact: "jobs_posted", op: ">=", value: 2 }] } }] };
        return { rows: [] };
      }),
    };
    await expect(
      campaigns.editCampaign(
        conn,
        { id: 1, status: "draft", is_personalized: false, segment_version_id: 3, channels: ["in_app"] },
        { id: "admin" },
        { segment_version_id: 9 },
      ),
    ).rejects.toThrow("campaign_segment_personalized");
  });
});
