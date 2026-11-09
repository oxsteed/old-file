'use strict';

// Background-jobs audit #45: failed franchise royalty accruals are
// recorded in franchise_royalty_failures and re-driven until they
// accrue. Runs hourly at :20 server time, fenced like the other
// restaurant jobs: one process at a time, through the fence's
// handle, so a worker that lost its lease cannot keep accruing.

const pool = require('../db');
const logger = require('../utils/logger');
const { withFencedJobLock } = require('./jobLockingService');
const { retryFailedRoyalties } = require('../services/franchiseRoyaltyService');

const JOB_NAME = 'franchise-royalty-redrive';
const CRON_EXPRESSION = '0 20 * * * *'; // hourly at :20 server time

async function runFranchiseRoyaltyRedriveJob(db = pool) {
  let result = { locked: false };
  await withFencedJobLock(JOB_NAME, async (fence) => {
    fence.assertActive();
    result = { locked: true, ...(await retryFailedRoyalties(fence.db)) };
  }, 300, { throwOnError: true });
  logger.info('Franchise royalty re-drive finished', result);
  return result;
}

function startFranchiseRoyaltyRedriveJob() {
  const cron = require('node-cron');
  cron.schedule(CRON_EXPRESSION, async () => {
    try {
      await runFranchiseRoyaltyRedriveJob();
    } catch (err) {
      logger.error('Franchise royalty re-drive cron error', { error: err.message });
    }
  });
  logger.info('Franchise royalty re-drive job scheduled', { cron: CRON_EXPRESSION });
}

module.exports = {
  startFranchiseRoyaltyRedriveJob,
  runFranchiseRoyaltyRedriveJob,
  cronExpression: CRON_EXPRESSION,
};
