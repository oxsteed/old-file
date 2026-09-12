'use strict';

const cron = require('node-cron');
const logger = require('../utils/logger');
const { expireCreditHolds } = require('../services/oxsteedCreditService');
const { withJobLock } = require('./jobLockingService');

const CRON_EXPRESSION = '* * * * *';
const JOB_NAME = 'oxsteed-credit-hold-expiry';

async function runOxsteedCreditHoldExpiry() {
  let result;
  await withJobLock(JOB_NAME, async () => {
    result = await expireCreditHolds({ limit: 500 });
    if (result.count) logger.info('OxSteed Credit holds expired', { count: result.count });
  }, 120);
  return result || { count: 0, expired: [] };
}

function startOxsteedCreditHoldExpiryJob() {
  cron.schedule(CRON_EXPRESSION, () => {
    runOxsteedCreditHoldExpiry().catch((error) => {
      logger.error('OxSteed Credit hold expiry failed', { error: error.message });
    });
  });
  logger.info('OxSteed Credit hold expiry job scheduled', { cron: CRON_EXPRESSION });
}

module.exports = {
  CRON_EXPRESSION,
  runOxsteedCreditHoldExpiry,
  startOxsteedCreditHoldExpiryJob,
};
