// server/jobs/restaurantPunchCloseoutJob.js
// Phase 2 punch integrity (goal goal_a0fc7c0f0394): hourly
// close-of-day sweep for forgotten punches. Runs at the top of every
// hour: the sweep is idempotent and grace-gated (it only closes
// punches 30+ minutes past their close time), so hourly gives
// per-location local timing — each store's punches close shortly
// after their local close instead of at one fixed server time. Any
// punch still open past its close time (the published shift end, or
// clock-in + 12 hours) by more than 30 minutes is closed at that
// close time and flagged system-closed, and the manager is notified.
// See server/services/restaurantPunchCloseout.js for the documented
// policy. The sweep is idempotent and fenced: a second process
// cannot run it concurrently, and re-running closes nothing twice.

const pool = require('../db');
const logger = require('../utils/logger');
const { withFencedJobLock } = require('./jobLockingService');
const { closeStalePunches, notifyCloseoutFailure } = require('../services/restaurantPunchCloseout');

const JOB_NAME = 'restaurant-punch-closeout';
const CRON_EXPRESSION = '0 0 * * * *'; // hourly, top of the hour
const RETRY_DELAY_MS = 5000; // one short retry when the sweep throws

async function sweep(db = pool) {
  const result = await closeStalePunches({ db });
  return {
    closed: result.closed.length,
    notified: result.notified,
    notifyErrors: result.notifyErrors,
    missing: result.missing.length,
    missingNotified: result.missingNotified,
    missingNotifyErrors: result.missingNotifyErrors,
    errors: result.errors.length,
  };
}

async function runRestaurantPunchCloseoutJob(db = pool, { retryDelayMs = RETRY_DELAY_MS } = {}) {
  let lastError = null;
  for (let attempt = 0; attempt <= 1; attempt += 1) {
    let result = { locked: false };
    try {
      await withFencedJobLock(JOB_NAME, async (fence) => {
        fence.assertActive();
        result = { locked: true, ...(await sweep(db)) };
      }, 900, { throwOnError: true });
    } catch (err) {
      lastError = err;
      if (attempt === 0) {
        // One retry with a short delay: a transient failure (a
        // dropped connection, a brief lock contention) must not lose
        // the hour's closeout.
        logger.warn('Restaurant punch closeout failed, retrying once', { error: err.message });
        if (retryDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
        continue;
      }
      // Final failure: best-effort alert to the managers of
      // businesses with punches definitely past their close time, so
      // the open punches are reviewed before payroll. The alert never
      // masks the failure: the error is still rethrown to the caller.
      try {
        const alert = await notifyCloseoutFailure(db);
        logger.warn('Restaurant punch closeout failed after retry; managers alerted', {
          error: err.message, alerted: alert.alerted, businesses: alert.businesses,
        });
      } catch { /* the alert is best-effort; the error below is the record */ }
      throw err;
    }
    logger.info('Restaurant punch closeout run finished', result);
    return result;
  }
  throw lastError;
}

function startRestaurantPunchCloseoutJob() {
  const cron = require('node-cron');
  cron.schedule(CRON_EXPRESSION, async () => {
    try {
      await runRestaurantPunchCloseoutJob();
    } catch (err) {
      logger.error('Restaurant punch closeout cron error', { error: err.message });
    }
  });
  logger.info('Restaurant punch closeout job scheduled', { cron: CRON_EXPRESSION });
}

module.exports = {
  startRestaurantPunchCloseoutJob,
  runRestaurantPunchCloseoutJob,
  sweep,
  cronExpression: CRON_EXPRESSION,
  retryDelayMs: RETRY_DELAY_MS,
};
