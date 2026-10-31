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
const { PRE_ACCEPTANCE_STATUSES } = require('../services/jobCancellationService');
const { verifyStepupChallenge, issueStepupChallenge } = require('../services/stepupChallengeService');

function alreadyCancelledResponse(jobId) {
  return {
    success: true,
    alreadyCancelled: true,
    data: { job_id: jobId, status: 'cancelled', cancelled_by: 'admin' },
    message: 'Job was already cancelled.',
  };
}

/**
 * Audit fix (finding 24): issue the email-OTP step-up challenge an agent
 * completes before POST /jobs/:jobId/cancel when the job is past
 * acceptance (fees may apply). Mirrors the refund challenge issuance.
 */
exports.issueAgentJobCancelStepupChallenge = async (req, res, next) => {
  try {
    const adminId = req.user?.id;
    if (!adminId) throw new AppError('Unauthorized.', 401, 'unauthorized');
    const { challenge, delivery } = await issueStepupChallenge({
      actorUserId: adminId,
      actorEmail: req.user?.email,
      actionType: 'agent_job_cancel',
      amountCents: 1,
      currencyCode: 'USD',
    });
    res.status(201).json({
      challenge: {
        id: challenge.id,
        actionType: challenge.actionType,
        amountCents: challenge.amountCents,
        currencyCode: challenge.currencyCode,
        expiresAt: challenge.expiresAt,
      },
      delivery,
    });
  } catch (err) { next(err); }
};

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
    // Audit fix (finding 24): post-acceptance cancels can collect a
    // cancellation fee from the customer, so they need a fresh step-up
    // challenge. Pre-acceptance cancels never charge a fee and keep the
    // session-only gate.
    // Auth audit item 6, intentionally unbound: the cancellation fee is
    // computed inside cancelJobTransaction; there is no pre-computable
    // authoritative figure, and pre-computing at verify time would
    // duplicate logic that could drift from the fee actually charged.
    // The issue side keeps its non-amount challenge (amountCents: 1).
    if (!PRE_ACCEPTANCE_STATUSES.includes(existing[0].status)) {
      await verifyStepupChallenge({
        challengeId: req.body?.stepupChallengeId || req.body?.stepup_challenge_id,
        actorUserId: adminId,
        actionType: 'agent_job_cancel',
        code: req.body?.stepupCode || req.body?.stepup_code,
      });
    }

    let result;
    try {
      result = await cancelJobTransaction({ jobId, actorId: adminId, actorKind: 'admin', reason, req });
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
