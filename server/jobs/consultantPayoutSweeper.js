// server/jobs/consultantPayoutSweeper.js
// G10-1 (Nov 21 audit): retry consultant payouts that are pending, parked,
// or failed. A completion parks when the Credit rail is off / frozen or
// the consultant's country is not legally cleared for Credit payments, and
// fails on any other attempt error; this hourly sweep re-attempts them
// under their original idempotency keys, so a retry can never pay twice.
// The run skips quietly while the rail kill-switch is off (a disabled rail
// is operator state, not a failure); parked rows retry on the first tick
// after the rail comes back. Fenced with withFencedJobLock so two workers
// can never sweep the same payout concurrently.
'use strict';

const logger = require('../utils/logger');
const { skipCreditJobWhenRailDisabled } = require('../services/oxsteedCreditService');
const { sweepDuePayouts } = require('../services/consultantPayoutService');
const { withFencedJobLock } = require('./jobLockingService');

const JOB_NAME = 'consultant-payout-retry';
const CRON_EXPRESSION = '47 * * * *'; // hourly, offset from other jobs
const BATCH_SIZE = 100;

async function runConsultantPayoutSweeper({ limit = BATCH_SIZE } = {}) {
  if (await skipCreditJobWhenRailDisabled(JOB_NAME)) {
    return { skipped: 'rail_disabled' };
  }
  let results = [];
  await withFencedJobLock(JOB_NAME, async () => {
    results = await sweepDuePayouts({ limit });
  });
  const paid = results.filter((r) => r.status === 'paid').length;
  const parked = results.filter((r) => r.status === 'parked').length;
  const failed = results.filter((r) => r.status === 'failed' || r.status === 'error').length;
  if (results.length > 0) {
    logger.info('Consultant payout sweep completed', {
      job: JOB_NAME,
      examined: results.length,
      paid,
      parked,
      failed,
    });
  }
  return { examined: results.length, paid, parked, failed, results };
}

function startConsultantPayoutSweeperJob() {
  const cron = require('node-cron');
  cron.schedule(CRON_EXPRESSION, async () => {
    try {
      await runConsultantPayoutSweeper();
    } catch (err) {
      logger.error('Consultant payout sweeper cron error', { error: err.message });
    }
  });
  logger.info('Consultant payout sweeper job scheduled', { cron: CRON_EXPRESSION });
}

module.exports = {
  startConsultantPayoutSweeperJob,
  runConsultantPayoutSweeper,
  sweepDuePayouts,
  cronExpression: CRON_EXPRESSION,
};
