'use strict';

// Durable worker for restaurant wallet-earnings payouts. Provider calls are
// outside database transactions; webhook evidence and this sweep converge the
// local state after crashes, delayed webhooks, or provider timeouts.

const cron = require('node-cron');
const logger = require('../utils/logger');
const restaurantPayoutService = require('../services/restaurantPayoutService');
const { withFencedJobLock } = require('./jobLockingService');

const CRON_EXPRESSION = '*/5 * * * *';
const CRON_TIMEZONE = 'UTC';
const JOB_NAME = 'restaurant-payout-transfer-reconciliation';
const BATCH_SIZE = 50;

async function runRestaurantPayoutReconciliation({ limit = BATCH_SIZE } = {}) {
  const result = { locked: false, outbox: [], reconciliation: null };
  await withFencedJobLock(JOB_NAME, async (fence) => {
    fence.assertActive();
    result.locked = true;
    // Drain a bounded number of outbox records. Each call claims one record
    // with SKIP LOCKED, so multiple application replicas cannot double-send.
    for (let i = 0; i < Math.min(10, Math.max(1, Number(limit) || BATCH_SIZE)); i += 1) {
      fence.assertActive();
      const item = await restaurantPayoutService.processNextTransfer();
      result.outbox.push(item);
      if (!item.processed) break;
    }
    result.reconciliation = await restaurantPayoutService.reconcilePayouts({ limit });
  }, 300, { throwOnLockError: true });
  return result;
}

function startRestaurantPayoutReconciliationJob() {
  cron.schedule(CRON_EXPRESSION, () => {
    runRestaurantPayoutReconciliation().catch((error) => {
      logger.error('[RestaurantPayout] reconciliation worker failed', { error: error.message });
    });
  }, { timezone: CRON_TIMEZONE });
  logger.info('[RestaurantPayout] reconciliation job scheduled', {
    cron: CRON_EXPRESSION,
    timezone: CRON_TIMEZONE,
    batchSize: BATCH_SIZE,
  });
}

module.exports = {
  CRON_EXPRESSION,
  CRON_TIMEZONE,
  JOB_NAME,
  BATCH_SIZE,
  runRestaurantPayoutReconciliation,
  startRestaurantPayoutReconciliationJob,
};
