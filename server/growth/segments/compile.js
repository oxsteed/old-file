"use strict";
const { predicate } = require("../access");
const { ROLE_SQL } = require("../roles");
const allowed = new Set([
  "roles",
  "area",
  "intents",
  "lifecycle",
  "languages",
  "countries",
  "facts",
  "exclude",
]);
const roles = ["customer", "helper", "business", "restaurant", "broker"];
const int = (n, min, max) => Number.isInteger(n) && n >= min && n <= max;
function validate(def) {
  if (
    !def ||
    typeof def !== "object" ||
    Array.isArray(def) ||
    Object.keys(def).some((k) => !allowed.has(k))
  )
    throw new Error("invalid_segment");
  if (
    !Array.isArray(def.roles) ||
    !def.roles.length ||
    def.roles.some((r) => !roles.includes(r))
  )
    throw new Error("invalid_segment_roles");
  if (
    def.languages &&
    (!Array.isArray(def.languages) ||
      def.languages.length > 20 ||
      def.languages.some((s) => !/^[a-z]{2}$/.test(s)))
  )
    throw new Error("invalid_segment_languages");
  if (
    def.countries &&
    (!Array.isArray(def.countries) ||
      def.countries.length > 250 ||
      def.countries.some((s) => !/^[A-Z]{2}$/.test(s)))
  )
    throw new Error("invalid_segment_countries");
  if (def.area) {
    const a = def.area;
    if (a.type === "country") {
      if (
        Object.keys(a).some((k) => !["type", "country"].includes(k)) ||
        !/^[A-Z]{2}$/.test(a.country)
      )
        throw new Error("invalid_segment_area");
    } else if (a.type === "postal_list") {
      if (
        Object.keys(a).some((k) => !["type", "ids"].includes(k)) ||
        !Array.isArray(a.ids) ||
        a.ids.length > 1000 ||
        !a.ids.length ||
        a.ids.some((n) => !int(n, 1, 2147483647))
      )
        throw new Error("invalid_segment_area");
    } else if (a.type === "radius") {
      if (
        Object.keys(a).some(
          (k) => !["type", "centroid_id", "miles"].includes(k),
        ) ||
        !int(a.centroid_id, 1, 2147483647) ||
        !(Number.isFinite(a.miles) && a.miles > 0 && a.miles <= 300)
      )
        throw new Error("invalid_segment_area");
    } else throw new Error("unsupported_segment_area");
  }
  if (
    def.intents &&
    (!Array.isArray(def.intents) ||
      def.intents.length > 10 ||
      def.intents.some(
        (i) =>
          !i ||
          Object.keys(i).some(
            (k) => !["code", "min_score", "window_days"].includes(k),
          ) ||
          !/^[a-z][a-z0-9_.]{1,120}$/.test(i.code) ||
          !Number.isFinite(i.min_score) ||
          i.min_score < 0 ||
          i.min_score > 1 ||
          !int(i.window_days, 1, 395),
      ))
  )
    throw new Error("invalid_segment_intents");
  if (
    def.lifecycle &&
    (Object.keys(def.lifecycle).some(
      (k) => !["account_age_min_days"].includes(k),
    ) ||
      !int(def.lifecycle.account_age_min_days, 14, 3650))
  )
    throw new Error("invalid_segment_lifecycle");
  // Never silently ignore unsupported targeting clauses.
  if (def.facts?.length || def.exclude?.length)
    throw new Error("unsupported_segment_clause");
  return def;
}
function compile(def, boundary = { global: false, regions: [] }) {
  validate(def);
  const params = [];
  const bind = (v) => {
    params.push(v);
    return `$${params.length}`;
  };
  const where = [
    `${ROLE_SQL}=ANY(${bind(def.roles)}::text[])`,
    "u.is_active=TRUE",
    "u.is_banned=FALSE",
    "u.deleted_at IS NULL",
    "COALESCE(u.is_suspended,FALSE)=FALSE",
    "e.adult_confirmed=TRUE",
    "e.is_internal=FALSE",
    `u.created_at<=NOW()-make_interval(days=>${bind(Math.max(14, def.lifecycle?.account_age_min_days || 14))}::int)`,
    predicate(boundary, "g", params),
  ];
  if (def.languages)
    where.push(`u.preferred_language=ANY(${bind(def.languages)}::text[])`);
  if (def.countries)
    where.push(
      `u.country_confirmed AND u.country=ANY(${bind(def.countries)}::text[])`,
    );
  const a = def.area;
  if (a?.type === "country") where.push(`g.country=${bind(a.country)}`);
  if (a?.type === "postal_list") where.push(`g.id=ANY(${bind(a.ids)}::int[])`);
  if (a?.type === "radius")
    where.push(
      `ST_DWithin(g.geog,(SELECT geog FROM geo_postal_centroids WHERE id=${bind(a.centroid_id)}),${bind(a.miles * 1609.344)})`,
    );
  for (const i of def.intents || [])
    where.push(`EXISTS(SELECT 1 FROM user_interest_profiles p JOIN demand_taxonomy_nodes n ON n.id=p.node_id
    WHERE p.user_id=u.id AND n.code=${bind(i.code)} AND NOT n.sensitive AND n.status='active'
    AND p.score>=${bind(i.min_score)} AND p.last_seen>=NOW()-make_interval(days=>${bind(i.window_days)}::int)
    AND NOT EXISTS(SELECT 1 FROM growth_intent_dismissals x WHERE x.user_id=u.id AND x.node_id=n.id AND x.expires_at>NOW()))`);
  return {
    sql: `SELECT DISTINCT u.id,u.role,u.preferred_language,u.country FROM users u
    JOIN growth_subject_eligibility e ON e.user_id=u.id
    LEFT JOIN LATERAL (SELECT * FROM geo_postal_centroids z WHERE u.country_confirmed
      AND z.country=u.country AND z.postal_code=u.zip_code ORDER BY z.id LIMIT 1) g ON TRUE
    WHERE ${where.join(" AND ")} ORDER BY u.id LIMIT 100001`,
    params,
  };
}
async function evaluate(
  conn,
  definition,
  boundary,
  purpose = "activity_offers",
  { userId } = {},
) {
  const gate = require("../gate");
  if (!gate.rolloutAllows(await gate.runtimePolicy(conn)).allowed) return [];
  let { sql, params } = compile(definition, boundary);
  if (userId) {
    params.push(userId);
    sql = sql.replace(
      " ORDER BY u.id LIMIT 100001",
      ` AND u.id=$${params.length}::uuid ORDER BY u.id LIMIT 100001`,
    );
  }
  const { rows } = await conn.query(sql, params);
  if (rows.length > 100000) throw new Error("segment_requires_partitioning");
  const approved = [];
  const contexts = await gate.contexts(
    rows.map((r) => r.id),
    { db: conn },
  );
  const deadline = Date.now() + 30000;
  for (const row of rows) {
    if (Date.now() > deadline) throw new Error("segment_timeout");
    const permission = await gate.allow(contexts.get(row.id), purpose);
    if (permission.allowed) approved.push(row);
  }
  return approved;
}
module.exports = { validate, compile, evaluate };
