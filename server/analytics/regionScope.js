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
 *   consulting_session_feedback  the user's address (users.zip_code/city/state/country)
 *   support_conversations, support_conversation_reviews  the customer's address
 * Reference tables with no per-row geography (plans, support_sla_targets) pass through.
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
const USER_LOC = (a) => ({ zip: `${a}.zip_code`, city: `${a}.city`, state: `${a}.state`, country: `${a}.country` });
const RESTAURANT_LOC = (a) => ({ zip: `${a}.address_zip`, city: `${a}.address_city`, state: `${a}.address_state`,
  country: `${a}.address_country`, lat: `${a}.latitude`, lng: `${a}.longitude` });

const userIn = (col, ref) => `EXISTS (SELECT 1 FROM __rs_users __u WHERE __u.id = ${col} AND ${locationInRegionsSql(USER_LOC('__u'), ref)})`;
const jobIn = (col, ref) => `EXISTS (SELECT 1 FROM __rs_jobs __j WHERE __j.id = ${col} AND ${locationInRegionsSql(JOB_LOC('__j'), ref)})`;
const restaurantIn = (col, ref) => `EXISTS (SELECT 1 FROM __rs_food_restaurants __r WHERE __r.id = ${col} AND ${locationInRegionsSql(RESTAURANT_LOC('__r'), ref)})`;

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
});
const PASS_THROUGH = new Set(['plans', 'support_sla_targets']);

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
  applyRegionScope, regionScopedDb, supportsRegionScope,
};
