'use strict';

const cron = require('node-cron');
const logger = require('../utils/logger');
const { expireCreditHolds } = require('../services/oxsteedCreditService');
const { withJobLock } = require('./jobLockingService');
const { recordOxsteedCreditJobFailure } = require('./oxsteedCreditJobFailure');
const { recordOxsteedCreditWorkerRun } = require('../services/oxsteedCreditWorkerHeartbeat');

// Run every minute, offset from the other maintenance workers to avoid a
// connection-pool burst at the minute boundary.
const CRON_EXPRESSION = '10 * * * * *';
const JOB_NAME = 'oxsteed-credit-hold-expiry';

async function runOxsteedCreditHoldExpiry() {
  let result = { count: 0, expired: [] };
  let lockAcquired = false;
  try {
    await withJobLock(JOB_NAME, async () => {
      lockAcquired = true;
      result = await expireCreditHolds({ limit: 500 });
      if (result.count) logger.info('OxSteed Credit holds expired', { count: result.count });
    }, 120, { throwOnLockError: true });
    if (lockAcquired) await recordOxsteedCreditWorkerRun({ jobName: JOB_NAME, result });
  } catch (error) {
    if (lockAcquired) await recordOxsteedCreditWorkerRun({ jobName: JOB_NAME, error });
    throw error;
  }
  return result;
}

function startOxsteedCreditHoldExpiryJob() {
  cron.schedule(CRON_EXPRESSION, () => {
    runOxsteedCreditHoldExpiry().catch((error) => {
      return recordOxsteedCreditJobFailure({
        jobName: JOB_NAME,
        error,
        details: { limit: 500 },
      });
    });
  });
  logger.info('OxSteed Credit hold expiry job scheduled', { cron: CRON_EXPRESSION });
}

module.exports = {
  CRON_EXPRESSION,
  runOxsteedCreditHoldExpiry,
  startOxsteedCreditHoldExpiryJob,
};
