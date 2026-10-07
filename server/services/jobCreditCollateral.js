'use strict';

/**
 * Phase 5 — Credit Everywhere: job Credit escrow collateral lifecycle.
 *
 * When a job is accepted with payment_method='oxsteed', the customer's
 * Credit is held as escrow collateral via the shared spend adapter
 * (surface=jobs, mode=hold). The hold ID is stored in jobs.metadata.
 *
 * - Job completed → release the hold (collateral served its purpose; the
 *   actual payment flows through the existing escrow machinery).
 * - Job cancelled → release the hold (no payment due; existing fee
 *   machinery handles cancellation fees separately).
 *
 * Both are idempotent and fail-open (logged, never blocking).
 */

const pool = require('../db');
const logger = require('../utils/logger');
const creditService = require('./oxsteedCreditService');

async function getCollateralHoldId(jobId) {
  const { rows } = await pool.query(
    `SELECT metadata->>'creditCollateralHoldId' AS hold_id FROM jobs WHERE id = $1`,
    [jobId]
  );
  const holdId = rows[0]?.hold_id;
  return holdId || null;
}

async function releaseJobCreditCollateral(jobId) {
  const holdId = await getCollateralHoldId(jobId);
  if (!holdId) return { released: false, reason: 'no_collateral' };
  try {
    await creditService.releaseCreditHold({
      holdId,
      actorUserId: null,
      reason: 'job_collateral_released',
    });
    await pool.query(
      `UPDATE jobs SET metadata = COALESCE(metadata, '{}'::jsonb) || '{"creditCollateralReleased": true}'::jsonb WHERE id = $1`,
      [jobId]
    );
    logger.info('jobCreditCollateral.released', { jobId, holdId });
    return { released: true, holdId };
  } catch (err) {
    logger.warn('jobCreditCollateral.release_failed', { jobId, holdId, error: err.message });
    return { released: false, error: err.message };
  }
}

module.exports = { releaseJobCreditCollateral, getCollateralHoldId };
