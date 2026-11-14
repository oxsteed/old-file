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
const { withFencedJobLock, LeaseLostError } = require('./jobLockingService');
const { closeStalePunches, notifyCloseoutFailure } = require('../services/restaurantPunchCloseout');

const JOB_NAME = 'restaurant-punch-closeout';
const CRON_EXPRESSION = '0 0 * * * *'; // hourly, top of the hour
const RETRY_DELAY_MS = 5000; // one short retry when the sweep throws

// Background-jobs audit #48: a lock failure means another process may
// be running the sweep fine, so managers must not get a false
// "closeout failed" alarm. Lock contention surfaces in this path in
// exactly three ways, and none of them is a sweep failure:
//   - the lease is lost mid-run: the fence throws its typed
//     LeaseLostError (withFencedJobLock normally converts it to a
//     { fenced: true } outcome before it reaches this job; the check
//     below is the backstop for any path that lets it through);
//   - the lock is already held at acquire time: acquireJobLock
//     returns null and withFencedJobLock returns { skipped: true }
//     (with a lockSkipped marker after the item 30(d) rework), which
//     never throws and is handled as a normal outcome below;
//   - the lock store itself fails at acquire time: withFencedJobLock
//     throws the typed JobLockAcquisitionError (Oct 30 item 30(d);
//     a raw pg error at base 2f988901a, before that rework landed).
//     The sweep never ran and the lock state is UNKNOWN, so another
//     process may hold the lease; alerting would be a false alarm,
//     and the alert needs the same store that just failed.
// Match on the error class and its structured `code`, never on the
// message text: a message substring would also match unrelated
// database errors that merely mention a lock. The acquisition error
// is matched by code alone (no import): its class is new in the
// item 30(d) rework, and a code match stays correct whether or not
// that rework is present (at base the code simply never occurs).
function isLeaseLost(err) {
  return !!err && (err instanceof LeaseLostError || err.code === 'LEASE_LOST');
}

function isLockAcquisitionFailure(err) {
  return !!err && err.code === 'LOCK_ACQUISITION_ERROR';
}

async function sweep(db = pool, fence = null) {
  // Background-jobs audit #43: the sweep runs on the fence's handle,
  // not the raw pool, so a worker that lost its lease cannot keep
  // closing punches. closeStalePunches routes its per-entry
  // transactions through fence.fencedTransaction when given the fence.
  const result = await closeStalePunches({ db, fence });
  return {
    closed: result.closed.length,
    notified: result.notified,
    notifyErrors: result.notifyErrors,
    missing: result.missing.length,
    missingNotified: result.missingNotified,
    missingNotifyErrors: result.missingNotifyErrors,
    missingFlagged: result.missingFlagged,
    errors: result.errors.length,
  };
}

async function runRestaurantPunchCloseoutJob(db = pool, { retryDelayMs = RETRY_DELAY_MS } = {}) {
  let lastError = null;
  for (let attempt = 0; attempt <= 1; attempt += 1) {
    let result = { locked: false };
    let outcome;
    try {
      outcome = await withFencedJobLock(JOB_NAME, async (fence) => {
        fence.assertActive();
        result = { locked: true, ...(await sweep(fence.db, fence)) };
      }, 900, { throwOnError: true });
    } catch (err) {
      if (isLeaseLost(err)) {
        // Lock contention, not a failed sweep: another process may be
        // running the sweep fine, so there is nothing to alert
        // managers about. Do not retry (the next hourly tick picks up
        // anything left open; the sweep is idempotent) and do not
        // rethrow: a fenced run is a normal outcome, the same as
        // withFencedJobLock's own { fenced: true } return.
        logger.warn('Restaurant punch closeout fenced by lock contention; skipping failure alert', { error: err.message });
        return { locked: false, fenced: true };
      }
      lastError = err;
      if (attempt === 0) {
        // One retry with a short delay: a transient failure (a
        // dropped connection, a brief lock-store blip) must not lose
        // the hour's closeout. A lost lease never reaches this branch
        // (see above).
        logger.warn('Restaurant punch closeout failed, retrying once', { error: err.message });
        if (retryDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
        continue;
      }
      // Final failure: best-effort alert to the managers of
      // businesses with punches definitely past their close time, so
      // the open punches are reviewed before payroll. The alert never
      // masks the failure: the error is still rethrown to the caller.
      // But a lock-acquisition failure is not a sweep failure (see
      // above): the sweep never ran, the lock state is unknown, and
      // the alert would be a false alarm, so skip it and rethrow the
      // error as the record instead.
      if (isLockAcquisitionFailure(err)) {
        logger.warn('Restaurant punch closeout could not acquire its lock; skipping failure alert', { error: err.message });
      } else {
        try {
          const alert = await notifyCloseoutFailure(db);
          logger.warn('Restaurant punch closeout failed after retry; managers alerted', {
            error: err.message, alerted: alert.alerted, businesses: alert.businesses,
          });
        } catch { /* the alert is best-effort; the error below is the record */ }
      }
      throw err;
    }
    // A skipped run (lock already held: another instance is running
    // the sweep) or a fenced run (lease lost mid-run) is not a
    // failure and never alerts: report the outcome and return.
    if (outcome && outcome.skipped) return { locked: false, skipped: true };
    if (outcome && outcome.fenced) return { locked: false, fenced: true };
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
