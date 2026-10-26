"use strict";
// D23: the `prospect_business` segment role. Prospects are not users, so a
// prospect segment never feeds in-app or push campaigns; it is used only
// for supply maps (counts) and for the audited outreach export. Filters are
// limited to area and category, as the spec requires.
const { evaluate, rulesFor } = require("./outreach");

const PURPOSES = new Set(["supply_maps", "outreach"]);

function validateDefinition(def) {
  if (!def || !Array.isArray(def.roles) || def.roles.length !== 1 || def.roles[0] !== "prospect_business")
    throw Object.assign(new Error("invalid_prospect_segment"), { statusCode: 400, code: "invalid_prospect_segment" });
  const allowed = new Set(["roles", "area", "categories"]);
  if (Object.keys(def).some((k) => !allowed.has(k)))
    throw Object.assign(new Error("prospect_segment_filters_limited"), { statusCode: 400, code: "prospect_segment_filters_limited" });
  const area = def.area || {};
  if (!/^[A-Z]{2}$/.test(String(area.country || "")))
    throw Object.assign(new Error("prospect_segment_country_required"), { statusCode: 400, code: "prospect_segment_country_required" });
  if (area.region != null && (typeof area.region !== "string" || area.region.length > 120))
    throw Object.assign(new Error("invalid_prospect_segment"), { statusCode: 400, code: "invalid_prospect_segment" });
  if (area.postal_codes != null && (!Array.isArray(area.postal_codes) || area.postal_codes.length > 500))
    throw Object.assign(new Error("invalid_prospect_segment"), { statusCode: 400, code: "invalid_prospect_segment" });
  if (def.categories != null && (!Array.isArray(def.categories) || def.categories.length > 50))
    throw Object.assign(new Error("invalid_prospect_segment"), { statusCode: 400, code: "invalid_prospect_segment" });
  return {
    country: area.country,
    region: area.region || null,
    postalCodes: (area.postal_codes || []).map((p) => String(p).toUpperCase().slice(0, 32)),
    categories: (def.categories || []).map((c) => String(c).slice(0, 120)),
  };
}

async function members(conn, def, { purpose = "supply_maps", channel = "email", limit = 5000 } = {}) {
  if (!PURPOSES.has(purpose)) throw Object.assign(new Error("invalid_prospect_purpose"), { statusCode: 400, code: "invalid_prospect_purpose" });
  const f = validateDefinition(def);
  const use = purpose === "outreach" ? "marketing_outreach" : "supply_maps";
  const { rows } = await conn.query(
    `SELECT p.id, p.source, p.source_record_id, p.business_name, p.country, p.region, p.postal_code, p.category_code,
            p.entity_type, p.contact_email, p.contact_phone, p.website, p.permitted_uses, p.license_ref, p.license_version,
            p.matched_business_id, p.usable, p.outreach_allowed, p.outreach_status
       FROM prospect_businesses p
      WHERE p.usable AND p.country=$1
        AND ($2::text IS NULL OR p.region=$2)
        AND (cardinality($3::text[])=0 OR upper(p.postal_code)=ANY($3::text[]))
        AND (cardinality($4::text[])=0 OR p.category_code=ANY($4::text[]))
        AND $5 = ANY(p.permitted_uses)
        AND p.matched_business_id IS NULL
      ORDER BY p.id LIMIT $6`,
    [f.country, f.region, f.postalCodes, f.categories, use, Math.min(Math.max(1, Number(limit) || 5000), 50000)],
  );
  if (purpose !== "outreach") return { count: rows.length, rows: [] };
  const rules = await rulesFor(conn, [f.country]);
  const eligible = [];
  const refused = {};
  for (const r of rows) {
    const d = evaluate(rules.get(r.country), {
      channel,
      entityType: r.entity_type,
      permittedUses: r.permitted_uses,
      usable: r.usable,
      matched: Boolean(r.matched_business_id),
      suppressed: r.outreach_status === "suppressed",
    });
    if (d.allowed && r.outreach_allowed) eligible.push({ ...r, outreach_requirements: d.requirements, outreach_law: d.law });
    else refused[d.allowed ? "outreach_switch_off" : d.reason] = (refused[d.allowed ? "outreach_switch_off" : d.reason] || 0) + 1;
  }
  return { count: eligible.length, rows: eligible, refused };
}

module.exports = { validateDefinition, members };
