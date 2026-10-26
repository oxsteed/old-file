"use strict";
// D23: licensed listing import, outreach rules and the prospect segment.
const prospects = require("../growth/prospects/import");
const outreach = require("../growth/prospects/outreach");
const segment = require("../growth/prospects/segment");
const compile = require("../growth/segments/compile");

const license = {
  source: "vendor-x", license_ref: "LIC-1", license_version: "2026.1",
  permitted_uses: ["supply_maps", "marketing_outreach"], acquired_at: "2026-10-01", license_expires_at: "2099-01-01",
};

afterEach(() => {
  delete process.env.GROWTH_PROSPECTS_ENABLED;
  delete process.env.GROWTH_PROSPECT_OUTREACH_ENABLED;
});

test("prospect import is default-off", async () => {
  await expect(prospects.importLicensedBatch({ query: jest.fn() }, { license, rows: [{ id: "1", name: "Acme", country: "US" }], env: {} }))
    .resolves.toEqual({ disabled: true, imported: 0, suppressed: 0 });
});

test("licence must declare provenance, valid permitted uses and not be expired", () => {
  expect(() => prospects.validateLicense({ ...license, permitted_uses: ["resale"] })).toThrow("prospect_permitted_uses_invalid");
  expect(() => prospects.validateLicense({ ...license, license_version: "" })).toThrow("prospect_license_invalid");
  expect(() => prospects.validateLicense({ ...license, acquired_at: "yesterday" })).toThrow("prospect_acquired_at_invalid");
  expect(() => prospects.validateLicense({ ...license, license_expires_at: "2020-01-01" })).toThrow("prospect_license_expired");
  const v = prospects.validate({ id: "r1", name: "Acme", country: "us", contact_email: "x@acme.example" }, prospects.validateLicense(license));
  expect(v.provenance).toMatchObject({ source: "vendor-x", license_ref: "LIC-1", license_version: "2026.1", vendor_record_id: "r1", permitted_uses: ["supply_maps", "marketing_outreach"] });
});

describe("cold-outreach rules (CAN-SPAM, CASL, PECR/ePrivacy)", () => {
  const reviewed = { b2b_rules_reviewed_at: "2026-10-01", b2b_rules_legal_ref: "LEGAL-1", b2b_requires_postal_address: true };
  const us = { ...reviewed, b2b_email_basis: "opt_out", b2b_sole_trader_email_basis: "opt_out", b2b_phone_basis: "consent", b2b_law: "CAN-SPAM" };
  const ca = { ...reviewed, b2b_email_basis: "implied_or_consent", b2b_sole_trader_email_basis: "implied_or_consent", b2b_phone_basis: "consent" };
  const gb = { ...reviewed, b2b_email_basis: "opt_out", b2b_sole_trader_email_basis: "consent", b2b_phone_basis: "consent", b2b_requires_art14_notice: true };
  const ok = { permittedUses: ["marketing_outreach"], entityType: "corporate" };

  test("unreviewed rules are closed even when the basis is opt_out", () => {
    expect(outreach.evaluate({ ...us, b2b_rules_reviewed_at: null }, ok)).toEqual({ allowed: false, reason: "country_rules_unreviewed" });
  });
  test("US email to businesses is opt-out with CAN-SPAM requirements; phone needs consent", () => {
    const d = outreach.evaluate(us, ok);
    expect(d.allowed).toBe(true);
    expect(d.requirements).toEqual(expect.arrayContaining(["postal_address", "working_unsubscribe", "ad_label"]));
    expect(outreach.evaluate(us, { ...ok, channel: "phone" }).allowed).toBe(false);
  });
  test("Canada (CASL) needs consent we do not hold", () => {
    expect(outreach.evaluate(ca, ok)).toEqual({ allowed: false, reason: "basis_implied_or_consent" });
  });
  test("UK corporate is opt-out with an Art. 14 notice; sole traders and unknown entities need consent", () => {
    expect(outreach.evaluate(gb, ok).requirements).toContain("gdpr_art14_notice_within_one_month");
    expect(outreach.evaluate(gb, { ...ok, entityType: "sole_trader" }).allowed).toBe(false);
    expect(outreach.evaluate(gb, { ...ok, entityType: "unknown" }).allowed).toBe(false);
  });
  test("licence, matching and suppression all close outreach", () => {
    expect(outreach.evaluate(us, { ...ok, permittedUses: ["supply_maps"] }).reason).toBe("licence_not_marketing");
    expect(outreach.evaluate(us, { ...ok, matched: true }).reason).toBe("already_on_oxsteed");
    expect(outreach.evaluate(us, { ...ok, suppressed: true }).reason).toBe("suppressed");
  });
});

describe("prospect_business segment", () => {
  test("only area and category filters, country required", () => {
    expect(() => segment.validateDefinition({ roles: ["prospect_business"], area: { country: "US" }, intents: [] })).toThrow("prospect_segment_filters_limited");
    expect(() => segment.validateDefinition({ roles: ["prospect_business"], area: {} })).toThrow("prospect_segment_country_required");
    expect(segment.validateDefinition({ roles: ["prospect_business"], area: { country: "US", postal_codes: ["45501"] }, categories: ["services.plumbing"] }))
      .toMatchObject({ country: "US", postalCodes: ["45501"], categories: ["services.plumbing"] });
  });
  test("user segments refuse the prospect role (no in-app/push to prospects)", () => {
    expect(() => compile.validate ? compile.validate({ roles: ["prospect_business"] }) : compile.compile({ roles: ["prospect_business"] }))
      .toThrow(/prospect_segment_not_user_audience|invalid_segment/);
  });
});

test("suppression requires a reason and a key; contacts are hashed", async () => {
  await expect(prospects.suppress({ query: jest.fn() }, { reason: "" })).rejects.toThrow("prospect_suppression_reason_required");
  await expect(prospects.suppress({ query: jest.fn() }, { reason: "objected" })).rejects.toThrow("prospect_suppression_key_required");
  expect(prospects.emailHash(" Owner@Acme.Example ")).toBe(prospects.emailHash("owner@acme.example"));
  expect(prospects.phoneHash("+1 (555) 010-0000")).toBe(prospects.phoneHash("15550100000"));
});

const targetDb = process.env.STATEMENT_TEST_DATABASE_URL || "";
(/credit_statement_test/.test(targetDb) ? describe : describe.skip)("licensed import on the real schema", () => {
  let pool; let client;
  beforeAll(() => {
    jest.unmock("pg"); jest.unmock("../db"); jest.resetModules();
    process.env.DATABASE_URL = targetDb; process.env.LOG_LEVEL = "error";
    pool = require("../db");
  });
  beforeEach(async () => { client = await pool.connect(); await client.query("BEGIN"); });
  afterEach(async () => { await client.query("ROLLBACK"); client.release(); });

  test("imports with provenance, refuses duplicates, honours suppression and vendor removal", async () => {
    const p = require("../growth/prospects/import");
    const env = { GROWTH_PROSPECTS_ENABLED: "true", GROWTH_PROSPECT_OUTREACH_ENABLED: "true" };
    const lic = { ...license, source: `vendor-${Date.now()}` };
    const rows = [
      { id: "a1", name: "Alpha Plumbing", country: "US", postal_code: "45501", entity_type: "corporate", contact_email: "a@alpha.example" },
      { id: "a2", name: "Beta Drains", country: "US", entity_type: "corporate", contact_email: "b@beta.example" },
      { id: "", name: "broken", country: "US" },
    ];
    const first = await p.importLicensedBatch(client, { license: lic, rows, env });
    expect(first).toMatchObject({ duplicate: false, imported: 2, rejected: 1 });
    const { rows: [rec] } = await client.query("SELECT * FROM prospect_businesses WHERE source=$1 AND source_record_id='a1'", [lic.source]);
    expect(rec.provenance).toMatchObject({ license_ref: "LIC-1", license_version: "2026.1", vendor_record_id: "a1" });
    expect(rec.permitted_uses).toEqual(["supply_maps", "marketing_outreach"]);
    // jurisdiction rules ship unreviewed, so outreach stays closed
    expect(rec.outreach_allowed).toBe(false);

    expect((await p.importLicensedBatch(client, { license: lic, rows, env })).duplicate).toBe(true);

    await p.suppress(client, { email: "B@beta.example", reason: "objected" });
    const { rows: [b] } = await client.query("SELECT outreach_status FROM prospect_businesses WHERE source=$1 AND source_record_id='a2'", [lic.source]);
    expect(b.outreach_status).toBe("suppressed");

    const snap = await p.importLicensedBatch(client, { license: lic, rows: [rows[0], rows[1]], fullSnapshot: true, env: { ...env } });
    expect(snap.suppressed).toBe(1);
    const second = await p.importLicensedBatch(client, { license: { ...lic, license_version: "2026.2" }, rows: [rows[0]], fullSnapshot: true, env });
    expect(second.marked_unusable).toBeGreaterThanOrEqual(0);
    const { rows: gone } = await client.query("SELECT source_record_id, usable, unusable_reason FROM prospect_businesses WHERE source=$1 ORDER BY source_record_id", [lic.source]);
    expect(gone.find((g) => g.source_record_id === "a1").usable).toBe(true);
    expect(gone.find((g) => g.source_record_id === "a2")).toMatchObject({ usable: false, unusable_reason: "removed_by_vendor" });
  });

  test("outreach export rows only for reviewed opt-out countries", async () => {
    const p = require("../growth/prospects/import");
    const seg = require("../growth/prospects/segment");
    const env = { GROWTH_PROSPECTS_ENABLED: "true", GROWTH_PROSPECT_OUTREACH_ENABLED: "true" };
    await client.query("UPDATE jurisdiction_rules SET b2b_rules_reviewed_at=NOW(), b2b_rules_legal_ref='TEST' WHERE code='US'");
    const lic = { ...license, source: `vendor-r-${Date.now()}` };
    await p.importLicensedBatch(client, { license: lic, rows: [{ id: "c1", name: "Gamma Pipes Unique", country: "US", entity_type: "corporate", contact_email: "c@gamma.example" }], env });
    const out = await seg.members(client, { roles: ["prospect_business"], area: { country: "US" } }, { purpose: "outreach" });
    const mine = out.rows.filter((r) => r.source === lic.source);
    expect(mine).toHaveLength(1);
    expect(mine[0].outreach_requirements).toContain("postal_address");
  });
});
