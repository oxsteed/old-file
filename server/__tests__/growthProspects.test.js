"use strict";
const prospects = require("../growth/prospects/import");

afterEach(() => {
  delete process.env.GROWTH_PROSPECTS_ENABLED;
  delete process.env.GROWTH_PROSPECT_OUTREACH_ENABLED;
});

test("prospect import is default-off and requires license provenance", async () => {
  await expect(
    prospects.importProspects({ query: jest.fn() }, [{ name: "Acme", country: "US" }]),
  ).resolves.toEqual({ disabled: true, imported: 0, suppressed: 0 });
  expect(() => prospects.validate({ name: "Acme", country: "US" })).toThrow("invalid_prospect_record");
});

test("enabled prospect import checks suppression and keeps outreach opt-in", async () => {
  process.env.GROWTH_PROSPECTS_ENABLED = "true";
  const conn = { query: jest.fn(async (sql) => (sql.startsWith("SELECT 1") ? { rows: [] } : { rows: [] })) };
  await expect(prospects.importProspects(conn, [{ source: "licensed", source_record_id: "a1", name: "Acme Co", country: "US", license_ref: "lic-1", outreach_allowed: true }])).resolves.toEqual({ imported: 1, suppressed: 0 });
  const insert = conn.query.mock.calls.find(([sql]) => sql.includes("INSERT INTO prospect_businesses"));
  expect(insert[1][10]).toBe(false);
  process.env.GROWTH_PROSPECT_OUTREACH_ENABLED = "true";
  expect(prospects.validate({ source: "licensed", source_record_id: "a2", name: "Acme Co", country: "US", license_ref: "lic-1", outreach_allowed: true }).outreachAllowed).toBe(true);
});
