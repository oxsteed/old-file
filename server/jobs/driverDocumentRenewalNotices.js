// server/jobs/driverDocumentRenewalNotices.js
// Group 9 Slice A (item 453): daily renewal reminders for driver
// documents. Follows the quoteDeadlineNotices shape: daily cron, batched
// sweep, exported runner for tests. The sweep itself owns the
// once-per-window stamps, so the job is safe to re-run.
'use strict';

const pool = require('../db');
const logger = require('../utils/logger');
const { sweepDriverDocumentRenewalReminders } = require('../services/driverDocumentRenewalService');

const JOB_NAME = 'driver-document-renewal-notices';
const CRON_EXPRESSION = '15 8 * * *'; // daily 08:15 UTC

async function runDriverDocumentRenewalNoticesJob(dbClient) {
  const db = dbClient || pool;
  const result = await sweepDriverDocumentRenewalReminders(db);
  if (result.notified > 0 || result.failed > 0) {
    logger.info('Driver document renewal sweep completed', { ...result, job: JOB_NAME });
  }
  return result;
}

function startDriverDocumentRenewalNoticesJob() {
  const cron = require('node-cron');
  cron.schedule(CRON_EXPRESSION, async () => {
    try {
      await runDriverDocumentRenewalNoticesJob();
    } catch (err) {
      logger.error('Driver document renewal notices cron error', { error: err.message });
    }
  });
  logger.info('Driver document renewal notices job scheduled', { cron: CRON_EXPRESSION });
}

module.exports = {
  startDriverDocumentRenewalNoticesJob,
  runDriverDocumentRenewalNoticesJob,
  sweepDriverDocumentRenewalReminders,
  cronExpression: CRON_EXPRESSION,
};
