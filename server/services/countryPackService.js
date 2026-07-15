// server/services/countryPackService.js
//
// Country pack registry (docs/oxsteed-pack-architecture.md §5).
// A country is a pack you register, never a condition you check. This service
// is the ONLY module that reads country_packs; everything else consumes the
// resolved config object.
//
// Fail-open: if migration 304 has not been applied, we serve the built-in US
// pack and an empty coming-soon list so the app keeps working.

const pool = require('../db');
const logger = require('../utils/logger');

const CACHE_TTL_MS = 60 * 1000;
let cache = { at: 0, list: null, configs: new Map() };

// Built-in fallback: US pack #1 (kept in sync with migration 304 seed).
const FALLBACK_US = {
  code: 'US',
  name: 'United States',
  flag_emoji: '🇺🇸',
  status: 'active',
  default_locale: 'en',
  currency_code: 'USD',
  config: {
    locales: ['en', 'es'],
    units: 'imperial',
    enabled_personas: ['customer', 'helper', 'business', 'consultant', 'toolOwner', 'franchise', 'investor'],
    payment_methods: ['restaurant_credit', 'direct_payment', 'pay_at_restaurant'],
    verification_provider: 'didit',
    address_scheme: 'street_zip',
    notification_channels: ['push', 'email', 'sms'],
    connectivity_profile: 'online_first',
    trust_model: 'verified_identity_payment_evidence',
    feature_flags: {},
  },
};

function normalizeCode(code) {
  return String(code || '').trim().toUpperCase().slice(0, 2);
}

function toListEntry(row) {
  return {
    code: row.code,
    name: row.name,
    flag_emoji: row.flag_emoji,
    status: row.status,
    default_locale: row.default_locale,
    currency_code: row.currency_code,
    locales: Array.isArray(row.config?.locales) ? row.config.locales : [row.default_locale],
  };
}

/**
 * Public picker list: active countries first, then coming_soon.
 * Disabled countries are never returned.
 */
async function listCountries() {
  const now = Date.now();
  if (cache.list && now - cache.at < CACHE_TTL_MS) return cache.list;

  try {
    const { rows } = await pool.query(
      `SELECT code, name, flag_emoji, status, default_locale, currency_code, config
         FROM country_packs
        WHERE status IN ('active', 'coming_soon')
        ORDER BY CASE status WHEN 'active' THEN 0 ELSE 1 END, sort_order, name`
    );
    const list = {
      available: rows.filter((r) => r.status === 'active').map(toListEntry),
      coming_soon: rows.filter((r) => r.status === 'coming_soon').map(toListEntry),
    };
    cache = { at: now, list, configs: cache.configs };
    return list;
  } catch (err) {
    logger.warn('country_packs unavailable, serving fallback list', { error: err.message });
    return { available: [toListEntry(FALLBACK_US)], coming_soon: [] };
  }
}

/**
 * Full pack config for one country.
 * Returns { ok: true, country } for active packs,
 *         { ok: false, reason: 'coming_soon' | 'not_found' } otherwise.
 */
async function getCountryConfig(codeRaw) {
  const code = normalizeCode(codeRaw);
  if (!code || code.length !== 2) return { ok: false, reason: 'not_found' };

  const now = Date.now();
  const cached = cache.configs.get(code);
  if (cached && now - cached.at < CACHE_TTL_MS) return cached.value;

  let value;
  try {
    const { rows } = await pool.query(
      `SELECT code, name, flag_emoji, status, default_locale, currency_code, config, updated_at
         FROM country_packs
        WHERE code = $1`,
      [code]
    );
    if (!rows.length || rows[0].status === 'disabled') {
      value = { ok: false, reason: 'not_found' };
    } else if (rows[0].status === 'coming_soon') {
      value = { ok: false, reason: 'coming_soon', country: toListEntry(rows[0]) };
    } else {
      const row = rows[0];
      value = {
        ok: true,
        country: {
          code: row.code,
          name: row.name,
          flag_emoji: row.flag_emoji,
          default_locale: row.default_locale,
          currency_code: row.currency_code,
          updated_at: row.updated_at,
          ...row.config,
        },
      };
    }
  } catch (err) {
    logger.warn('country_packs unavailable, serving fallback config', { error: err.message });
    value =
      code === 'US'
        ? {
            ok: true,
            country: {
              code: FALLBACK_US.code,
              name: FALLBACK_US.name,
              flag_emoji: FALLBACK_US.flag_emoji,
              default_locale: FALLBACK_US.default_locale,
              currency_code: FALLBACK_US.currency_code,
              ...FALLBACK_US.config,
            },
          }
        : { ok: false, reason: 'not_found' };
  }

  cache.configs.set(code, { at: now, value });
  return value;
}

/**
 * Super-admin list: every pack, including disabled, with full config.
 */
async function listAllCountryPacks() {
  const { rows } = await pool.query(
    `SELECT code, name, flag_emoji, status, sort_order, default_locale, currency_code, config, updated_at
       FROM country_packs
      ORDER BY CASE status WHEN 'active' THEN 0 WHEN 'coming_soon' THEN 1 ELSE 2 END, sort_order, name`
  );
  return rows;
}

/**
 * Super-admin update: status flip and/or config patch. The "flip the flag"
 * primitive — activating a country is a one-row UPDATE, never a deploy.
 */
async function updateCountryPack(codeRaw, { status, name, flag_emoji, sort_order, default_locale, currency_code, config }) {
  const code = normalizeCode(codeRaw);
  const sets = [];
  const params = [];
  let i = 1;
  const push = (col, val) => { sets.push(`${col} = $${i++}`); params.push(val); };

  if (status !== undefined) {
    if (!['active', 'coming_soon', 'disabled'].includes(status)) {
      const err = new Error('invalid status');
      err.code = 'validation_failed';
      throw err;
    }
    push('status', status);
  }
  if (name !== undefined) push('name', String(name).slice(0, 80));
  if (flag_emoji !== undefined) push('flag_emoji', String(flag_emoji).slice(0, 8));
  if (sort_order !== undefined) push('sort_order', Number(sort_order) || 100);
  if (default_locale !== undefined) push('default_locale', String(default_locale).slice(0, 8));
  if (currency_code !== undefined) push('currency_code', String(currency_code).toUpperCase().slice(0, 3));
  if (config !== undefined) {
    if (typeof config !== 'object' || config === null || Array.isArray(config)) {
      const err = new Error('config must be an object');
      err.code = 'validation_failed';
      throw err;
    }
    push('config', JSON.stringify(config));
  }
  if (!sets.length) {
    const err = new Error('no fields to update');
    err.code = 'validation_failed';
    throw err;
  }

  params.push(code);
  const { rows } = await pool.query(
    `UPDATE country_packs SET ${sets.join(', ')} WHERE code = $${i} RETURNING code, name, status`,
    params
  );
  invalidateCache();
  return rows[0] || null;
}

function invalidateCache() {
  cache = { at: 0, list: null, configs: new Map() };
}

module.exports = { listCountries, getCountryConfig, listAllCountryPacks, updateCountryPack, invalidateCache, normalizeCode };
