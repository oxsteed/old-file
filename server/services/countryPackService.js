// server/services/countryPackService.js
//
// Country pack registry (docs/oxsteed-pack-architecture.md §5).
// A country is a pack you register, never a condition you check. This service
// is the ONLY module that reads country_packs; everything else consumes the
// resolved config object.
//
// Fail closed: country availability and payment/localization policy are
// database-owned. A database outage must not silently make a disabled or
// unverified country appear active.

const pool = require('../db');
const logger = require('../utils/logger');

const CACHE_TTL_MS = 60 * 1000;
let cache = { at: 0, list: null, configs: new Map() };

// These fields belong to the country_packs row, not the JSON configuration.
// Keep them canonical when a pack is returned so an accidental or malicious
// config patch cannot shadow the registry identity or currency metadata.
const RESERVED_CONFIG_KEYS = new Set([
  'code',
  'name',
  'flag_emoji',
  'status',
  'default_locale',
  'currency_code',
  'updated_at',
  'config',
]);

function normalizeConfig(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) return {};
  return Object.fromEntries(
    Object.entries(config).filter(([key]) => !RESERVED_CONFIG_KEYS.has(key))
  );
}

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
    logger.error('country_packs unavailable; refusing to advertise availability', { error: err.message });
    return { available: [], coming_soon: [], unavailable: true };
  }
}

/**
 * Full pack config for one country.
 * Returns { ok: true, country } for active packs,
 *         { ok: false, reason: 'coming_soon' | 'not_found' | 'unavailable' } otherwise.
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
          ...normalizeConfig(row.config),
          code: row.code,
          name: row.name,
          flag_emoji: row.flag_emoji,
          default_locale: row.default_locale,
          currency_code: row.currency_code,
          updated_at: row.updated_at,
        },
      };
    }
  } catch (err) {
    logger.error('country_packs unavailable; refusing to serve active config', { error: err.message });
    value = { ok: false, reason: 'unavailable' };
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
  if (currency_code !== undefined) {
    const code = String(currency_code).toUpperCase();
    if (!/^[A-Z]{3}$/.test(code)) {
      const err = new Error('currency_code must be a 3-letter ISO-4217 code');
      err.code = 'validation_failed';
      throw err;
    }
    push('currency_code', code);
  }
  if (config !== undefined) {
    if (typeof config !== 'object' || config === null || Array.isArray(config)) {
      const err = new Error('config must be an object');
      err.code = 'validation_failed';
      throw err;
    }
    const reservedKeys = Object.keys(config).filter((key) => RESERVED_CONFIG_KEYS.has(key));
    if (reservedKeys.length) {
      const err = new Error(`config contains reserved keys: ${reservedKeys.join(', ')}`);
      err.code = 'validation_failed';
      err.reservedKeys = reservedKeys;
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
