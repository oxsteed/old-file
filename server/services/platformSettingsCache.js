'use strict';

// Review P3-7-F07: runtime readers for the admin-editable platform_settings
// kill-switches 'maintenance_mode' and 'new_user_registrations'. Previously
// these keys were writable from Platform Settings but read by nothing, so
// flipping them had no effect.
//
// Reads are TTL-cached (default 15s) so the request pipeline does not pay a
// DB round-trip per request. A flip takes effect within one TTL window.
// Fail-open on read errors: a settings lookup failure must not 503 the site
// by itself (downstream handlers fail on their own when the DB is down).

const db = require('../db');
const logger = require('../utils/logger');

const TTL_MS = Number.parseInt(process.env.PLATFORM_SETTINGS_CACHE_TTL_MS || '15000', 10) || 15000;

const cache = new Map(); // key -> { value: string|null, loadedAt: number }

function parseBooleanSetting(raw, defaultValue) {
  if (raw === null || raw === undefined) return defaultValue;
  const normalized = String(raw).trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return false;
  return defaultValue;
}

async function readSettingRaw(key) {
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && now - hit.loadedAt < TTL_MS) return hit.value;
  try {
    const { rows } = await db.query('SELECT value FROM platform_settings WHERE key = $1', [key]);
    const value = rows.length ? rows[0].value : null;
    cache.set(key, { value, loadedAt: now });
    return value;
  } catch (err) {
    logger.warn('platformSettingsCache: settings read failed', { key, error: err.message });
    return hit ? hit.value : null;
  }
}

// Maintenance mode kill-switch. Default false (site up) when unset/unreadable.
async function isMaintenanceMode() {
  return parseBooleanSetting(await readSettingRaw('maintenance_mode'), false);
}

// New-user registration kill-switch. Default true (registrations open).
async function areNewUserRegistrationsEnabled() {
  return parseBooleanSetting(await readSettingRaw('new_user_registrations'), true);
}

function _clearCacheForTests() {
  cache.clear();
}

module.exports = {
  isMaintenanceMode,
  areNewUserRegistrationsEnabled,
  parseBooleanSetting,
  _clearCacheForTests,
};
