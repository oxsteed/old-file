'use strict';

/**
 * Payment-layer maintenance. Every task is a no-op while its flag is off.
 *  - card holds about to expire → flag for re-authorization (#17)
 *  - Credit payments past the review window → release to the helper
 *  - stale rail-switch requests → expire (#6)
 *  - cash-out requests → hand to licensed payout partners (#14)
 *  - privacy erasure queue + retention sweep (#12)
 *  - ledger-safe finalize of matured admin deletion schedules: anonymize,
 *    never hard-delete (the wallet ledger no-delete rule blocks hard deletes
 *    of users with ledger history schema-wide)
 */

const cron = require('node-cron');
const logger = require('../utils/logger');
const { withFencedJobLock } = require('./jobLockingService');
const holdExpiry = require('../services/paymentRails/holdExpiry');
const creditAutoRelease = require('../services/paymentRails/creditAutoRelease');
const railSwitch = require('../services/paymentRails/railSwitch');
const cashout = require('../services/creditCashoutService');
const privacy = require('../services/privacyRetentionService');
const flags = require('../services/paymentLayerFlags');

const FREQUENT = { name: 'payment-layers-frequent', cron: '*/10 * * * *' };
const DAILY = { name: 'payment-layers-daily', cron: '41 3 * * *' };

async function step(name, fn) {
  try {
    return await fn();
  } catch (error) {
    logger.error('payment_layers.task_failed', { task: name, error: error.message });
    return null;
  }
}

async function runFrequent() {
  return {
    holds: flags.isEnabled('HOLD_EXPIRY_REAUTH') ? await step('hold_expiry', () => holdExpiry.flagExpiringHolds()) : null,
    creditRelease: await step('credit_auto_release', () => creditAutoRelease.releaseDueCreditPayments()),
    switches: flags.isEnabled('PAYMENT_RAILS') ? await step('rail_switch_expiry', () => railSwitch.expireStaleSwitches()) : null,
    cashouts: flags.isEnabled('CREDIT_CASHOUT') ? await step('cashouts', () => cashout.processCashouts()) : null,
    erasures: flags.isEnabled('PRIVACY_RETENTION') ? await step('erasure', () => privacy.processErasureRequests()) : null,
  };
}

async function runDaily() {
  return {
    retention: flags.isEnabled('PRIVACY_RETENTION') ? await step('retention', () => privacy.retentionSweep()) : null,
    deletionFinalize: flags.isEnabled('PRIVACY_RETENTION') ? await step('deletion_finalize', () => privacy.finalizeScheduledDeletions()) : null,
  };
}

function schedule(job, fn) {
  cron.schedule(job.cron, () => {
    withFencedJobLock(job.name, async (fence) => {
      fence.assertActive();
      await fn();
    }, 600).catch((error) => logger.error('Payment layers worker failed', { job: job.name, error: error.message }));
  });
}

function startPaymentLayersWorker() {
  schedule(FREQUENT, runFrequent);
  schedule(DAILY, runDaily);
  logger.info('Payment layers worker scheduled', { frequent: FREQUENT.cron, daily: DAILY.cron });
}

module.exports = { startPaymentLayersWorker, runFrequent, runDaily };
