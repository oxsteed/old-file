'use strict';

// Review P2-478: a helper's completion request on a Tier-3 escrow job
// auto-confirms (captures the escrow and completes the job) after
// HELPER_COMPLETION_CONFIRM_HOURS when the customer neither confirmed nor
// opened a dispute.
const logger = require('../utils/logger');
const { withFencedJobLock } = require('./jobLockingService');

const JOB_NAME = 'helper-completion-auto-confirm';
const CRON_EXPRESSION = '15 * * * *';

async function runHelperCompletionAutoConfirm() {
  const { autoConfirmHelperCompletions } = require('../controllers/jobController');
  let result = { locked: false };
  await withFencedJobLock(JOB_NAME, async (fence) => {
    fence.assertActive();
    result = { locked: true, ...(await autoConfirmHelperCompletions()) };
  }, 900, { throwOnError: true });
  if (result.failures?.length) {
    logger.error('Helper completion auto-confirm had failures', { failures: result.failures });
  }
  return result;
}

function startHelperCompletionAutoConfirmJob() {
  const cron = require('node-cron');
  cron.schedule(CRON_EXPRESSION, () => {
    runHelperCompletionAutoConfirm().catch((err) =>
      logger.error('Helper completion auto-confirm cron error', { error: err.message }));
  });
  logger.info('Helper completion auto-confirm scheduled', { cron: CRON_EXPRESSION });
}

module.exports = { runHelperCompletionAutoConfirm, startHelperCompletionAutoConfirmJob, JOB_NAME };
