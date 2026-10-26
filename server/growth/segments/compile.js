"use strict";
const { predicate } = require("../access");
const { ROLE_SQL } = require("../roles");
const { locationInRegionsSql } = require("../../analytics/regionScope");
const { normalizeBoundary } = require("../../analytics/regionScope");
const { TEMPLATES, validateFact, compileFact } = require("./facts");
const { MODELS: PROPENSITY_MODELS } = require("../propensity");
const allowed = new Set([
  "roles",
  "area",
  "intents",
  "lifecycle",
  "languages",
  "countries",
  "facts",
  "propensity",
  "exclude",
]);
const roles = ["customer", "helper", "business", "restaurant", "broker"];
const int = (n, min, max) => Number.isInteger(n) && n >= min && n <= max;
const EXCLUDE_TOKEN = /^(contacted_in_days|dismissed_intent_in_days):(\d{1,4})$/;
function validate(def) {
  if (
    !def ||
    typeof def !== "object" ||
    Array.isArray(def) ||
    Object.keys(def).some((k) => !allowed.has(k))
  )
    throw new Error("invalid_segment");
  // D23: prospects are not users; their segments live in
  // growth/prospects/segment.js and never feed in-app/push campaigns.
  if (Array.isArray(def?.roles) && def.roles.includes("prospect_business"))
    throw new Error("prospect_segment_not_user_audience");
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
    } else if (a.type === "admin_region") {
      if (
        Object.keys(a).some((k) => !["type", "region_id"].includes(k)) ||
        !int(a.region_id, 1, 2147483647)
      )
        throw new Error("invalid_segment_area");
    } else if (a.type === "cluster") {
      if (
        Object.keys(a).some((k) => !["type", "cluster_id"].includes(k)) ||
        typeof a.cluster_id !== "string" ||
        !/^[A-Za-z0-9_-]{1,120}$/.test(a.cluster_id)
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
  if (def.lifecycle) {
    const l = def.lifecycle;
    if (
      typeof l !== "object" ||
      Array.isArray(l) ||
      Object.keys(l).some(
        (k) =>
          !["last_active_within_days", "account_age_min_days", "verified"].includes(k),
      ) ||
      (l.account_age_min_days != null && !int(l.account_age_min_days, 14, 3650)) ||
      (l.last_active_within_days != null &&
        !int(l.last_active_within_days, 1, 3650)) ||
      (l.verified != null && typeof l.verified !== "boolean")
    )
      throw new Error("invalid_segment_lifecycle");
  }
  if (
    def.facts &&
    (!Array.isArray(def.facts) ||
      def.facts.length > 10 ||
      def.facts.some((f) => !validateFact(f)))
  )
    throw new Error("invalid_segment_fact");
  if (def.propensity) {
    const p = def.propensity;
    if (
      typeof p !== "object" ||
      Array.isArray(p) ||
      Object.keys(p).some((k) => !["model", "min_decile"].includes(k)) ||
      !Object.hasOwn(PROPENSITY_MODELS, p.model || "") ||
      !int(p.min_decile, 1, 10)
    )
      throw new Error("invalid_segment_propensity");
  }
  if (
    def.exclude &&
    (!Array.isArray(def.exclude) ||
      def.exclude.length > 10 ||
      def.exclude.some((x) => {
        const m = typeof x === "string" ? EXCLUDE_TOKEN.exec(x) : null;
        return !m || !int(Number(m[2]), 1, 3650);
      }))
  )
    throw new Error("invalid_segment_exclude");
  return def;
}

// admin_region and cluster areas reference rows that only exist in the
// database, so evaluation resolves them first and compile stays pure.
// An area that no longer resolves matches nobody (fail closed): the
// segment evaluates empty instead of silently widening.
async function resolveArea(conn, def) {
  if (def.area?.type === "admin_region") {
    const {
      rows: [region],
    } = await conn.query(
      "SELECT boundary_definition FROM admin_regions WHERE id=$1",
      [def.area.region_id],
    );
    const boundary = region ? normalizeBoundary(region.boundary_definition) : null;
    return { adminRegions: boundary ? [boundary] : null };
  }
  if (def.area?.type === "cluster") {
    // Cluster ids are the numeric row ids pinned by the writers; anything
    // else is unresolvable and fails closed instead of throwing a pg type
    // error on the bigint comparison.
    if (!/^\d+$/.test(String(def.area.cluster_id)))
      return { clusterPostalRefs: null };
    const {
      rows: [cluster],
    } = await conn.query(
      "SELECT postal_refs FROM growth_clusters WHERE id=$1",
      [def.area.cluster_id],
    );
    return { clusterPostalRefs: cluster?.postal_refs?.length ? cluster.postal_refs : null };
  }
  return {};
}

function compile(def, boundary = { global: false, regions: [] }, resolved = {}) {
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
  // Lifecycle: last activity is users.last_login_at (the only activity
  // timestamp the users table carries); verified is the Stripe Identity
  // flag on the user row.
  if (def.lifecycle?.last_active_within_days != null)
    where.push(
      `u.last_login_at>=NOW()-make_interval(days=>${bind(def.lifecycle.last_active_within_days)}::int)`,
    );
  if (def.lifecycle?.verified != null)
    where.push(`COALESCE(u.identity_verified,FALSE)=${bind(def.lifecycle.verified)}::boolean`);
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
  if (a?.type === "admin_region") {
    if (!resolved.adminRegions) where.push("FALSE");
    else
      where.push(
        locationInRegionsSql(
          {
            zip: "g.postal_code",
            city: "g.place_name",
            state: "g.admin1",
            country: "g.country",
            lat: "g.lat",
            lng: "g.lng",
          },
          `${bind(JSON.stringify(resolved.adminRegions))}::jsonb`,
        ),
      );
  }
  if (a?.type === "cluster") {
    if (!resolved.clusterPostalRefs) where.push("FALSE");
    else where.push(`g.id=ANY(${bind(resolved.clusterPostalRefs)}::int[])`);
  }
  for (const i of def.intents || [])
    where.push(`EXISTS(SELECT 1 FROM user_interest_profiles p JOIN demand_taxonomy_nodes n ON n.id=p.node_id
    WHERE p.user_id=u.id AND n.code=${bind(i.code)} AND NOT n.sensitive AND n.status='active'
    AND p.score>=${bind(i.min_score)} AND p.last_seen>=NOW()-make_interval(days=>${bind(i.window_days)}::int)
    AND NOT EXISTS(SELECT 1 FROM growth_intent_dismissals x WHERE x.user_id=u.id AND x.node_id=n.id AND x.expires_at>NOW()))`);
  for (const f of def.facts || []) where.push(compileFact(bind, f));
  if (def.propensity) {
    const p = def.propensity;
    // Minimum decile d means the score sits at or above the (d-1)/10
    // percentile of everyone scored by that model. No scores yet means
    // the COALESCE threshold of 2 matches nobody (fail closed).
    where.push(`EXISTS(SELECT 1 FROM propensity_scores ps WHERE ps.user_id=u.id AND ps.model=${bind(p.model)}
    AND ps.score>=(SELECT COALESCE(percentile_cont(${bind((p.min_decile - 1) / 10)}) WITHIN GROUP (ORDER BY score),2)
      FROM propensity_scores WHERE model=${bind(p.model)}))`);
  }
  for (const x of def.exclude || []) {
    const [, kind, days] = EXCLUDE_TOKEN.exec(x);
    if (kind === "contacted_in_days")
      where.push(
        `NOT EXISTS(SELECT 1 FROM marketing_contact_log mcl WHERE mcl.user_id=u.id AND mcl.contacted_at>=NOW()-make_interval(days=>${bind(Number(days))}::int))`,
      );
    else
      where.push(
        `NOT EXISTS(SELECT 1 FROM growth_intent_dismissals xd WHERE xd.user_id=u.id AND xd.created_at>=NOW()-make_interval(days=>${bind(Number(days))}::int))`,
      );
  }
  return {
    sql: `SELECT DISTINCT u.id,u.role,u.preferred_language,u.country FROM users u
    JOIN growth_subject_eligibility e ON e.user_id=u.id
    LEFT JOIN LATERAL (SELECT * FROM geo_postal_centroids z WHERE u.country_confirmed
      AND z.country=u.country AND z.postal_code=u.zip_code ORDER BY z.id LIMIT 1) g ON TRUE
    WHERE ${where.join(" AND ")} ORDER BY u.id LIMIT 100001`,
    params,
  };
}
// N-01 / D10: whether a segment definition targets people by their
// activity. Intents, activity facts, propensity scores, behavioural clusters
// and recent-activity lifecycle clauses are personalized; role, country,
// region/postal area, language, account age and verification are broad.
// Mirrored in SQL by growth_segment_is_personalized() (migration 99989),
// which forces offer_campaigns.is_personalized for these segments.
function isPersonalized(def) {
  if (!def || typeof def !== "object") return true;
  return Boolean(
    (Array.isArray(def.intents) && def.intents.length > 0) ||
      (Array.isArray(def.facts) && def.facts.length > 0) ||
      (def.propensity && typeof def.propensity === "object") ||
      def.area?.type === "cluster" ||
      typeof def.lifecycle?.last_active_within_days === "number",
  );
}
// The campaign flag can only make a campaign MORE protective: a broad
// label on a personalized segment is ignored.
function effectivePersonalized(flag, def) {
  return flag !== false || isPersonalized(def);
}
async function evaluate(
  conn,
  definition,
  boundary,
  purpose = "activity_offers",
  { userId, personalized = true } = {},
) {
  personalized = effectivePersonalized(personalized, definition);
  const gate = require("../gate");
  if (!gate.rolloutAllows(await gate.runtimePolicy(conn)).allowed) return [];
  const resolved = await resolveArea(conn, definition);
  let { sql, params } = compile(definition, boundary, resolved);
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
    const permission = await gate.allow(contexts.get(row.id), purpose, {
      personalized,
    });
    if (permission.allowed) approved.push(row);
  }
  return approved;
}
module.exports = { validate, compile, evaluate, resolveArea, isPersonalized, effectivePersonalized, FACT_TEMPLATES: TEMPLATES };
