'use strict';

/**
 * Periodically delete expired Direct Bookable slot holds.
 *
 * Holds use a short TTL (HOLD_TTL_MS in directSlotEngine, ~4 minutes). Listing
 * and book paths still call expireHolds() as an on-demand safety net; this job
 * keeps the table clean when traffic is quiet so abandoned holds do not linger.
 *
 * Registration: started from bootstrap/backgroundWorkers.js via
 * startDirectSlotHoldExpiryJob() alongside the other node-cron workers.
 *
 * Interval: every minute at second :55 (CRON_EXPRESSION), lock-protected.
 */

const cron = require('node-cron');
const logger = require('../utils/logger');
const db = require('../db');
const { expireHolds, HOLD_TTL_MS } = require('../services/directSlotEngine');
const { withJobLock } = require('./jobLockingService');

// Every minute at :55s — offset from credit-hold (:10) and other maintenance workers.
const CRON_EXPRESSION = '55 * * * * *';
const JOB_NAME = 'direct-slot-hold-expiry';
const DEFAULT_LIMIT = 1000;

async function runDirectSlotHoldExpiry({ limit = DEFAULT_LIMIT } = {}) {
  let result = { count: 0 };
  let lockAcquired = false;
  await withJobLock(JOB_NAME, async () => {
    lockAcquired = true;
    result = await expireHolds(db, { limit });
    if (result.count) {
      logger.info('Direct slot holds expired', {
        count: result.count,
        holdTtlMs: HOLD_TTL_MS,
      });
    }
  }, 120, { throwOnLockError: true });
  if (!lockAcquired) {
    return { count: 0, skipped: true };
  }
  return result;
}

function startDirectSlotHoldExpiryJob() {
  cron.schedule(CRON_EXPRESSION, () => {
    runDirectSlotHoldExpiry().catch((error) => {
      logger.error('Direct slot hold expiry job failed', { error: error.message });
    });
  });
  logger.info('Direct slot hold expiry job scheduled', {
    cron: CRON_EXPRESSION,
    holdTtlMs: HOLD_TTL_MS,
    jobName: JOB_NAME,
  });
}

module.exports = {
  CRON_EXPRESSION,
  JOB_NAME,
  DEFAULT_LIMIT,
  runDirectSlotHoldExpiry,
  startDirectSlotHoldExpiryJob,
};
