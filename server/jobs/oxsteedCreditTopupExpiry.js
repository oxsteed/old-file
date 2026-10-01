'use strict';

const cron = require('node-cron');
const logger = require('../utils/logger');
const { expireCreditTopups } = require('../services/oxsteedCreditTopupService');
const { withJobLock } = require('./jobLockingService');
const { recordOxsteedCreditJobFailure } = require('./oxsteedCreditJobFailure');
const { recordOxsteedCreditWorkerRun } = require('../services/oxsteedCreditWorkerHeartbeat');

// Run every minute, offset from the hold-expiry worker (second 10) to avoid
// a connection-pool burst at the minute boundary.
const CRON_EXPRESSION = '20 * * * * *';
const JOB_NAME = 'oxsteed-credit-topup-expiry';

async function runOxsteedCreditTopupExpiry() {
  let result = { count: 0, expired: [] };
  let lockAcquired = false;
  try {
    await withJobLock(JOB_NAME, async () => {
      lockAcquired = true;
      result = await expireCreditTopups({ limit: 500 });
      if (result.count) logger.info('OxSteed Credit top-ups expired', { count: result.count });
    }, 120, { throwOnLockError: true });
    if (lockAcquired) await recordOxsteedCreditWorkerRun({ jobName: JOB_NAME, result });
  } catch (error) {
    if (lockAcquired) await recordOxsteedCreditWorkerRun({ jobName: JOB_NAME, error });
    throw error;
  }
  return result;
}

function startOxsteedCreditTopupExpiryJob() {
  cron.schedule(CRON_EXPRESSION, () => {
    runOxsteedCreditTopupExpiry().catch((error) => {
      return recordOxsteedCreditJobFailure({
        jobName: JOB_NAME,
        error,
        details: { limit: 500 },
      });
    });
  });
  logger.info('OxSteed Credit top-up expiry job scheduled', { cron: CRON_EXPRESSION });
}

module.exports = {
  CRON_EXPRESSION,
  runOxsteedCreditTopupExpiry,
  startOxsteedCreditTopupExpiryJob,
};
