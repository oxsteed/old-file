'use strict';

/**
 * server/workers/vortexTokenWorkers.js
 *
 * Background sweeper for legacy single-use Vortex invite tokens
 * (business_invite_tokens). Tokens carry expires_at but nothing ever
 * reaped them, so expired-but-unused rows sat in the "active" index
 * forever. This worker marks them revoked (expired) in bounded batches.
 *
 * Idempotent: re-running with no expired tokens is a no-op.
 * Scheduled in server/workerMain.js (hourly).
 */

const pool = require('../db');
const logger = require('../utils/logger');

const DEFAULT_LIMIT = 500;

function safeLimit(limit) {
  const n = Math.floor(Number(limit));
  if (!Number.isSafeInteger(n) || n <= 0) return DEFAULT_LIMIT;
  return Math.min(n, 5000);
}

/**
 * Mark expired, unused, non-revoked invite tokens as revoked.
 * Returns { expired: <count> }.
 */
async function expireVortexTokens({ limit } = {}) {
  const lim = safeLimit(limit);
  const { rowCount } = await pool.query(
    `UPDATE business_invite_tokens
        SET is_revoked = TRUE
      WHERE id IN (
        SELECT id FROM business_invite_tokens
         WHERE expires_at < NOW()
           AND used_at IS NULL
           AND is_revoked = FALSE
         ORDER BY expires_at ASC
         LIMIT $1
      )`,
    [lim]
  );
  if (rowCount > 0) {
    logger.info('Vortex token sweeper expired tokens', { count: rowCount });
  }
  return { expired: rowCount };
}

module.exports = { expireVortexTokens };
