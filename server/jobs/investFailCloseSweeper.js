'use strict';

// OxSteed Invest fail-close sweeper (Track 6 verifier fix, spec section 7).
//
// A raise whose deadline passed with the target unmet must not strand
// reservations as `reserved` forever: this job fail-closes those
// opportunities on an hourly pass, releasing every pending reservation
// back to its original lots. The sweep itself only picks up
// past-deadline, target-unmet opportunities; a past-deadline raise
// that met its target is left for a reviewer (closing it late, or
// fail-closing it, is a human decision). A manual fail-close by a
// reviewer is always available at POST
// /api/invest/opportunities/:id/fail-close for the cases the sweeper
// deliberately leaves alone.
//
// The run is fenced with the shared job lock (same shape as the other
// sweepers in this directory), so two replicas cannot fail-close the
// same opportunity twice. Fail-close is a protective release, not a
// live commitment, so the run is not gated on
// INVEST_COMMITMENTS_ENABLED; it skips entirely while the Invest
// master flag is off.

const cron = require('node-cron');
const logger = require('../utils/logger');
const { sweepUnsuccessfulOpportunities } = require('../services/invest/settlementService');
const { investEnabled } = require('../services/invest/flags');
const { withFencedJobLock } = require('./jobLockingService');

// Hourly, offset from the top of the hour to avoid the minute-boundary burst.
const CRON_EXPRESSION = '10 * * * *';
const JOB_NAME = 'invest-fail-close-sweeper';

async function runInvestFailCloseSweeper() {
  if (!investEnabled()) {
    return { skipped: 'invest_disabled' };
  }
  let result = { failClosed: [], failed: [] };
  await withFencedJobLock(JOB_NAME, async () => {
    result = await sweepUnsuccessfulOpportunities({ limit: 100 });
  }, 300);
  if (result.failClosed.length) {
    logger.info('OxSteed Invest fail-close sweep complete', {
      failClosed: result.failClosed.map((row) => ({
        opportunityId: row.opportunityId,
        releasedCommitmentCount: row.releasedCommitmentCount,
        releasedCents: row.releasedCents,
      })),
    });
  }
  if (result.failed.length) {
    logger.error('OxSteed Invest fail-close sweep had failures', { failed: result.failed });
  }
  return result;
}

function startInvestFailCloseSweeperJob() {
  cron.schedule(CRON_EXPRESSION, () => {
    runInvestFailCloseSweeper().catch((error) => {
      logger.error('OxSteed Invest fail-close sweeper failed', { error: error.message });
    });
  });
  logger.info('OxSteed Invest fail-close sweeper scheduled', { cron: CRON_EXPRESSION });
}

module.exports = {
  CRON_EXPRESSION,
  runInvestFailCloseSweeper,
  startInvestFailCloseSweeperJob,
};
