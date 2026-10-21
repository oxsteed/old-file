"use strict";
const crypto = require("crypto");

const COUNTRY = /^[A-Z]{2}$/;
function normalizeName(value) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, " ").slice(0, 240);
}
function validate(row, defaults = {}) {
  const source = String(row.source || defaults.source || "").trim();
  const sourceRecordId = String(row.source_record_id || row.id || "").trim();
  const businessName = String(row.business_name || row.name || "").trim();
  const country = String(row.country || defaults.country || "").trim().toUpperCase();
  const licenseRef = String(row.license_ref || defaults.licenseRef || "").trim();
  if (!source || source.length > 120 || !sourceRecordId || sourceRecordId.length > 200 || !businessName || businessName.length > 240 || !COUNTRY.test(country) || !licenseRef || licenseRef.length > 240)
    throw new Error("invalid_prospect_record");
  return {
    source,
    sourceRecordId,
    businessName,
    country,
    region: row.region ? String(row.region).trim().slice(0, 120) : null,
    postalCode: row.postal_code ? String(row.postal_code).trim().slice(0, 32) : null,
    licenseRef,
    licenseExpiresAt: row.license_expires_at || null,
    provenance: {
      ...(row.provenance && typeof row.provenance === "object" ? row.provenance : {}),
      source,
      license_ref: licenseRef,
      imported_at: new Date().toISOString(),
    },
    outreachCountry: row.outreach_country ? String(row.outreach_country).toUpperCase() : null,
    outreachAllowed: row.outreach_allowed === true && process.env.GROWTH_PROSPECT_OUTREACH_ENABLED === "true",
  };
}

async function importProspects(conn, rows, defaults = {}) {
  if (process.env.GROWTH_PROSPECTS_ENABLED !== "true") return { disabled: true, imported: 0, suppressed: 0 };
  if (!Array.isArray(rows) || rows.length > 10000) throw new Error("prospect_batch_invalid");
  let imported = 0;
  let suppressed = 0;
  for (const raw of rows) {
    const row = validate(raw, defaults);
    const normalized = normalizeName(row.businessName);
    const { rows: blocked } = await conn.query(
      `SELECT 1 FROM prospect_suppressions
        WHERE (source=$1 AND source_record_id=$2)
           OR (normalized_name=$3 AND country=$4) LIMIT 1`,
      [row.source, row.sourceRecordId, normalized, row.country],
    );
    if (blocked[0]) {
      suppressed++;
      continue;
    }
    await conn.query(
      `INSERT INTO prospect_businesses
       (source,source_record_id,business_name,country,region,postal_code,license_ref,license_expires_at,provenance,outreach_country,outreach_allowed,outreach_status)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,CASE WHEN $11 THEN 'eligible' ELSE 'not_started' END)
       ON CONFLICT(source,source_record_id) DO UPDATE SET
         business_name=EXCLUDED.business_name,region=EXCLUDED.region,postal_code=EXCLUDED.postal_code,
         license_ref=EXCLUDED.license_ref,license_expires_at=EXCLUDED.license_expires_at,
         provenance=EXCLUDED.provenance,outreach_country=EXCLUDED.outreach_country,
         outreach_allowed=EXCLUDED.outreach_allowed,updated_at=NOW()`,
      [row.source, row.sourceRecordId, row.businessName, row.country, row.region, row.postalCode, row.licenseRef, row.licenseExpiresAt, JSON.stringify(row.provenance), row.outreachCountry, row.outreachAllowed],
    );
    imported++;
  }
  return { imported, suppressed };
}

function suppressionKey(name, country) {
  return crypto.createHash("sha256").update(`${String(country).toUpperCase()}|${normalizeName(name)}`).digest("hex");
}
module.exports = { normalizeName, validate, importProspects, suppressionKey };
