'use strict';

/**
 * services/chatPaymentRequestExpirySweeper.js
 *
 * Review P2-10-F01 (open-forever half): sweeps chat_payment_requests whose
 * expires_at has passed (open -> expired). Idempotent, batch-limited, and
 * best-effort: a failure never throws out of the tick. Pay/confirm paths
 * enforce expiry inline as well, so the sweeper is hygiene, not a gate.
 *
 * Env: CHAT_PAYMENT_REQUEST_SWEEPER_ENABLED=1 (default), poll via
 * CHAT_PAYMENT_REQUEST_SWEEPER_POLL_MS (default hourly, min 60s).
 */

const { createDrainablePoller } = require('../utils/drainablePoller');
const pool = require('../db');
const logger = require('../utils/logger');

const DEFAULT_POLL_MS = 60 * 60 * 1000; // hourly
const MAX_PER_SWEEP = 1000;


function enabled() {
  const raw = process.env.CHAT_PAYMENT_REQUEST_SWEEPER_ENABLED;
  if (raw == null || String(raw).trim() === '') return true;
  return String(raw).trim() === '1';
}

function pollMs() {
  const value = Number.parseInt(process.env.CHAT_PAYMENT_REQUEST_SWEEPER_POLL_MS, 10);
  return Number.isFinite(value) && value >= 60 * 1000 ? value : DEFAULT_POLL_MS;
}

// Expire one batch of past-TTL open requests. Returns the expired count.
async function expirePaymentRequestsOnce({ limit = MAX_PER_SWEEP } = {}) {
  const bounded = Math.min(MAX_PER_SWEEP, Math.max(1, Number(limit) || MAX_PER_SWEEP));
  const { rows } = await pool.query(
    `UPDATE chat_payment_requests
        SET status = 'expired', updated_at = NOW()
      WHERE id IN (
        SELECT id
          FROM chat_payment_requests
         WHERE status = 'open'
           AND expires_at IS NOT NULL
           AND expires_at <= NOW()
         ORDER BY expires_at ASC
         LIMIT $1
      )
      RETURNING id`,
    [bounded]
  );
  return rows.length;
}

const poller = createDrainablePoller({
  run: async () => {
    const expired = await expirePaymentRequestsOnce();
    if (expired) logger.info('[chatPaymentRequestExpiry] expired payment requests', { expired });
  },
  onError: err => logger.warn('[chatPaymentRequestExpiry] sweep failed', { error: err.message }),
});
function startChatPaymentRequestExpirySweeper() {
  if (!enabled()) return { started: false };
  return { started: poller.start({ intervalMs: pollMs() }) };
}
function stopChatPaymentRequestExpirySweeper() { return poller.stop(); }

module.exports = {
  enabled,
  pollMs,
  expirePaymentRequestsOnce,
  startChatPaymentRequestExpirySweeper,
  stopChatPaymentRequestExpirySweeper,
};
