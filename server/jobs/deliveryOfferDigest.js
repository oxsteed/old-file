// server/jobs/deliveryOfferDigest.js
// Group 9 partials Wave 2 Batch M (456, G9-A9): hourly digest that tells
// eligible drivers about new marketplace offers. Follows the
// deliveryOfferExpiryNotices shape: hourly cron, batched sweep, exported
// runner for tests. The sweep itself owns the per-release digest stamp
// and the once-per-release notice, so the job is safe to re-run.
'use strict';

const pool = require('../db');
const logger = require('../utils/logger');
const { sweepDeliveryOfferDigest } = require('../services/deliveryOfferDigestService');

const JOB_NAME = 'delivery-offer-digest';
const CRON_EXPRESSION = '12 * * * *'; // hourly, offset from the expiry sweep at :07

async function runDeliveryOfferDigestJob(dbClient) {
  const db = dbClient || pool;
  const result = await sweepDeliveryOfferDigest(db);
  if (result.notified > 0 || result.failed > 0) {
    logger.info('Delivery offer digest completed', { ...result, job: JOB_NAME });
  }
  return result;
}

function startDeliveryOfferDigestJob() {
  const cron = require('node-cron');
  cron.schedule(CRON_EXPRESSION, async () => {
    try {
      await runDeliveryOfferDigestJob();
    } catch (err) {
      logger.error('Delivery offer digest cron error', { error: err.message });
    }
  });
  logger.info('Delivery offer digest job scheduled', { cron: CRON_EXPRESSION });
}

module.exports = {
  startDeliveryOfferDigestJob,
  runDeliveryOfferDigestJob,
  sweepDeliveryOfferDigest,
  cronExpression: CRON_EXPRESSION,
};
