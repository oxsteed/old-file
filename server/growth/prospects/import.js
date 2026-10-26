"use strict";
// D23: licensed business-listing import.
//
// Every batch is declared against ONE licence (vendor, licence id/version,
// acquired date, expiry, permitted uses) and recorded in prospect_imports
// with the content hash, so the same file cannot be loaded twice and every
// record can be traced to the licence that allowed it. Records are never
// merged into user data: they are matched to existing OxSteed businesses
// only to EXCLUDE those businesses from outreach. Suppressed businesses
// (vendor id, name+country, hashed email or phone) never come back.
const crypto = require("crypto");
const { evaluate, rulesFor } = require("./outreach");

const COUNTRY = /^[A-Z]{2}$/;
const USES = ["supply_maps", "analytics", "internal_research", "marketing_outreach"];
const ENTITY_TYPES = new Set(["corporate", "sole_trader", "partnership", "unknown"]);
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const fail = (code, status = 400) => Object.assign(new Error(code), { statusCode: status, code });
function normalizeName(value) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, " ").slice(0, 240);
}
const sha = (v) => crypto.createHash("sha256").update(v).digest("hex");
function emailHash(email) {
  const e = String(email || "").trim().toLowerCase();
  return e ? sha(`email:${e}`) : null;
}
function phoneHash(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  return digits.length >= 6 ? sha(`phone:${digits}`) : null;
}

function validateLicense(l = {}, today = new Date().toISOString().slice(0, 10)) {
  const source = String(l.source || "").trim();
  const licenseRef = String(l.license_ref || "").trim();
  const licenseVersion = String(l.license_version || "").trim();
  const uses = Array.isArray(l.permitted_uses) ? [...new Set(l.permitted_uses)] : [];
  if (!source || source.length > 120 || !licenseRef || licenseRef.length > 240 || !licenseVersion || licenseVersion.length > 60)
    throw fail("prospect_license_invalid");
  if (!uses.length || uses.some((u) => !USES.includes(u))) throw fail("prospect_permitted_uses_invalid");
  if (!DATE.test(String(l.acquired_at || ""))) throw fail("prospect_acquired_at_invalid");
  if (l.license_expires_at != null && !DATE.test(String(l.license_expires_at))) throw fail("prospect_license_expiry_invalid");
  if (l.license_expires_at && l.license_expires_at < today) throw fail("prospect_license_expired", 409);
  return { source, licenseRef, licenseVersion, permittedUses: uses, acquiredAt: l.acquired_at, licenseExpiresAt: l.license_expires_at || null };
}

function validate(row, license) {
  const sourceRecordId = String(row.source_record_id || row.id || "").trim();
  const businessName = String(row.business_name || row.name || "").trim();
  const country = String(row.country || "").trim().toUpperCase();
  if (!sourceRecordId || sourceRecordId.length > 200 || !businessName || businessName.length > 240 || !COUNTRY.test(country))
    throw fail("invalid_prospect_record");
  const entityType = ENTITY_TYPES.has(row.entity_type) ? row.entity_type : "unknown";
  const email = row.contact_email ? String(row.contact_email).trim().slice(0, 320) : null;
  const website = row.website && /^https?:\/\//i.test(String(row.website)) ? String(row.website).slice(0, 500) : null;
  return {
    sourceRecordId,
    businessName,
    country,
    region: row.region ? String(row.region).trim().slice(0, 120) : null,
    postalCode: row.postal_code ? String(row.postal_code).trim().toUpperCase().slice(0, 32) : null,
    categoryCode: row.category_code ? String(row.category_code).trim().slice(0, 120) : null,
    entityType,
    email: email && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) ? email : null,
    phone: row.contact_phone ? String(row.contact_phone).trim().slice(0, 40) : null,
    website,
    provenance: {
      source: license.source,
      license_ref: license.licenseRef,
      license_version: license.licenseVersion,
      acquired_at: license.acquiredAt,
      license_expires_at: license.licenseExpiresAt,
      permitted_uses: license.permittedUses,
      vendor_record_id: sourceRecordId,
    },
  };
}

/**
 * importLicensedBatch(conn, { license, rows, fullSnapshot, actorId })
 * fullSnapshot=true means the file is the vendor's complete current list
 * for this source: records not in it are marked unusable (removed_by_vendor).
 */
async function importLicensedBatch(conn, { license: rawLicense, rows, fullSnapshot = false, actorId = null, env = process.env }) {
  if (env.GROWTH_PROSPECTS_ENABLED !== "true") return { disabled: true, imported: 0, suppressed: 0 };
  if (!Array.isArray(rows) || !rows.length || rows.length > 10000) throw fail("prospect_batch_invalid");
  const license = validateLicense(rawLicense);
  const contentSha = sha(JSON.stringify({ license: rawLicense, rows }));
  const { rows: [existing] } = await conn.query(
    "SELECT id FROM prospect_imports WHERE source=$1 AND content_sha256=$2",
    [license.source, contentSha],
  );
  if (existing) return { duplicate: true, import_id: existing.id };
  const { rows: [imp] } = await conn.query(
    `INSERT INTO prospect_imports (source, license_ref, license_version, permitted_uses, license_expires_at, acquired_at, content_sha256, imported_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
    [license.source, license.licenseRef, license.licenseVersion, license.permittedUses, license.licenseExpiresAt, license.acquiredAt, contentSha, actorId],
  );
  const outreachSwitch = env.GROWTH_PROSPECT_OUTREACH_ENABLED === "true";
  const counts = { imported: 0, suppressed: 0, matched_existing: 0, marked_unusable: 0, rejected: 0 };
  const valid = [];
  for (const raw of rows) {
    try {
      valid.push(validate(raw, license));
    } catch {
      counts.rejected += 1;
    }
  }
  const rules = await rulesFor(conn, valid.map((r) => r.country));
  for (const row of valid) {
    const normalized = normalizeName(row.businessName);
    const eh = emailHash(row.email);
    const ph = phoneHash(row.phone);
    const { rows: blocked } = await conn.query(
      `SELECT 1 FROM prospect_suppressions
        WHERE (source=$1 AND source_record_id=$2)
           OR (normalized_name=$3 AND country=$4)
           OR ($5::text IS NOT NULL AND email_hash=$5)
           OR ($6::text IS NOT NULL AND phone_hash=$6) LIMIT 1`,
      [license.source, row.sourceRecordId, normalized, row.country, eh, ph],
    );
    if (blocked[0]) {
      counts.suppressed += 1;
      continue;
    }
    // Exclusion-only match against businesses already on OxSteed.
    const { rows: [match] } = await conn.query(
      `SELECT id FROM businesses
        WHERE lower(regexp_replace(trim(business_name), '\\s+', ' ', 'g')) = $1
          AND ($2::text IS NULL OR upper(trim(address_zip)) = $2)
          AND (address_country IS NULL OR upper(address_country) = $3)
        ORDER BY id LIMIT 1`,
      [normalized, row.postalCode, row.country],
    );
    if (match) counts.matched_existing += 1;
    const { rows: [postal] } = row.postalCode
      ? await conn.query("SELECT id FROM geo_postal_centroids WHERE country=$1 AND upper(postal_code)=$2 ORDER BY id LIMIT 1", [row.country, row.postalCode])
      : { rows: [] };
    const decision = evaluate(rules.get(row.country), {
      channel: "email",
      entityType: row.entityType,
      permittedUses: license.permittedUses,
      matched: Boolean(match),
    });
    const outreachAllowed = outreachSwitch && decision.allowed;
    await conn.query(
      `INSERT INTO prospect_businesses
         (source, source_record_id, business_name, country, region, postal_code, license_ref, license_expires_at, provenance,
          outreach_country, outreach_allowed, outreach_status, permitted_uses, license_version, acquired_at, category_code,
          postal_ref, entity_type, contact_email, contact_phone, website, matched_business_id, usable, unusable_reason, last_import_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$4,$10,CASE WHEN $10 THEN 'eligible' ELSE 'not_started' END,$11,$12,$13,$14,
               $15,$16,$17,$18,$19,$20,TRUE,NULL,$21)
       ON CONFLICT (source, source_record_id) DO UPDATE SET
         business_name=EXCLUDED.business_name, country=EXCLUDED.country, region=EXCLUDED.region, postal_code=EXCLUDED.postal_code,
         license_ref=EXCLUDED.license_ref, license_expires_at=EXCLUDED.license_expires_at, provenance=EXCLUDED.provenance,
         outreach_country=EXCLUDED.outreach_country, outreach_allowed=EXCLUDED.outreach_allowed,
         outreach_status=CASE WHEN prospect_businesses.outreach_status IN ('contacted','closed','suppressed')
                              THEN prospect_businesses.outreach_status ELSE EXCLUDED.outreach_status END,
         permitted_uses=EXCLUDED.permitted_uses, license_version=EXCLUDED.license_version, acquired_at=EXCLUDED.acquired_at,
         category_code=EXCLUDED.category_code, postal_ref=EXCLUDED.postal_ref, entity_type=EXCLUDED.entity_type,
         contact_email=EXCLUDED.contact_email, contact_phone=EXCLUDED.contact_phone, website=EXCLUDED.website,
         matched_business_id=EXCLUDED.matched_business_id, usable=TRUE, unusable_reason=NULL,
         last_import_id=EXCLUDED.last_import_id, updated_at=NOW()`,
      [license.source, row.sourceRecordId, row.businessName, row.country, row.region, row.postalCode, license.licenseRef,
       license.licenseExpiresAt, JSON.stringify(row.provenance), outreachAllowed, license.permittedUses, license.licenseVersion,
       license.acquiredAt, row.categoryCode, postal?.id ?? null, row.entityType, row.email, row.phone, row.website,
       match?.id ?? null, imp.id],
    );
    counts.imported += 1;
  }
  // Licence expiry applies to every record of the source on each import.
  const expired = await conn.query(
    `UPDATE prospect_businesses SET usable=FALSE, unusable_reason='license_expired', outreach_allowed=FALSE, updated_at=NOW()
      WHERE source=$1 AND usable AND license_expires_at IS NOT NULL AND license_expires_at < CURRENT_DATE`,
    [license.source],
  );
  counts.marked_unusable += expired.rowCount || 0;
  if (fullSnapshot) {
    const removed = await conn.query(
      `UPDATE prospect_businesses SET usable=FALSE, unusable_reason='removed_by_vendor', outreach_allowed=FALSE, updated_at=NOW()
        WHERE source=$1 AND usable AND last_import_id IS DISTINCT FROM $2`,
      [license.source, imp.id],
    );
    counts.marked_unusable += removed.rowCount || 0;
  }
  await conn.query(
    `UPDATE prospect_imports SET imported=$2, suppressed=$3, matched_existing=$4, marked_unusable=$5, rejected=$6 WHERE id=$1`,
    [imp.id, counts.imported, counts.suppressed, counts.matched_existing, counts.marked_unusable, counts.rejected],
  );
  return { duplicate: false, import_id: imp.id, ...counts };
}

/** Permanent do-not-contact. Also closes matching live records. */
async function suppress(conn, { source = null, sourceRecordId = null, name = null, country = null, email = null, phone = null, reason, actorId = null }) {
  if (!reason || String(reason).length > 200) throw fail("prospect_suppression_reason_required");
  const normalized = name ? normalizeName(name) : null;
  const eh = emailHash(email);
  const ph = phoneHash(phone);
  const cc = country ? String(country).toUpperCase() : null;
  if (!(sourceRecordId && source) && !(normalized && cc) && !eh && !ph) throw fail("prospect_suppression_key_required");
  await conn.query(
    `INSERT INTO prospect_suppressions (source, source_record_id, normalized_name, country, email_hash, phone_hash, reason, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [source, sourceRecordId, normalized, cc, eh, ph, String(reason), actorId],
  );
  const closed = await conn.query(
    `UPDATE prospect_businesses SET outreach_allowed=FALSE, outreach_status='suppressed', updated_at=NOW()
      WHERE (source=$1 AND source_record_id=$2)
         OR ($3::text IS NOT NULL AND lower(regexp_replace(trim(business_name), '\\s+', ' ', 'g'))=$3 AND country=$4)
         OR ($5::text IS NOT NULL AND contact_email IS NOT NULL AND encode(sha256(convert_to('email:'||lower(trim(contact_email)),'UTF8')),'hex')=$5)
         OR ($6::text IS NOT NULL AND contact_phone IS NOT NULL AND encode(sha256(convert_to('phone:'||regexp_replace(contact_phone,'\\D','','g'),'UTF8')),'hex')=$6)`,
    [source, sourceRecordId, normalized, cc, eh, ph],
  );
  return { closed: closed.rowCount || 0 };
}

// Back-compat wrapper for the earlier single-licence-per-row API: rows must
// now share one declared licence, so this groups by nothing and refuses
// rows without the licence fields.
async function importProspects(conn, rows, defaults = {}) {
  if (process.env.GROWTH_PROSPECTS_ENABLED !== "true") return { disabled: true, imported: 0, suppressed: 0 };
  return importLicensedBatch(conn, { license: defaults.license, rows });
}

function suppressionKey(name, country) {
  return sha(`${String(country).toUpperCase()}|${normalizeName(name)}`);
}
module.exports = { normalizeName, validate, validateLicense, importLicensedBatch, importProspects, suppress, suppressionKey, emailHash, phoneHash, USES };
