// server/jobs/deliveryWindowWarnings.js
// Group 9 Slice C (item 463): every-15-minutes sweep that warns the
// assigned driver when a pickup/delivery window is closing (within 60
// minutes, D-69) or has passed without the stop completing. Follows the
// deliveryOfferExpiryNotices shape: cron, batched sweep, exported runner
// for tests. Warn-only: the sweep sends notifications and stamps the
// stop rows; it never cancels or reschedules a job.
'use strict';

const pool = require('../db');
const logger = require('../utils/logger');
const { sweepDeliveryWindowWarnings } = require('../services/deliveryWindowWarningService');

const JOB_NAME = 'delivery-window-warnings';
const CRON_EXPRESSION = '*/15 * * * *'; // every 15 minutes

async function runDeliveryWindowWarningsJob(dbClient) {
  const db = dbClient || pool;
  const result = await sweepDeliveryWindowWarnings(db);
  if (result.closing > 0 || result.expired > 0 || result.failed > 0) {
    logger.info('Delivery window warning sweep completed', { ...result, job: JOB_NAME });
  }
  return result;
}

function startDeliveryWindowWarningsJob() {
  const cron = require('node-cron');
  cron.schedule(CRON_EXPRESSION, async () => {
    try {
      await runDeliveryWindowWarningsJob();
    } catch (err) {
      logger.error('Delivery window warning cron error', { error: err.message });
    }
  });
  logger.info('Delivery window warning job scheduled', { cron: CRON_EXPRESSION });
}

module.exports = {
  startDeliveryWindowWarningsJob,
  runDeliveryWindowWarningsJob,
  sweepDeliveryWindowWarnings,
  cronExpression: CRON_EXPRESSION,
};
