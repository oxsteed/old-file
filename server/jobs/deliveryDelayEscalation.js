// server/jobs/deliveryDelayEscalation.js
// Group 9 Slice E (item 485): every-15-minutes sweep that escalates
// assigned/in-transit jobs running more than 30 minutes past their ETA
// (D-80). Follows the deliveryWindowWarnings shape: cron, batched sweep,
// exported runner for tests. Escalate-only: the sweep opens an
// auto-detected delay issue, notifies through the delay_escalated event,
// and stamps the job for the dispatch board; it never changes a job's
// status or dispatch_state, never cancels or reschedules, and never
// blocks the driver from delivering.
'use strict';

const pool = require('../db');
const logger = require('../utils/logger');
const { sweepDelayedDeliveries } = require('../services/deliveryDelayEscalationService');

const JOB_NAME = 'delivery-delay-escalation';
const CRON_EXPRESSION = '*/15 * * * *'; // every 15 minutes

async function runDeliveryDelayEscalationJob(dbClient) {
  const db = dbClient || pool;
  const result = await sweepDelayedDeliveries(db);
  if (result.escalated > 0 || result.failed > 0) {
    logger.info('Delivery delay escalation sweep completed', { ...result, job: JOB_NAME });
  }
  return result;
}

function startDeliveryDelayEscalationJob() {
  const cron = require('node-cron');
  cron.schedule(CRON_EXPRESSION, async () => {
    try {
      await runDeliveryDelayEscalationJob();
    } catch (err) {
      logger.error('Delivery delay escalation cron error', { error: err.message });
    }
  });
  logger.info('Delivery delay escalation job scheduled', { cron: CRON_EXPRESSION });
}

module.exports = {
  startDeliveryDelayEscalationJob,
  runDeliveryDelayEscalationJob,
  sweepDelayedDeliveries,
  cronExpression: CRON_EXPRESSION,
};
