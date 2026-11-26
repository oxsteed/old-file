// server/jobs/deliveryOfferExpiryNotices.js
// Group 9 Slice B (item 457): hourly sweep that expires unclaimed
// marketplace offers past their deadline and notifies the shipper once.
// Follows the driverDocumentRenewalNotices shape: hourly cron, batched
// sweep, exported runner for tests. The sweep itself owns the expiry
// stamp and the once-only notice stamp, so the job is safe to re-run.
'use strict';

const pool = require('../db');
const logger = require('../utils/logger');
const { sweepExpiredDeliveryOffers, sweepExpiredDeliveryClaims } = require('../services/deliveryOfferExpiryService');

const JOB_NAME = 'delivery-offer-expiry-notices';
const CRON_EXPRESSION = '7 * * * *'; // hourly, offset from other jobs

async function runDeliveryOfferExpiryJob(dbClient) {
  const db = dbClient || pool;
  const result = await sweepExpiredDeliveryOffers(db);
  // Group 9 partials Wave 2 Batch P (482, G9-B4, D-554): the same
  // hourly run also expires stale marketplace claims (pickup window
  // passed, no pickup). One job, two sweeps, one log line.
  const claims = await sweepExpiredDeliveryClaims(db);
  const merged = { ...result, claimsExpired: claims.expired, claimsNotified: claims.notified, claimsFailed: claims.failed };
  if (result.expired > 0 || result.notified > 0 || result.failed > 0 || claims.expired > 0 || claims.failed > 0) {
    logger.info('Delivery offer expiry sweep completed', { ...merged, job: JOB_NAME });
  }
  return merged;
}

function startDeliveryOfferExpiryJob() {
  const cron = require('node-cron');
  cron.schedule(CRON_EXPRESSION, async () => {
    try {
      await runDeliveryOfferExpiryJob();
    } catch (err) {
      logger.error('Delivery offer expiry cron error', { error: err.message });
    }
  });
  logger.info('Delivery offer expiry job scheduled', { cron: CRON_EXPRESSION });
}

module.exports = {
  startDeliveryOfferExpiryJob,
  runDeliveryOfferExpiryJob,
  sweepExpiredDeliveryOffers,
  sweepExpiredDeliveryClaims,
  cronExpression: CRON_EXPRESSION,
};
