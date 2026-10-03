'use strict';

/**
 * Shared job-cancellation core.
 *
 * The user-facing flow (POST /api/jobs/:id/cancel, server/controllers/jobController.js)
 * and the agent flow (POST /api/admin/jobs/:jobId/cancel,
 * server/controllers/agentJobActions.js) run through the SAME transaction and the
 * SAME post-commit side effects. Do not fork this logic: fix it here and both
 * flows inherit the fix.
 *
 * Actor kinds:
 *   'customer' | 'helper' — the job's own parties (derived when 'auto' is passed)
 *   'admin'              — a platform admin acting with standing authority
 *                          (grant-gated upstream). Admin-initiated cancels never
 *                          charge a cancellation fee: fees compensate the helper
 *                          for a *customer's* late cancellation, and the platform
 *                          must not collect money from a customer who did not
 *                          initiate the cancel. The live-escrow block still
 *                          applies (refund first), and every notification,
 *                          calendar, bid, and audit side effect is identical.
 */

const pool = require('../db');
const logger = require('../utils/logger');
const { withJobTransaction } = require('../utils/transaction');
const AppError = require('../utils/appError');
const { logAdminAction } = require('./auditService');

const PRE_ACCEPTANCE_STATUSES = ['draft', 'published', 'matched', 'negotiating'];
const POST_ACCEPTANCE_STATUSES = ['accepted', 'in_progress'];

/**
 * Fail-closed admin audit write, executed INSIDE the cancellation transaction.
 * logAdminAction throws when given a transaction client, so a failed audit
 * row rolls the whole cancellation back instead of leaving a cancelled job
 * with no audit trail.
 */
async function writeAgentAudit(client, { adminId, jobId, job, beforeStatus, reason }) {
  await logAdminAction({
    client,
    adminId,
    action: 'agent_cancel_job',
    targetType: 'job',
    targetId: jobId,
    description: `Support agent cancelled job (was ${beforeStatus}): ${reason}`,
    before: {
      status: beforeStatus,
      client_id: job.client_id,
      assigned_helper_id: job.assigned_helper_id,
    },
    after: { status: 'cancelled' },
  });
}

/**
 * Run the cancellation transaction. Throws AppError on every invalid state;
 * never partially applies (single withJobTransaction unit).
 *
 * Returns the same result shape the user-facing handler has always produced,
 * plus `type` ('pre_acceptance' | 'post_acceptance') and `before_status`.
 */
async function cancelJobTransaction({ jobId, actorId, actorKind = 'auto', reason }) {
  return withJobTransaction(
    pool,
    async (client) => {
      // 1. Get the job
      const jobResult = await client.query(
        `SELECT * FROM jobs WHERE id = $1`,
        [jobId]
      );

      if (jobResult.rows.length === 0) {
        throw new AppError('Job not found', 404);
      }

      const job = jobResult.rows[0];
      const beforeStatus = job.status;

      // 2. Resolve and check authorization (must be customer OR helper, or a grant-gated admin)
      const isCustomer = job.client_id === actorId;
      const isHelper = job.assigned_helper_id === actorId;

      let kind = actorKind;
      if (kind === 'auto') {
        if (isCustomer) kind = 'customer';
        else if (isHelper) kind = 'helper';
        else throw new AppError('Not authorized to cancel this job', 403);
      }
      const isAdmin = kind === 'admin';
      const asCustomer = kind === 'customer';

      // 3a. Pre-acceptance cancellation — no fee; customer or admin only
      if (PRE_ACCEPTANCE_STATUSES.includes(job.status)) {
        if (kind === 'helper') {
          throw new AppError('Only the customer can cancel a job before a helper is assigned', 403);
        }

        // Block if there are live escrow holds (refund the payment first)
        const { rows: payRows } = await client.query(`
          SELECT id FROM payments
          WHERE job_id = $1 AND status IN ('authorized','captured')
            AND escrow_status IN ('authorized','held','disputed')
        `, [jobId]);
        if (payRows.length > 0) {
          throw new AppError(
            'Cannot cancel job with pending payments. Refund the payment first.',
            409, 'pending_payments'
          );
        }

        // Guarded UPDATE: a concurrent cancel wins the row, we see zero rows and 409.
        const { rows: updated } = await client.query(
          `UPDATE jobs SET status = 'cancelled', deleted_at = now(), updated_at = now()
             ${isAdmin ? `, cancellation_reason = $2` : ''}
           WHERE id = $1 AND status IN ('draft','published','matched','negotiating')
           RETURNING *`,
          isAdmin ? [jobId, reason || null] : [jobId]
        );
        if (!updated.length) throw new AppError('Job state changed during cancellation', 409, 'state_conflict');

        const { rows: rejectedBids } = await client.query(`
          UPDATE bids SET status = 'rejected', updated_at = now()
          WHERE job_id = $1 AND status IN ('pending','accepted')
          RETURNING id, helper_id
        `, [jobId]);

        await client.query(`
          UPDATE appointments
             SET status = 'cancelled', cancelled_by = $2,
                 cancelled_at = now(), updated_at = now()
           WHERE job_id = $1 AND status NOT IN ('completed','cancelled')
        `, [jobId, kind]);

        logger.info('Job cancelled (pre-acceptance)', {
          jobId, actorId, actorKind: kind, status: beforeStatus, rejectedBids: rejectedBids.length
        });

        if (isAdmin) {
          await writeAgentAudit(client, { adminId: actorId, jobId, job, beforeStatus, reason });
        }

        return { type: 'pre_acceptance', before_status: beforeStatus, job: updated[0], rejectedBids, cancelled_by: kind };
      }

      // 3b. Post-acceptance states only beyond this point
      if (!POST_ACCEPTANCE_STATUSES.includes(job.status)) {
        throw new AppError('Job cannot be cancelled in current state', 409);
      }

      // 4. Get the accepted bid
      const bidResult = await client.query(
        `SELECT * FROM bids WHERE job_id = $1 AND status = $2`,
        [jobId, 'accepted']
      );

      if (bidResult.rows.length === 0) {
        throw new AppError('No accepted bid found', 409);
      }

      const bid = bidResult.rows[0];
      const paymentMethod = bid.payment_method;
      const cancellationPolicy = bid.cancellation_policy || {};

      // 5. Calculate cancellation fee (customer-initiated OxSteed payments only;
      //    admin-initiated cancels never charge a fee)
      // Uses timing-based tiers: 0% (3+ days), 50% (24h-3d), 100% (<24h)
      let feeToPay = 0;
      let feeToPlatform = 0;
      let feeToHelper = 0;
      let feePercentage = 0;

      if (asCustomer && paymentMethod === 'oxsteed') {
        // Calculate hours until scheduled start
        const hoursBeforeStart = job.scheduled_date
          ? (new Date(job.scheduled_date) - Date.now()) / (1000 * 60 * 60)
          : null;

        // Determine fee tier based on timing
        // Fee cap = 10% of bid amount, capped at $100
        const feeCap = Math.min(Math.round(bid.amount * 0.1), 10000);

        if (hoursBeforeStart === null || hoursBeforeStart >= 72) {
          // 3+ days before: no fee
          feePercentage = 0;
        } else if (hoursBeforeStart >= 24) {
          // 24h to 3 days before: 50% of cap
          feePercentage = 50;
        } else if (hoursBeforeStart > 0) {
          // Less than 24h before: 100% of cap
          feePercentage = 100;
        } else {
          // Already past scheduled start: 100% of cap (job already in progress or late cancellation)
          feePercentage = 100;
        }

        // Calculate actual fee from percentage
        feeToPay = Math.round((feeCap * feePercentage) / 100);

        if (feeToPay > 0) {
          // Split the fee: Platform 7.1%, Stripe ~2.2%, helper gets remainder
          feeToPlatform = Math.round(feeToPay * 0.071);
          const stripeFee = Math.round(feeToPay * 0.022);
          feeToHelper = feeToPay - feeToPlatform - stripeFee;
        }

        logger.info('Cancellation fee calculated', {
          jobId,
          hoursBeforeStart: hoursBeforeStart?.toFixed(1),
          feePercentage,
          feeCap,
          feeToPay,
          feeToHelper,
          feeToPlatform
        });
      }

      // 6. Update job status to cancelled
      await client.query(
        `UPDATE jobs SET
          status = 'cancelled',
          cancelled_at = NOW(),
          cancellation_reason = $1,
          updated_at = NOW()
         WHERE id = $2`,
        [reason || null, jobId]
      );

      // 7. Update bid with fee information
      if (paymentMethod === 'oxsteed' && feeToPay > 0) {
        await client.query(
          `UPDATE bids SET
            cancellation_fee_cents = $1,
            cancellation_fee_paid = FALSE,
            updated_at = NOW()
           WHERE id = $2`,
          [feeToPay, bid.id]
        );
      }

      // 8. Free up the calendar (mark appointment as cancelled)
      await client.query(
        `UPDATE appointments SET
          status = 'cancelled',
          cancelled_at = NOW()
         WHERE job_id = $1`,
        [jobId]
      );

      // 9. Write cancellation audit log
      const feeReason = asCustomer
        ? (feeToPay > 0 ? `customer_initiated_fee_${feePercentage}pct` : 'no_fee_advance')
        : (isAdmin ? 'admin_initiated_no_fee' : 'helper_initiated_no_fee');

      const hoursBeforeStart = job.scheduled_date
        ? (new Date(job.scheduled_date) - Date.now()) / (1000 * 60 * 60)
        : null;

      const auditResult = await client.query(
        `INSERT INTO cancellation_audit_log (
          job_id, cancelled_by_id, cancelled_by_role, counterparty_id,
          fee_reason, fee_amount_cents, fee_status,
          hours_before_start, cancellation_reason, payment_method, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
        RETURNING id`,
        [
          jobId,
          actorId,
          kind,
          asCustomer ? job.assigned_helper_id : job.client_id,
          feeReason,
          feeToPay,
          feeToPay > 0 ? 'pending' : 'none',
          hoursBeforeStart,
          reason || null,
          paymentMethod
        ]
      );

      const auditLogId = auditResult.rows[0]?.id;

      // 10. Record cancellation fee row (customer cancellations with fee only)
      let feeRecordId = null;
      if (asCustomer && feeToPay > 0 && paymentMethod === 'oxsteed') {
        const feeRecord = await client.query(
          `INSERT INTO cancellation_fees (
            job_id, audit_log_id, payer_id, payee_id,
            gross_fee_cents, helper_gets_cents, platform_cut_cents, stripe_fee_cents,
            status, created_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending', NOW())
          RETURNING id`,
          [
            jobId,
            auditLogId,
            job.client_id,
            job.assigned_helper_id,
            feeToPay,
            feeToHelper,
            feeToPlatform,
            feeToPay - feeToHelper - feeToPlatform
          ]
        );
        feeRecordId = feeRecord.rows[0]?.id;
      }

      if (isAdmin) {
        await writeAgentAudit(client, { adminId: actorId, jobId, job, beforeStatus, reason });
      }

      // Return result for post-commit notifications
      return {
        type: 'post_acceptance',
        before_status: beforeStatus,
        job_id: jobId,
        cancelled_at: new Date(),
        cancelled_by: kind,
        fee_charged_cents: feeToPay,
        fee_to_helper_cents: feeToHelper,
        fee_to_platform_cents: feeToPlatform,
        payment_method: paymentMethod,
        helper_id: job.assigned_helper_id,
        customer_id: job.client_id,
        audit_log_id: auditLogId,
        fee_record_id: feeRecordId
      };
    },
    'cancel_job'
  );
}

/**
 * Post-commit side effects shared by both cancellation flows.
 * Runs AFTER the transaction commits: socket notifications to both parties,
 * fire-and-forget Stripe fee collection (when a fee applies), and reputation
 * recalculation. Never throws: every step is guarded so a notification
 * failure cannot turn a committed cancel into an error response.
 */
async function finalizeJobCancellation(result) {
  // Pre-acceptance: no fee/socket machinery (matches the user-facing flow)
  if (result.type === 'pre_acceptance') {
    return;
  }

  // Post-acceptance: send socket notification to both parties
  try {
    const { broadcastToUser } = require('./socketService');
    broadcastToUser(result.customer_id, 'job:cancelled', {
      id: result.job_id,
      status: 'cancelled',
      cancelled_by: result.cancelled_by,
      fee_charged_cents: result.fee_charged_cents
    });
    broadcastToUser(result.helper_id, 'job:cancelled', {
      id: result.job_id,
      status: 'cancelled',
      cancelled_by: result.cancelled_by,
      fee_to_helper_cents: result.fee_to_helper_cents
    });
  } catch (socketErr) {
    logger.warn('Failed to send job cancellation socket notification', { jobId: result.job_id, error: socketErr.message });
  }

  // Fire-and-forget: collect cancellation fee via Stripe (if applicable)
  if (result.fee_record_id && result.fee_charged_cents > 0) {
    try {
      const { collectCancellationFee } = require('./cancellationFeeService');
      collectCancellationFee({
        feeRecordId:  result.fee_record_id,
        customerId:   result.customer_id,
        helperId:     result.helper_id,
        feeTotalCents: result.fee_charged_cents,
        feeToHelper:  result.fee_to_helper_cents,
      }).catch((err) => logger.error('Stripe cancellation fee collection failed', { feeRecordId: result.fee_record_id, error: err.message }));
    } catch (_) { /* module load safety */ }
  }

  // Fire-and-forget: update reputation score after cancellation
  try {
    const { recalculateUserReputation } = require('../controllers/reputationController');
    if (result.customer_id) recalculateUserReputation(result.customer_id).catch(() => {});
    if (result.helper_id)   recalculateUserReputation(result.helper_id).catch(() => {});
  } catch (_) { /* non-fatal */ }

  logger.info('Job cancellation recorded', {
    jobId: result.job_id,
    cancelledBy: result.cancelled_by,
    feeCharged: result.fee_charged_cents,
    auditLogId: result.audit_log_id,
    feeRecordId: result.fee_record_id
  });
}

module.exports = { cancelJobTransaction, finalizeJobCancellation };
