// server/jobs/deliveryWeeklyReport.js
// Group 9 Slice F (item 495): every-Monday sweep that generates the
// previous week's driver work report (D-86). Follows the
// deliveryDelayEscalation shape: cron, batched sweep, exported runner
// for tests. Generate-only: the sweep inserts one report per driver
// per week, only for weeks with activity, and notifies through the
// existing notification service; it never changes a job, a payout,
// or an issue, and it never emails a driver with an empty week.
'use strict';

const pool = require('../db');
const logger = require('../utils/logger');
const { generateWeeklyReports } = require('../services/deliveryWeeklyReportService');

const JOB_NAME = 'delivery-weekly-report';
const CRON_EXPRESSION = '5 6 * * 1'; // Mondays 06:05 UTC

async function runDeliveryWeeklyReportJob(dbClient) {
  const db = dbClient || pool;
  const result = await generateWeeklyReports(db);
  if (result.generated > 0 || result.failed > 0) {
    logger.info('Delivery weekly report sweep completed', { ...result, job: JOB_NAME });
  }
  return result;
}

function startDeliveryWeeklyReportJob() {
  const cron = require('node-cron');
  cron.schedule(CRON_EXPRESSION, async () => {
    try {
      await runDeliveryWeeklyReportJob();
    } catch (err) {
      logger.error('Delivery weekly report cron error', { error: err.message });
    }
  });
  logger.info('Delivery weekly report job scheduled', { cron: CRON_EXPRESSION });
}

module.exports = {
  startDeliveryWeeklyReportJob,
  runDeliveryWeeklyReportJob,
  generateWeeklyReports,
  cronExpression: CRON_EXPRESSION,
};
