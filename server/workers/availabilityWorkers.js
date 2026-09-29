/**
 * availabilityWorkers.js
 *
 * Sweeps the manual "available now" readiness flag. The flag is a helper
 * checkbox; without expiry it goes stale and helpers keep showing as
 * "available now" in discovery, search, and chat long after they walked
 * away. This worker clears flags that have not been (re)set within the TTL
 * so every read path sees fresh readiness without changing its query.
 */

const pool = require('../db');
const logger = require('../utils/logger');

// How long a helper's manual "available now" stays valid without a re-toggle.
const AVAILABLE_NOW_TTL_MS = 12 * 60 * 60 * 1000;

async function clearStaleAvailableNow({ limit = 500 } = {}) {
  const ttlSeconds = Math.floor(AVAILABLE_NOW_TTL_MS / 1000);
  const { rowCount } = await pool.query(
    `UPDATE helper_profiles
        SET is_available_now = FALSE,
            is_available_now_updated_at = NOW()
      WHERE ctid IN (
        SELECT ctid FROM helper_profiles
         WHERE is_available_now = TRUE
           AND (
                 is_available_now_updated_at IS NULL
              OR is_available_now_updated_at < NOW() - make_interval(secs => $1)
               )
         LIMIT $2
      )`,
    [ttlSeconds, limit]
  );
  if (rowCount > 0) {
    logger.info('Cleared stale available-now flags', { count: rowCount });
  }
  return { cleared: rowCount };
}

module.exports = {
  clearStaleAvailableNow,
  AVAILABLE_NOW_TTL_MS,
};
