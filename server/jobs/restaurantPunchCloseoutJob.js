// server/jobs/restaurantPunchCloseoutJob.js
// Phase 2 punch integrity (goal goal_a0fc7c0f0394): nightly close-of-day
// sweep for forgotten punches. Runs at 03:15 server time, after the
// close of business: any punch still open past its close time (the
// published shift end, or clock-in + 12 hours) by more than 30 minutes
// is closed at that close time and flagged system-closed, and the
// manager is notified. See server/services/restaurantPunchCloseout.js
// for the documented policy. The sweep is idempotent and fenced: a
// second process cannot run it concurrently, and re-running closes
// nothing twice.

const pool = require('../db');
const logger = require('../utils/logger');
const { withFencedJobLock } = require('./jobLockingService');
const { closeStalePunches } = require('../services/restaurantPunchCloseout');

const JOB_NAME = 'restaurant-punch-closeout';
const CRON_EXPRESSION = '0 15 3 * * *'; // nightly, 03:15 server time

async function sweep(db = pool) {
  const result = await closeStalePunches({ db });
  return {
    closed: result.closed.length,
    notified: result.notified,
    notifyErrors: result.notifyErrors,
    errors: result.errors.length,
  };
}

async function runRestaurantPunchCloseoutJob(db = pool) {
  let result = { locked: false };
  await withFencedJobLock(JOB_NAME, async (fence) => {
    fence.assertActive();
    result = { locked: true, ...(await sweep(db)) };
  }, 900, { throwOnError: true });
  logger.info('Restaurant punch closeout run finished', result);
  return result;
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
};
