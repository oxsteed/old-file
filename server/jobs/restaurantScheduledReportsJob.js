'use strict';

// Phase 7 (gap 19): scheduled restaurant report delivery.
// Runs every morning at 06:05 server time: each enabled schedule gets
// the previous business day's report (daily) or the 7-day window
// ending yesterday (weekly), built from the existing report functions
// and delivered in-app and/or by email. The deliveries ledger dedupes
// (one delivery per schedule per business day), so a second run — or
// a second process — replays instead of sending twice. Fenced like
// the other restaurant jobs: one process at a time.

const pool = require('../db');
const logger = require('../utils/logger');
const { withFencedJobLock } = require('./jobLockingService');
const { runDueScheduledReports } = require('../services/restaurantScheduledReports');

const JOB_NAME = 'restaurant-scheduled-reports';
const CRON_EXPRESSION = '0 5 6 * * *'; // daily, 06:05 server time

async function runRestaurantScheduledReportsJob(db = pool, options = {}) {
  let result = { locked: false };
  await withFencedJobLock(JOB_NAME, async (fence) => {
    fence.assertActive();
    result = { locked: true, ...(await runDueScheduledReports(db, options)) };
  }, 900, { throwOnError: true });
  logger.info('Restaurant scheduled reports run finished', result);
  return result;
}

function startRestaurantScheduledReportsJob() {
  const cron = require('node-cron');
  cron.schedule(CRON_EXPRESSION, async () => {
    try {
      await runRestaurantScheduledReportsJob();
    } catch (err) {
      logger.error('Restaurant scheduled reports cron error', { error: err.message });
    }
  });
  logger.info('Restaurant scheduled reports job scheduled', { cron: CRON_EXPRESSION });
}

module.exports = {
  startRestaurantScheduledReportsJob,
  runRestaurantScheduledReportsJob,
  cronExpression: CRON_EXPRESSION,
};
