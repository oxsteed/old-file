'use strict';
/**
 * Region-scoped analytics (decision 3).
 *
 * A super_admin or an admin with a current GLOBAL grant for a metric's
 * permission sees platform-wide rows. An admin whose only grants for that
 * permission are regional sees rows inside those regions only. Everything
 * here fails closed:
 *   - a regional grant whose region row is missing or whose boundary is not a
 *     known, valid shape contributes no territory; with no valid territory the
 *     request is refused (403 region_unknown);
 *   - every table a metric reads must have a declared geographic anchor below.
 *     A query touching any other table is refused for regional admins
 *     (403 region_scope_unsupported), so a new metric cannot leak global rows;
 *   - a row whose anchor has no location (no zip/city/state/country/coords)
 *     matches no region and is excluded.
 *
 * Mechanism: the metric's fixed SQL is executed unchanged, prefixed with
 * CTEs that shadow each base table by name with its region-filtered rows.
 * Regions travel as ONE bound JSONB parameter; nothing is interpolated.
 *
 * Anchors (where a row "is"):
 *   jobs                         job location (location_zip/city/state/country_code/lat/lng)
 *   disputes                     the disputed job's location
 *   payments, platform_ledger    the job's location; rows without a job use the payer/user address
 *   food_restaurants             the restaurant address
 *   food_orders, food_order_items  the restaurant's address
 *   main_app_payout_requests, subscriptions, consulting_sessions,
 *   consulting_session_feedback  the user's address (users.zip_code/city/state/country; geo_radius
 *                                via the US ZIP centroid). Decision 4: a user whose country is
 *                                unconfirmed counts under the stored country (users.country
 *                                defaults to 'US', migration 117) and is reported separately
 *                                via userCountryBreakdown().
 *   support_conversations, support_conversation_reviews  the customer's address
 *   demand_subject_daily, supply_subject_daily  the row's postal centroid
 *                                (geo_postal_centroids place fields)
 *   user_interest_profiles, offer_campaign_recipients, offer_preferences
 *                                the user's address
 *   offer_campaign_deliveries    the recipient's address (via recipient row)
 *   offer_clicks                 the recipient's address (via delivery)
 *   affiliate_conversions        the recipient's address (via click ->
 *                                delivery -> recipient)
 * Reference tables with no per-row geography (plans, support_sla_targets,
 * discount_codes) pass through; their rows are reached only through an
 * anchored table's filter.
 */

const AppError = require('../utils/appError');

const COUNTRY_RE = /^[A-Z]{2}$/;

// Normalize one admin_regions.boundary_definition. Returns null when the
// shape is unknown or invalid (fail closed: contributes no territory).
function normalizeBoundary(raw) {
  let def = raw;
  if (typeof def === 'string') { try { def = JSON.parse(def); } catch { return null; } }
  if (!def || typeof def !== 'object') return null;
  const str = (v) => (typeof v === 'string' ? v.trim() : '');
  switch (def.type) {
    case 'zip_range': {
      const ranges = (Array.isArray(def.ranges) ? def.ranges : [])
        .filter(r => Number.isInteger(r?.start) && Number.isInteger(r?.end) && r.start <= r.end)
        .map(r => ({ start: r.start, end: r.end }));
      return ranges.length && ranges.length === def.ranges.length ? { type: 'zip_range', ranges } : null;
    }
    case 'city_state': {
      const entries = (Array.isArray(def.entries) ? def.entries : [])
        .map(e => ({ city: str(e?.city).toLowerCase(), state: str(e?.state).toUpperCase() }))
        .filter(e => e.city && e.state);
      return entries.length && entries.length === def.entries.length ? { type: 'city_state', entries } : null;
    }
    case 'geo_radius': {
      const lat = Number(def.center?.lat), lng = Number(def.center?.lng), miles = Number(def.radius_miles);
      if (![lat, lng, miles].every(Number.isFinite) || Math.abs(lat) > 90 || Math.abs(lng) > 180 || miles <= 0) return null;
      return { type: 'geo_radius', lat, lng, radius_miles: miles };
    }
    case 'country_region': {
      const entries = (Array.isArray(def.entries) ? def.entries : [])
        .map(e => ({ country: str(e?.country).toUpperCase(), region: str(e?.region).toLowerCase() }))
        .filter(e => COUNTRY_RE.test(e.country) && e.region);
      return entries.length && entries.length === def.entries.length ? { type: 'country_region', entries } : null;
    }
    case 'country_only': {
      const countries = (Array.isArray(def.countries) ? def.countries : [])
        .map(c => str(c).toUpperCase()).filter(c => COUNTRY_RE.test(c));
      return countries.length && countries.length === def.countries.length ? { type: 'country_only', countries } : null;
    }
    default:
      return null;
  }
}

// SQL predicate: does a location (SQL expressions) fall in any region of
// the JSONB array bound at `ref`? Mirrors middleware/regionAuth matchers.
function locationInRegionsSql(loc, ref) {
  const zip = `NULLIF(substring(btrim(COALESCE((${loc.zip})::TEXT,'')) FROM '^[0-9]{1,5}'),'')::INT`;
  const city = `lower(btrim(COALESCE((${loc.city})::TEXT,'')))`;
  const stateU = `upper(btrim(COALESCE((${loc.state})::TEXT,'')))`;
  const stateL = `lower(btrim(COALESCE((${loc.state})::TEXT,'')))`;
  const country = `upper(btrim(COALESCE((${loc.country})::TEXT,'')))`;
  const lat = loc.lat ? `(${loc.lat})::FLOAT8` : 'NULL::FLOAT8';
  const lng = loc.lng ? `(${loc.lng})::FLOAT8` : 'NULL::FLOAT8';
  return `EXISTS (SELECT 1 FROM jsonb_array_elements(${ref}) __rg WHERE CASE __rg->>'type'
    WHEN 'zip_range' THEN EXISTS (SELECT 1 FROM jsonb_array_elements(__rg->'ranges') __z
      WHERE ${zip} BETWEEN (__z->>'start')::INT AND (__z->>'end')::INT)
    WHEN 'city_state' THEN EXISTS (SELECT 1 FROM jsonb_array_elements(__rg->'entries') __e
      WHERE ${city} <> '' AND __e->>'city' = ${city} AND __e->>'state' = ${stateU})
    WHEN 'geo_radius' THEN ${lat} IS NOT NULL AND ${lng} IS NOT NULL AND
      2 * 3958.7613 * asin(LEAST(1, sqrt(
        power(sin(radians(${lat} - (__rg->>'lat')::FLOAT8) / 2), 2) +
        cos(radians((__rg->>'lat')::FLOAT8)) * cos(radians(${lat})) *
        power(sin(radians(${lng} - (__rg->>'lng')::FLOAT8) / 2), 2)))) <= (__rg->>'radius_miles')::FLOAT8
    WHEN 'country_region' THEN EXISTS (SELECT 1 FROM jsonb_array_elements(__rg->'entries') __e
      WHERE ${stateL} <> '' AND __e->>'country' = ${country} AND __e->>'region' = ${stateL})
    WHEN 'country_only' THEN ${country} <> '' AND (__rg->'countries') ? ${country}
    ELSE FALSE END)`;
}

const JOB_LOC = (a) => ({ zip: `${a}.location_zip`, city: `${a}.location_city`, state: `${a}.location_state`,
  country: `COALESCE(NULLIF(${a}.location_country_code,''), ${a}.location_country)`, lat: `${a}.location_lat`, lng: `${a}.location_lng` });
// Decision 4: users count under their STORED country whether or not it is
// confirmed (migration 908). users.country defaults to 'US' (migration 117),
// so an unconfirmed 'US' may simply be the default; those users are flagged
// through userCountryBreakdown() rather than dropped. Coordinates: users have
// none; a US user's ZIP centroid from direct_geocode_cache stands in for
// geo_radius regions (no coordinates -> no geo_radius match, fail closed).
const USER_LOC = (a, g) => ({ zip: `${a}.zip_code`, city: `${a}.city`, state: `${a}.state`,
  country: `${a}.country`,
  ...(g ? { lat: `${g}.lat`, lng: `${g}.lng` } : {}) });
const USER_GEO = (a, g) => `LEFT JOIN LATERAL (
    SELECT __gc.lat, __gc.lng FROM direct_geocode_cache __gc
     WHERE upper(btrim(COALESCE(${a}.country, ''))) = 'US'
       AND __gc.zip_code = substring(btrim(COALESCE(${a}.zip_code, '')) FROM '^[0-9]{5}')
       AND __gc.lat IS NOT NULL AND __gc.lng IS NOT NULL
     ORDER BY __gc.updated_at DESC NULLS LAST LIMIT 1) ${g} ON TRUE`;
const RESTAURANT_LOC = (a) => ({ zip: `${a}.address_zip`, city: `${a}.address_city`, state: `${a}.address_state`,
  country: `${a}.address_country`, lat: `${a}.latitude`, lng: `${a}.longitude` });

const userIn = (col, ref) => `EXISTS (SELECT 1 FROM __rs_users __u ${USER_GEO('__u', '__ug')} WHERE __u.id = ${col} AND ${locationInRegionsSql(USER_LOC('__u', '__ug'), ref)})`;
const jobIn = (col, ref) => `EXISTS (SELECT 1 FROM __rs_jobs __j WHERE __j.id = ${col} AND ${locationInRegionsSql(JOB_LOC('__j'), ref)})`;
const restaurantIn = (col, ref) => `EXISTS (SELECT 1 FROM __rs_food_restaurants __r WHERE __r.id = ${col} AND ${locationInRegionsSql(RESTAURANT_LOC('__r'), ref)})`;
// Growth rollup rows (demand_subject_daily / supply_subject_daily) are
// located by their postal centroid: the centroid row itself is the anchor.
const POSTAL_LOC = (a) => ({ zip: `${a}.postal_code`, city: `${a}.place_name`, state: `${a}.admin1`,
  country: `${a}.country`, lat: `${a}.lat`, lng: `${a}.lng` });
const postalIn = (col, ref) => `EXISTS (SELECT 1 FROM __rs_geo_postal_centroids __g WHERE __g.id = ${col} AND ${locationInRegionsSql(POSTAL_LOC('__g'), ref)})`;
const recipientUserIn = (recipientIdCol, ref) =>
  `EXISTS (SELECT 1 FROM __rs_offer_campaign_recipients __r WHERE __r.id = ${recipientIdCol} AND ${userIn('__r.user_id', ref)})`;

// table -> { needs: base tables used by the predicate, predicate(ref) on alias t }
const ANCHORS = Object.freeze({
  jobs: { needs: [], predicate: (ref) => locationInRegionsSql(JOB_LOC('t'), ref) },
  disputes: { needs: ['jobs'], predicate: (ref) => jobIn('t.job_id', ref) },
  payments: { needs: ['jobs', 'users'], predicate: (ref) =>
    `CASE WHEN t.job_id IS NOT NULL THEN ${jobIn('t.job_id', ref)} ELSE ${userIn('t.payer_id', ref)} END` },
  platform_ledger: { needs: ['jobs', 'users'], predicate: (ref) =>
    `CASE WHEN t.job_id IS NOT NULL THEN ${jobIn('t.job_id', ref)} ELSE ${userIn('t.user_id', ref)} END` },
  main_app_payout_requests: { needs: ['users'], predicate: (ref) => userIn('t.user_id', ref) },
  subscriptions: { needs: ['users'], predicate: (ref) => userIn('t.user_id', ref) },
  consulting_sessions: { needs: ['users'], predicate: (ref) => userIn('t.user_id', ref) },
  consulting_session_feedback: { needs: ['users'], predicate: (ref) => userIn('t.user_id', ref) },
  support_conversations: { needs: ['users'], predicate: (ref) => userIn('t.customer_id', ref) },
  support_conversation_reviews: { needs: ['users'], predicate: (ref) => userIn('t.customer_id', ref) },
  food_restaurants: { needs: [], predicate: (ref) => locationInRegionsSql(RESTAURANT_LOC('t'), ref) },
  food_orders: { needs: ['food_restaurants'], predicate: (ref) => restaurantIn('t.restaurant_id', ref) },
  // Checkout promo redemptions (decision 2): jobs anchor on the job, food on
  // the restaurant, bookings on the customer's address.
  promo_redemptions: { needs: ['jobs', 'users', 'food_orders', 'food_restaurants'], predicate: (ref) =>
    `CASE t.surface
       WHEN 'job' THEN EXISTS (SELECT 1 FROM __rs_jobs __j WHERE __j.id::text = t.reference_id AND ${locationInRegionsSql(JOB_LOC('__j'), ref)})
       WHEN 'food' THEN EXISTS (SELECT 1 FROM __rs_food_orders __o WHERE __o.id::text = t.reference_id AND ${restaurantIn('__o.restaurant_id', ref)})
       ELSE ${userIn('t.user_id', ref)} END` },
  food_order_items: { needs: ['food_orders', 'food_restaurants'], predicate: (ref) =>
    `EXISTS (SELECT 1 FROM __rs_food_orders __o WHERE __o.id = t.order_id AND ${restaurantIn('__o.restaurant_id', ref)})` },
  // Growth engine tables (Demand & Sales Engine spec 21.1): rollup rows
  // anchor on their postal centroid; interest profiles and campaign rows
  // anchor on the person's address; conversions reach the recipient
  // through click -> delivery -> recipient.
  demand_subject_daily: { needs: ['geo_postal_centroids'], predicate: (ref) => postalIn('t.postal_ref', ref) },
  supply_subject_daily: { needs: ['geo_postal_centroids'], predicate: (ref) => postalIn('t.postal_ref', ref) },
  user_interest_profiles: { needs: ['users'], predicate: (ref) => userIn('t.user_id', ref) },
  offer_campaign_recipients: { needs: ['users'], predicate: (ref) => userIn('t.user_id', ref) },
  offer_preferences: { needs: ['users'], predicate: (ref) => userIn('t.user_id', ref) },
  offer_campaign_deliveries: { needs: ['offer_campaign_recipients', 'users'], predicate: (ref) =>
    recipientUserIn('t.recipient_id', ref) },
  offer_clicks: { needs: ['offer_campaign_deliveries', 'offer_campaign_recipients', 'users'], predicate: (ref) =>
    `EXISTS (SELECT 1 FROM __rs_offer_campaign_deliveries __d WHERE __d.id = t.delivery_id AND ${recipientUserIn('__d.recipient_id', ref)})` },
  affiliate_conversions: { needs: ['offer_clicks', 'offer_campaign_deliveries', 'offer_campaign_recipients', 'users'], predicate: (ref) =>
    `EXISTS (SELECT 1 FROM __rs_offer_clicks __c WHERE __c.click_id = t.click_id AND ${`EXISTS (SELECT 1 FROM __rs_offer_campaign_deliveries __d WHERE __d.id = __c.delivery_id AND ${recipientUserIn('__d.recipient_id', ref)})`})` },
});
const PASS_THROUGH = new Set(['plans', 'support_sla_targets', 'discount_codes']);

const SQL_WORDS = new Set(['select', 'lateral', 'only', 'unnest', 'jsonb_array_elements', 'jsonb_array_elements_text',
  'generate_series', 'values']);

// Base tables referenced by a fixed analytics SQL template.
function referencedTables(text) {
  const cteNames = new Set([...text.matchAll(/(?:\bWITH\s+|,\s*)([a-z_][a-z0-9_]*)\s+AS\s+(?:NOT\s+MATERIALIZED\s+|MATERIALIZED\s+)?\(/gi)]
    .map(m => m[1].toLowerCase()));
  // EXTRACT(x FROM expr) / substring(x FROM ...) / trim(... FROM ...) are not table references.
  const stripped = text.replace(/\b(EXTRACT|SUBSTRING|TRIM|OVERLAY|POSITION)\s*\(([^()]|\([^()]*\))*\)/gi, ' ');
  const tables = new Set();
  for (const m of stripped.matchAll(/\b(?:FROM|JOIN)\s+([a-z_][a-z0-9_]*(?:\.[a-z_][a-z0-9_]*)?)(\s*\()?/gi)) {
    const name = m[1].toLowerCase();
    if (m[2] || SQL_WORDS.has(name) || cteNames.has(name)) continue;
    tables.add(name);
  }
  return tables;
}

/**
 * Wrap a fixed SQL template so every base table it reads is filtered to the
 * scope's regions. Returns { text, params } (other properties preserved).
 * Throws 403 region_scope_unsupported for any table without an anchor.
 */
function applyRegionScope(built, scope) {
  if (!scope || scope.global) return built;
  const text = String(built.text);
  const params = Array.isArray(built.params) ? [...built.params] : [];
  if (/\bWITH\s+RECURSIVE\b/i.test(text)) {
    throw new AppError('This metric cannot be limited to your regions', 403, 'region_scope_unsupported');
  }
  const tables = referencedTables(text);
  const shadow = [];
  for (const table of tables) {
    if (PASS_THROUGH.has(table)) continue;
    if (!Object.hasOwn(ANCHORS, table)) {
      throw new AppError('This metric cannot be limited to your regions', 403, 'region_scope_unsupported', { table });
    }
    shadow.push(table);
  }
  if (!shadow.length) return built;
  params.push(JSON.stringify(scope.regions));
  const ref = `$${params.length}::JSONB`;
  const bases = new Set();
  for (const table of shadow) { bases.add(table); for (const n of ANCHORS[table].needs) bases.add(n); }
  const baseCtes = [...bases].map(b => `__rs_${b} AS NOT MATERIALIZED (SELECT * FROM ${b})`);
  const shadowCtes = shadow.map(t => `${t} AS NOT MATERIALIZED (SELECT t.* FROM __rs_${t} t WHERE ${ANCHORS[t].predicate(ref)})`);
  const prefix = [...baseCtes, ...shadowCtes].join(',\n');
  const trimmed = text.replace(/^\s+/, '');
  const scoped = /^WITH\s/i.test(trimmed)
    ? `WITH ${prefix},\n${trimmed.replace(/^WITH\s+/i, '')}`
    : `WITH ${prefix}\n${trimmed}`;
  return { ...built, text: scoped, params };
}

/** Tables in a fixed SQL template whose region anchor can be a user address. */
function userAnchoredTables(text) {
  return [...referencedTables(String(text))].filter(t => Object.hasOwn(ANCHORS, t) && ANCHORS[t].needs.includes('users'));
}

/**
 * Decision 4: for a regional scope over user-anchored data, how many users
 * inside the territory have a confirmed vs an unconfirmed country. Returns
 * null for global scopes or metrics with no user anchor.
 */
async function userCountryBreakdown(db, scope, texts) {
  if (!scope || scope.global) return null;
  const tables = [...new Set([].concat(texts).flatMap(t => userAnchoredTables(t)))];
  if (!tables.length) return null;
  const { rows } = await db.query(
    `SELECT COUNT(*) FILTER (WHERE __u.country_confirmed IS TRUE)::INT AS confirmed,
            COUNT(*) FILTER (WHERE __u.country_confirmed IS NOT TRUE)::INT AS unconfirmed
       FROM users __u ${USER_GEO('__u', '__ug')}
      WHERE ${locationInRegionsSql(USER_LOC('__u', '__ug'), '$1::JSONB')}`,
    [JSON.stringify(scope.regions)]
  );
  return {
    basis: 'stored_country',
    defaultCountry: 'US',
    confirmed: Number(rows[0]?.confirmed || 0),
    unconfirmed: Number(rows[0]?.unconfirmed || 0),
    tables,
  };
}

/** A db/client wrapper whose query() applies the region scope. */
function regionScopedDb(db, scope) {
  if (!scope || scope.global) return db;
  return {
    query(text, params) {
      if (text && typeof text === 'object') {
        const wrapped = applyRegionScope({ text: text.text, params: text.values || [] }, scope);
        return db.query({ ...text, text: wrapped.text, values: wrapped.params });
      }
      const wrapped = applyRegionScope({ text, params: params || [] }, scope);
      return db.query(wrapped.text, wrapped.params);
    },
    connect: db.connect ? async () => {
      const client = await db.connect();
      const scoped = regionScopedDb(client, scope);
      scoped.release = (...args) => client.release(...args);
      return scoped;
    } : undefined,
  };
}

/** Whether a metric's SQL can be region-scoped (all tables anchored). */
function supportsRegionScope(builtList) {
  try {
    for (const built of builtList) applyRegionScope(built, { global: false, regions: [] });
    return true;
  } catch (err) {
    if (err.code === 'region_scope_unsupported') return false;
    throw err;
  }
}

module.exports = {
  ANCHORS, PASS_THROUGH, normalizeBoundary, locationInRegionsSql, referencedTables,
  applyRegionScope, regionScopedDb, supportsRegionScope, userAnchoredTables, userCountryBreakdown,
};
