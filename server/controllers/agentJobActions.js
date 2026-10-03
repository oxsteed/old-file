'use strict';

/**
 * Agent-initiated job cancellation (support workspace).
 *
 * POST /api/admin/jobs/:jobId/cancel
 * Route: server/routes/agentJobActions.js — requireAdmin + requirePermission('issue_refunds').
 *
 * Contract:
 * - `reason` (body, non-empty) is required → 400 `reason_required` otherwise.
 * - Runs through the SAME transaction and side effects as the user-facing
 *   cancel (server/services/jobCancellationService.js): bid rejections,
 *   calendar release, cancellation_audit_log, socket notifications to both
 *   parties, fee collection when applicable. The actor is recorded as the
 *   admin; admin-initiated cancels never charge a cancellation fee (see the
 *   service for the policy note). The live-escrow block still applies:
 *   refund the payment first (409 `pending_payments`).
 * - Idempotent: an already-cancelled job returns a clean 200 with
 *   `alreadyCancelled: true` (including the concurrent-cancel race, which is
 *   re-checked against the row before surfacing the 409).
 * - Fail closed: any transaction failure aborts the whole cancel; the admin
 *   audit row is written inside the same transaction so a cancel can never
 *   commit without its audit entry.
 */

const pool = require('../db');
const logger = require('../utils/logger');
const AppError = require('../utils/appError');
const { cancelJobTransaction, finalizeJobCancellation } = require('../services/jobCancellationService');

function alreadyCancelledResponse(jobId) {
  return {
    success: true,
    alreadyCancelled: true,
    data: { job_id: jobId, status: 'cancelled', cancelled_by: 'admin' },
    message: 'Job was already cancelled.',
  };
}

exports.cancelJobAsAgent = async (req, res, next) => {
  try {
    const { jobId } = req.params;
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';

    if (!reason) {
      return res.status(400).json({
        error: 'A cancellation reason is required.',
        code: 'reason_required',
      });
    }

    const adminId = req.user.id;

    // Idempotency fast path: already-cancelled is a clean non-error, never re-applied.
    const { rows: existing } = await pool.query('SELECT status FROM jobs WHERE id = $1', [jobId]);
    if (existing.length === 0) {
      return res.status(404).json({ error: 'Job not found.', code: 'job_not_found' });
    }
    if (existing[0].status === 'cancelled') {
      return res.json(alreadyCancelledResponse(jobId));
    }

    let result;
    try {
      result = await cancelJobTransaction({ jobId, actorId: adminId, actorKind: 'admin', reason });
    } catch (err) {
      // Race-safe idempotency: a concurrent agent (or the user) may have won
      // the row between our fast-path check and the guarded UPDATE. Re-check
      // the row; only surface the 409 if the job is genuinely not cancelled.
      if (err instanceof AppError && err.status === 409) {
        const { rows } = await pool.query('SELECT status FROM jobs WHERE id = $1', [jobId]);
        if (rows[0]?.status === 'cancelled') {
          return res.json(alreadyCancelledResponse(jobId));
        }
      }
      throw err;
    }

    // Post-commit notifications to both parties + fee/reputation side effects.
    await finalizeJobCancellation(result);

    if (result.type === 'pre_acceptance') {
      return res.json({
        success: true,
        alreadyCancelled: false,
        data: {
          job_id: result.job.id,
          status: 'cancelled',
          before_status: result.before_status,
          cancelled_at: new Date(),
          cancelled_by: 'admin',
          fee_charged_cents: 0,
          rejected_bids: result.rejectedBids.length,
        },
        message: 'Job cancelled.',
      });
    }

    return res.json({
      success: true,
      alreadyCancelled: false,
      data: {
        job_id: result.job_id,
        status: 'cancelled',
        before_status: result.before_status,
        cancelled_at: result.cancelled_at,
        cancelled_by: 'admin',
        fee_charged_cents: result.fee_charged_cents,
        fee_to_helper_cents: result.fee_to_helper_cents,
        fee_to_platform_cents: result.fee_to_platform_cents,
        payment_method: result.payment_method,
      },
      message: 'Job cancelled.',
    });
  } catch (err) {
    if (err instanceof AppError) {
      return next(err);
    }
    logger.error('Agent job cancellation failed', {
      jobId: req.params?.jobId,
      adminId: req.user?.id,
      error: err.message,
    });
    return next(new AppError('Failed to cancel job.', 500));
  }
};
