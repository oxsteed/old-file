'use strict';

/**
 * OxSteed Logistics — refund proposal expiry job (Phase 3).
 *
 * Wires server/services/logisticsRefundService.expireStaleProposals into the
 * background-worker schedule. Without this, stale `proposed` refund cases
 * would encumber their payment attempt's refundable balance forever (active
 * statuses reserve the cap), blocking legitimate later refunds.
 *
 * Cadence: hourly at minute 11 UTC (offset from sibling maintenance jobs to
 * avoid a connection-pool burst at the minute boundary). Proposals expire
 * PROPOSAL_TTL_HOURS (72h) after creation without approval; the expiry
 * releases their encumbrance and notifies the buyer (refund_expired).
 *
 * Concurrency: runs under the fenced job lock (single runner). Skips
 * quietly when the logistics refund tables are not present yet (the
 * payments/refunds workstreams land independently).
 */

const cron = require('node-cron');
const pool = require('../db');
const logger = require('../utils/logger');
const { withFencedJobLock } = require('./jobLockingService');
const { createDefaultDeps, _internal } = require('../services/logisticsRefundPorts');
const { expireStaleProposals, PROPOSAL_TTL_HOURS } = require('../services/logisticsRefundService');

const CRON_EXPRESSION = '11 * * * *';
const CRON_TIMEZONE = 'UTC';
const JOB_NAME = 'logistics-refund-proposal-expiry';

async function runLogisticsRefundProposalExpiry() {
  const result = { expired: 0, ids: [] };
  await withFencedJobLock(JOB_NAME, async (fence) => {
    fence.assertActive(); // abort the run if the job lease was lost
    const query = fence.db.query.bind(fence.db);
    if (!(await _internal.tableExists(query, 'logistics_refund_cases'))) {
      logger.warn('logistics-refund-proposal-expiry skipped: logistics_refund_cases table not present');
      result.skipped = 'table_missing';
      return;
    }
    const deps = createDefaultDeps(fence.db);
    const out = await expireStaleProposals(deps, { olderThanHours: PROPOSAL_TTL_HOURS });
    result.expired = out.expired;
    result.ids = out.ids;
    if (out.expired) {
      logger.info('Logistics refund proposals expired', { count: out.expired, olderThanHours: PROPOSAL_TTL_HOURS });
    }
  }, 300, { throwOnLockError: true });
  return result;
}

function startLogisticsRefundProposalExpiryJob() {
  cron.schedule(CRON_EXPRESSION, () => {
    runLogisticsRefundProposalExpiry().catch((error) => {
      logger.error('Logistics refund proposal expiry job failed', { error: error.message });
    });
  }, { timezone: CRON_TIMEZONE });
  logger.info('Logistics refund proposal expiry job scheduled', {
    cron: CRON_EXPRESSION, timezone: CRON_TIMEZONE, olderThanHours: PROPOSAL_TTL_HOURS,
  });
}

module.exports = {
  CRON_EXPRESSION,
  CRON_TIMEZONE,
  JOB_NAME,
  PROPOSAL_TTL_HOURS,
  runLogisticsRefundProposalExpiry,
  startLogisticsRefundProposalExpiryJob,
};
