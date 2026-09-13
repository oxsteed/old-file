'use strict';

const cron = require('node-cron');
const logger = require('../utils/logger');
const { expireCreditAgreements, expireCreditEntitlements } = require('../services/oxsteedCreditAdminService');
const { withJobLock } = require('./jobLockingService');
const { recordOxsteedCreditJobFailure } = require('./oxsteedCreditJobFailure');

const CRON_EXPRESSION = '* * * * *';
const JOB_NAME = 'oxsteed-credit-entitlement-expiry';

async function runOxsteedCreditEntitlementExpiry({ limit = 500, now } = {}) {
  let result;
  await withJobLock(JOB_NAME, async () => {
    const agreements = await expireCreditAgreements({ limit, now });
    const entitlements = await expireCreditEntitlements({ limit, now });
    result = {
      count: agreements.count + entitlements.count,
      agreements: agreements.expired,
      entitlements: entitlements.expired,
    };
    if (result.count) logger.info('OxSteed Credit lifecycle records expired', { count: result.count, agreements: agreements.count, entitlements: entitlements.count });
  }, 120);
  return result || { count: 0, agreements: [], entitlements: [] };
}

function startOxsteedCreditEntitlementExpiryJob() {
  cron.schedule(CRON_EXPRESSION, () => {
    runOxsteedCreditEntitlementExpiry().catch((error) => {
      return recordOxsteedCreditJobFailure({
        jobName: JOB_NAME,
        error,
        details: { limit: 500 },
      });
    });
  });
  logger.info('OxSteed Credit entitlement expiry job scheduled', { cron: CRON_EXPRESSION });
}

module.exports = {
  CRON_EXPRESSION,
  JOB_NAME,
  runOxsteedCreditEntitlementExpiry,
  startOxsteedCreditEntitlementExpiryJob,
};
