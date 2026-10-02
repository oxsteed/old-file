'use strict';

// Dual-posting backfill sweeper (migration 655): replays food-wallet
// dual-postings that were queued while the OxSteed Credit rail was
// disabled. No-op while the rail is off, so it never raises incidents
// for the disabled-rail state.

const cron = require('node-cron');
const db = require('../db');
const logger = require('../utils/logger');
const { replayDualPostingBackfill } = require('../services/oxsteedCreditSubBankService');
const { withFencedJobLock } = require('./jobLockingService');
const { recordOxsteedCreditJobFailure } = require('./oxsteedCreditJobFailure');
const { recordOxsteedCreditWorkerRun } = require('../services/oxsteedCreditWorkerHeartbeat');

// Every 5 minutes, offset from the minute boundary to avoid a
// connection-pool burst with the other credit workers.
const CRON_EXPRESSION = '30 */5 * * * *';
const JOB_NAME = 'oxsteed-credit-dual-posting-backfill';

async function runOxsteedCreditDualPostingBackfill() {
  let result = { replayed: 0, failed: 0, parked: 0 };
  let lockAcquired = false;
  try {
    await withFencedJobLock(JOB_NAME, async (fence) => {
      fence.assertActive(); // E03: abort the run if the job lease was lost
      lockAcquired = true;
      result = await replayDualPostingBackfill(db, { limit: 100 });
    }, 120, { throwOnLockError: true });
    if (lockAcquired) await recordOxsteedCreditWorkerRun({ jobName: JOB_NAME, result });
  } catch (error) {
    if (lockAcquired) await recordOxsteedCreditWorkerRun({ jobName: JOB_NAME, error });
    throw error;
  }
  return result;
}

function startOxsteedCreditDualPostingBackfillJob() {
  cron.schedule(CRON_EXPRESSION, () => {
    runOxsteedCreditDualPostingBackfill().catch((error) => {
      return recordOxsteedCreditJobFailure({
        jobName: JOB_NAME,
        error,
        details: {},
      });
    });
  });
  logger.info('OxSteed Credit dual-posting backfill job scheduled', { cron: CRON_EXPRESSION });
}

module.exports = {
  CRON_EXPRESSION,
  JOB_NAME,
  runOxsteedCreditDualPostingBackfill,
  startOxsteedCreditDualPostingBackfillJob,
};
