'use strict';
// Batch J (341, G6-10): every-15-minutes sweep that escalates open
// maintenance requests past their SLA target. Follows the
// deliveryDelayEscalation shape: cron, batched sweep, exported runner for
// tests. The alert itself is the shared seam from D-510:
// sendSlaBreachAlerts(businessId) notifies the property managers/coverage
// or the business owner once per breach and stamps sla_alerted_at, so a
// breach is alerted once however it is triggered (this sweep or the manual
// POST /alerts/notify). The sweep only visits businesses with an
// un-alerted breach, and never changes a request's status: escalation is a
// notice, not a reassignment. No on-call rotation is invented (open
// decision, D-515).
const pool = require('../db');
const logger = require('../utils/logger');
const { sendSlaBreachAlerts } = require('../services/propertyManager/upkeepService');

const JOB_NAME = 'property-sla-breach-escalation';
const CRON_EXPRESSION = '*/15 * * * *'; // every 15 minutes

async function runPropertySlaBreachEscalationJob(dbClient) {
  const db = dbClient || pool;
  const { rows } = await db.query(`SELECT DISTINCT business_id FROM property_maintenance_requests
    WHERE sla_target_at IS NOT NULL AND sla_target_at < NOW() AND sla_alerted_at IS NULL
      AND status NOT IN ('completed','cancelled','rejected')`);
  let breaches = 0; let notified = 0; let failed = 0;
  for (const { business_id } of rows) {
    try {
      const out = await sendSlaBreachAlerts(business_id);
      breaches += out.breaches; notified += out.notified;
    } catch (err) {
      failed += 1;
      logger.error('Property SLA breach escalation failed for business', { business_id, error: err.message });
    }
  }
  const result = { businesses: rows.length, breaches, notified, failed };
  if (breaches > 0 || failed > 0) {
    logger.info('Property SLA breach escalation sweep completed', { ...result, job: JOB_NAME });
  }
  return result;
}

function startPropertySlaBreachEscalationJob() {
  const cron = require('node-cron');
  cron.schedule(CRON_EXPRESSION, async () => {
    try {
      await runPropertySlaBreachEscalationJob();
    } catch (err) {
      logger.error('Property SLA breach escalation cron error', { error: err.message });
    }
  });
  logger.info('Property SLA breach escalation job scheduled', { cron: CRON_EXPRESSION });
}

module.exports = {
  startPropertySlaBreachEscalationJob,
  runPropertySlaBreachEscalationJob,
  cronExpression: CRON_EXPRESSION,
};
