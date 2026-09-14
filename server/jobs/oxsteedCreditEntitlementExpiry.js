'use strict';

const cron = require('node-cron');
const logger = require('../utils/logger');
const { expireCreditAgreements, expireCreditEntitlements } = require('../services/oxsteedCreditAdminService');
const { withJobLock } = require('./jobLockingService');
const { recordOxsteedCreditJobFailure } = require('./oxsteedCreditJobFailure');
const { recordOxsteedCreditWorkerRun } = require('../services/oxsteedCreditWorkerHeartbeat');

// Run every minute, offset from the other maintenance workers to avoid a
// connection-pool burst at the minute boundary.
const CRON_EXPRESSION = '20 * * * * *';
const JOB_NAME = 'oxsteed-credit-entitlement-expiry';

async function runOxsteedCreditEntitlementExpiry({ limit = 500, now } = {}) {
  let result = { count: 0, agreements: [], entitlements: [] };
  let lockAcquired = false;
  try {
    await withJobLock(JOB_NAME, async () => {
      lockAcquired = true;
      const agreements = await expireCreditAgreements({ limit, now });
      const entitlements = await expireCreditEntitlements({ limit, now });
      result = {
        count: agreements.count + entitlements.count,
        agreements: agreements.expired,
        entitlements: entitlements.expired,
      };
      if (result.count) logger.info('OxSteed Credit lifecycle records expired', { count: result.count, agreements: agreements.count, entitlements: entitlements.count });
    }, 120, { throwOnLockError: true });
    if (lockAcquired) await recordOxsteedCreditWorkerRun({ jobName: JOB_NAME, result: { count: result.count } });
  } catch (error) {
    if (lockAcquired) await recordOxsteedCreditWorkerRun({ jobName: JOB_NAME, error });
    throw error;
  }
  return result;
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
