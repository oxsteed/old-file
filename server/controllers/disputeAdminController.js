const { DISPUTE_VIEW_FROM, disputeViewSelect, partyPredicate } = require('../utils/disputeView');
const db                    = require('../db');
const { sendNotification }  = require('../services/notificationService');
const { notifyDisputeParties } = require('../services/disputeNotifications');
const { logAdminAction }    = require('../services/auditService');
const logger                = require('../utils/logger');
const { withTransaction }   = require('../utils/transaction');
const { mapResolutionToEscrowStatus } = require('../utils/disputeResolution');
const stripe = process.env.STRIPE_SECRET_KEY ? require('stripe')(process.env.STRIPE_SECRET_KEY) : null;
const { processPaymentRefund } = require('../services/paymentRefundService');
const { sendMoneyMovementGateResult } = require('../utils/dualApprovalHttp');

const DISPUTE_RESOLUTIONS = Object.freeze({
  REFUND_CUSTOMER: 'refund_customer',
  CUSTOMER_WINS: 'customer_wins',
  SPLIT_RESOLUTION: 'split_resolution',
  HELPER_WINS: 'helper_wins',
  DISMISSED: 'dismissed',
});

// P3-815: the admin UI historically posted a different vocabulary. Accept
// those aliases so no submitted resolution is silently rejected.
const RESOLUTION_ALIASES = Object.freeze({
  full_refund: 'refund_customer',
  partial_refund: 'split_resolution',
  release_to_helper: 'helper_wins',
  dismiss: 'dismissed',
});

function normalizeResolution(value) {
  const v = String(value || '').trim();
  return RESOLUTION_ALIASES[v] || v;
}

const DISPUTE_STATUSES = Object.freeze({
  OPEN: 'open',
  UNDER_REVIEW: 'under_review',
  RESOLVED: 'resolved',
  CLOSED: 'closed',
});
const DISPUTE_STATUS_VALUES = Object.freeze(Object.values(DISPUTE_STATUSES));

// ─── LIST ALL DISPUTES (Admin) ────────────────────────────────
exports.getAllDisputes = async (req, res) => {
  try {
    const { status = 'open', page = 1, limit = 20, user_id } = req.query;
    const parsedPage = Math.max(1, Number.parseInt(page, 10) || 1);
    const parsedLimit = Math.min(100, Math.max(1, Number.parseInt(limit, 10) || 20));
    const offset = (parsedPage - 1) * parsedLimit;
    const requestedStatuses = String(status || 'open')
      .split(',')
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean);
    const statuses = requestedStatuses.includes('all') ? DISPUTE_STATUS_VALUES : requestedStatuses;
    if (!statuses.length || statuses.some((value) => !DISPUTE_STATUS_VALUES.includes(value))) {
      return res.status(400).json({ error: `Unsupported dispute status. Use: ${DISPUTE_STATUS_VALUES.join(', ')}, or all.` });
    }

    // P3-820: return the fields the admin list renders (job, parties,
    // amount, evidence deadline, evidence/message counts).
    // ADM-110: the 360-degree views pass ?user_id= so disputes are filtered
    // server-side (opener, accused, or job party) instead of fetching the
    // global list and filtering in the browser.
    const partyParams = user_id ? [user_id] : [];
    const { rows } = await db.query(
      `SELECT ${disputeViewSelect()} ${DISPUTE_VIEW_FROM}
        WHERE d.status = ANY($1::text[])
        ${user_id ? `AND (${partyPredicate('$4')})` : ''}
        ORDER BY d.created_at DESC
        LIMIT $2 OFFSET $3`,
      [statuses, parsedLimit, offset, ...partyParams]
    );

    const countResult = await db.query(
      `SELECT COUNT(*) ${DISPUTE_VIEW_FROM}
        WHERE d.status = ANY($1::text[])
        ${user_id ? `AND (${partyPredicate('$2')})` : ''}`,
      [statuses, ...partyParams]
    );

    res.json({
      disputes: rows,
      total: parseInt(countResult.rows[0].count),
      page: parsedPage,
      totalPages: Math.ceil(countResult.rows[0].count / parsedLimit)
    });
  } catch (err) {
    logger.error('Get all disputes error', { err });
    res.status(500).json({ error: 'Failed to fetch disputes' });
  }
};

// ─── GET SINGLE DISPUTE DETAIL ────────────────────────────────
exports.getDisputeDetail = async (req, res) => {
  try {
    const { disputeId } = req.params;

    const { rows } = await db.query(
      `SELECT ${disputeViewSelect()} ${DISPUTE_VIEW_FROM} WHERE d.id = $1`,
      [disputeId]
    );

    if (!rows.length) {
      return res.status(404).json({ error: 'Dispute not found' });
    }

    res.json({ dispute: rows[0] });
  } catch (err) {
    logger.error('Get dispute detail error', { err });
    res.status(500).json({ error: 'Failed to fetch dispute detail' });
  }
};

// ─── EXECUTE DISPUTE RESOLUTION ─────────────────────────────────────
// Shared by the resolveDispute controller and the dual-approval executor
// (ADM-016). Locks the dispute row FIRST (ADM-078), fires the Stripe refund
// inside the same transaction, then finalizes the dispute and releases
// escrow. When the refund is queued for dual approval (or accepted for
// provider reconciliation), the dispute is left unresolved and the outcome
// carries the pending state for the caller to map to HTTP.
async function executeDisputeResolution({ disputeId, resolution, refundCents, notes, adminId, paymentId, dualApproval, skipDualApproval, req = null }) {
  const refundResolution = [DISPUTE_RESOLUTIONS.REFUND_CUSTOMER, DISPUTE_RESOLUTIONS.CUSTOMER_WINS,
    DISPUTE_RESOLUTIONS.SPLIT_RESOLUTION].includes(resolution);

  // ADM-078: lock the dispute row FIRST, then fire the Stripe refund inside
  // the same transaction. Previously the refund fired before the lock, so
  // two admins resolving concurrently with different split amounts both
  // moved money at Stripe before the loser hit the 409. Holding the lock
  // across the provider call serializes resolvers; the loser now blocks on
  // the lock and gets a clean 409 without moving money.
  const outcome = await withTransaction(db, async (client) => {
    // Lock dispute row to prevent concurrent resolution
    const { rows: disputeRows } = await client.query(
      'SELECT * FROM disputes WHERE id = $1 FOR UPDATE',
      [disputeId]
    );

    if (!disputeRows.length) {
      const err = new Error('Dispute not found');
      err.status = 404;
      throw err;
    }

    const dispute = disputeRows[0];

    // Verify not already resolved (after lock)
    if (dispute.status === DISPUTE_STATUSES.RESOLVED) {
      const err = new Error('Dispute has already been resolved.');
      err.status = 409;
      throw err;
    }

    // Fire the provider refund while holding the dispute lock. Do not mark
    // a dispute refunded until the processor accepts the refund; the
    // idempotency key makes retries safe if the DB transaction later fails.
    let processorRefundId = null;
    let processorRefundAmount = null;
    if (refundResolution) {
      let refundResult;
      try {
        refundResult = await processPaymentRefund({
          paymentId,
          requestedAmountCents: refundCents,
          reason: `Dispute ${disputeId} resolution: ${resolution}`,
          actorUserId: adminId,
          requestId: `dispute-refund-${disputeId}-${refundCents}`,
          allowOpenDisputeId: disputeId,
          req,
          // ADM-016: above-threshold refunds queue for a second admin
          // instead of firing here. skipDualApproval is set on the
          // executor's re-run.
          dualApproval,
          skipDualApproval,
        });
      } catch (refundError) {
        logger.error('Dispute refund failed at payment processor', { disputeId, error: refundError.message });
        const err = new Error(refundError.message || 'Refund failed with payment processor. The dispute was not resolved.');
        err.status = refundError.status || 502;
        throw err;
      }
      if (refundResult.dualApproval) {
        // Queued for dual approval: nothing written yet, commit the no-op.
        // The executor re-runs this whole function after approval.
        return { dualApproval: refundResult.dualApproval };
      }
      if (refundResult.attempt.status !== 'succeeded') {
        // Nothing has been written in this transaction; commit the no-op
        // and report 202 with the dispute still unresolved, as before.
        return { reconciliationPending: true, refundResult };
      }
      processorRefundId = refundResult.attempt.stripe_refund_id;
      processorRefundAmount = refundCents / 100;
    }

    // Update dispute status
    const { rows: updateRows } = await client.query(`
      UPDATE disputes
      SET status = $1,
          resolution = $2,
          admin_notes = $3,
          resolved_by = $4,
          resolution_type = $2,
          refund_amount = COALESCE($6, refund_amount),
          resolved_at = NOW()
      WHERE id = $5 AND status != $1
      RETURNING *
    `, [DISPUTE_STATUSES.RESOLVED, resolution, notes, adminId, disputeId, processorRefundAmount]);

    if (!updateRows.length) {
      throw new Error('Dispute state changed during resolution');
    }

    const resolvedDispute = updateRows[0];

    // P3-2-F16: lock the evidentiary record at resolution too, covering
    // anything submitted while the dispute was under review.
    await client.query(
      `UPDATE dispute_evidence SET is_final = TRUE
        WHERE dispute_id = $1 AND COALESCE(is_final, FALSE) = FALSE`,
      [disputeId]
    );

    // RELEASE ESCROW HOLD (atomic within transaction with lock)
    const { rows: paymentRows } = await client.query(`
      SELECT id, escrow_status FROM payments
      WHERE job_id = $1 AND escrow_status = 'disputed'
      FOR UPDATE
      LIMIT 1
    `, [dispute.job_id]);

    if (paymentRows.length > 0) {
      const payment = paymentRows[0];

      // Map dispute resolution to escrow action
      const newEscrowStatus = mapResolutionToEscrowStatus(resolution);

      // Update escrow with safeguard
      const { rows: escrowUpdateRows } = await client.query(
        `UPDATE payments
         SET escrow_status = $1,
             status = CASE WHEN $3 IN ('refund_customer', 'customer_wins') AND $5::text IS NOT NULL THEN 'refunded' ELSE status END,
             refunded_at = CASE WHEN $3 IN ('refund_customer', 'customer_wins') AND $5::text IS NOT NULL THEN NOW() ELSE refunded_at END,
             refund_amount = COALESCE($4, refund_amount),
             stripe_refund_id = COALESCE($5, stripe_refund_id),
             updated_at = NOW()
         WHERE id = $2 AND escrow_status = 'disputed' RETURNING id`,
        [newEscrowStatus, payment.id, resolution, processorRefundAmount, processorRefundId]
      );

      if (escrowUpdateRows.length > 0) {
        // Log to audit trail
        await client.query(`
          INSERT INTO platform_ledger (user_id, type, amount_cents, description, metadata)
          VALUES (NULL, 'dispute_escrow_release', 0, $1, $2)
        `, [
          `Dispute #${dispute.id} resolved - escrow released as ${newEscrowStatus}`,
          JSON.stringify({ dispute_id: dispute.id, payment_id: payment.id, resolution, job_id: dispute.job_id,
            stripe_refund_id: processorRefundId, refund_amount: processorRefundAmount })
        ]).catch(err => logger.error('Failed to log escrow release', { err }));

        // P3-2-F12: a split resolution refunds part to the customer while
        // the remainder (already captured) stays with the helper. Record
        // the reconciliation explicitly so the helper's remainder is not
        // unreconciled bookkeeping.
        if (resolution === DISPUTE_RESOLUTIONS.SPLIT_RESOLUTION && processorRefundAmount != null) {
          await client.query(`
            INSERT INTO platform_ledger (user_id, type, amount_cents, description, metadata, idempotency_key)
            VALUES (NULL, 'dispute_split_reconciled', 0, $1, $2, $3)
          `, [
            `Dispute #${dispute.id} split: customer refunded ${processorRefundAmount}, remainder released to helper`,
            JSON.stringify({
              dispute_id: dispute.id,
              payment_id: payment.id,
              job_id: dispute.job_id,
              resolution,
              refund_amount: processorRefundAmount,
              stripe_refund_id: processorRefundId,
              helper_remainder_released: true,
            }),
            `dispute-split:${dispute.id}`,
          ]).catch(err => logger.error('Failed to log split reconciliation', { err }));
        }
      }
    }

    return { resolvedDispute, processorRefundId, processorRefundAmount };
  }, 'resolve_dispute');

  if (outcome.reconciliationPending || outcome.dualApproval) return outcome;
  const dispute = outcome.resolvedDispute;

  // Log and notify AFTER transaction commits
  try {
    await logAdminAction({
      adminId,
      action: 'resolve_dispute',
      targetType: 'dispute',
      targetId: disputeId,
      details: { resolution, admin_notes: notes }
    });
  } catch (logErr) {
    logger.error('Failed to log admin action', { err: logErr });
  }

  // P3-817: both parties hear the outcome.
  await notifyDisputeParties(disputeId, 'dispute_resolved', { resolution });

  return outcome;
}

// ─── RESOLVE DISPUTE ──────────────────────────────────────────
exports.resolveDispute = async (req, res) => {
  try {
    const { disputeId } = req.params;
    const { admin_notes, resolution_notes } = req.body;
    const resolution = normalizeResolution(req.body.resolution);
    const requestedRefundAmount = req.body.refund_amount ?? req.body.refundAmount;
    const notes = admin_notes || resolution_notes || null; // accept both field names
    const adminId = req.user.id;

    if (!resolution) {
      return res.status(400).json({ error: 'Resolution is required.' });
    }
    if (!Object.values(DISPUTE_RESOLUTIONS).includes(resolution)) {
      return res.status(400).json({ error: 'Unsupported dispute resolution.' });
    }

    const refundResolution = [DISPUTE_RESOLUTIONS.REFUND_CUSTOMER, DISPUTE_RESOLUTIONS.CUSTOMER_WINS,
      DISPUTE_RESOLUTIONS.SPLIT_RESOLUTION].includes(resolution);

    // Pre-validate the payment side without locking (early 400/409s). The
    // dispute row lock below re-verifies the dispute state, and
    // processPaymentRefund re-validates the payment under its own locks, so
    // this read-only check cannot authorize a stale refund.
    let disputePaymentId = null;
    let disputeRefundCents = null;
    if (refundResolution) {
      if (!stripe) return res.status(503).json({ error: 'Refund processing is not configured.' });

      const { rows: paymentRows } = await db.query(`
        SELECT d.status, p.id AS payment_id, p.amount, p.status AS payment_status,
               p.stripe_payment_intent_id, p.stripe_account_id
        FROM disputes d
        LEFT JOIN payments p ON p.id = COALESCE(
          d.payment_id,
          (SELECT id FROM payments WHERE job_id = d.job_id AND escrow_status = 'disputed'
           ORDER BY id DESC LIMIT 1)
        )
        WHERE d.id = $1
      `, [disputeId]);
      const payment = paymentRows[0];
      if (!payment) return res.status(409).json({ error: 'No disputed payment is attached to this dispute.' });
      if (payment.status === DISPUTE_STATUSES.RESOLVED) return res.status(409).json({ error: 'Dispute has already been resolved.' });
      const fullRefund = resolution !== DISPUTE_RESOLUTIONS.SPLIT_RESOLUTION;
      // Authorized (uncaptured) escrow is released in full by voiding the
      // intent; a partial outcome needs a captured payment.
      if (!['captured', 'authorized'].includes(payment.payment_status)
        || (payment.payment_status === 'authorized' && !fullRefund)) {
        return res.status(409).json({
          error: payment.payment_status === 'authorized'
            ? 'A partial refund needs a captured payment. Capture the job payment first or refund in full.'
            : 'Only captured or authorized payments can be refunded through dispute resolution.',
          code: 'dispute_refund_payment_state',
        });
      }
      if (!payment.stripe_payment_intent_id) return res.status(409).json({ error: 'Disputed payment has no payment-processor reference.' });

      const originalCents = Math.round(Number(payment.amount) * 100);
      const refundCents = fullRefund ? originalCents : Math.round(Number(requestedRefundAmount) * 100);
      if (!Number.isInteger(originalCents) || originalCents <= 0 || !Number.isInteger(refundCents)
        || refundCents <= 0 || refundCents > originalCents) {
        return res.status(400).json({ error: 'Refund amount must be positive and no greater than the payment.' });
      }
      disputePaymentId = payment.payment_id;
      disputeRefundCents = refundCents;
    }


    // ADM-078: the dispute row is locked FIRST inside
    // executeDisputeResolution; the Stripe refund fires within the same
    // transaction. ADM-016: above-threshold refunds queue for a second
    // admin; the executor re-runs executeDisputeResolution on approval.
    const outcome = await executeDisputeResolution({
      disputeId,
      resolution,
      refundCents: disputeRefundCents,
      notes,
      adminId,
      paymentId: disputePaymentId,
      req,
      dualApproval: refundResolution ? {
        movementType: 'dispute_refund',
        referenceKey: `dispute:${disputeId}`,
        requestedBy: adminId,
        idempotencyKey: `dispute-refund-${disputeId}-${disputeRefundCents}`,
        payload: {
          disputeId,
          resolution,
          refundCents: disputeRefundCents,
          notes,
          makerAdminId: adminId,
          paymentId: disputePaymentId,
        },
      } : null,
    });

    if (outcome.dualApproval) {
      return sendMoneyMovementGateResult(res, outcome.dualApproval);
    }

    // Refund accepted for provider reconciliation but not yet settled: the
    // dispute stays unresolved until settlement is confirmed (same 202
    // contract as before the ADM-078 reorder).
    if (outcome.reconciliationPending) {
      return res.status(202).json({
        message: 'Refund accepted for provider reconciliation. The dispute remains unresolved until payment settlement is confirmed.',
        refundStatus: outcome.refundResult.attempt.status,
        refundAttemptId: outcome.refundResult.attempt.id,
      });
    }
    const dispute = outcome.resolvedDispute;

    res.json({
      message: 'Dispute resolved successfully.',
      dispute: { id: disputeId, status: 'resolved', resolution, resolved_at: dispute.resolved_at }
    });
  } catch (err) {
    if (err.status === 404) {
      return res.status(404).json({ error: err.message });
    }
    if (err.status === 409) {
      return res.status(409).json({ error: err.message });
    }
    logger.error('Resolve dispute error', { err });
    res.status(500).json({ error: 'Failed to resolve dispute' });
  }
};

// ─── UPDATE ADMIN NOTES ───────────────────────────────────────
exports.updateAdminNotes = async (req, res) => {
  try {
    const { disputeId } = req.params;
    const { admin_notes } = req.body;

    const { rowCount } = await db.query(
      'UPDATE disputes SET admin_notes = $1 WHERE id = $2',
      [admin_notes, disputeId]
    );

    if (!rowCount) {
      return res.status(404).json({ error: 'Dispute not found' });
    }

    res.json({ message: 'Admin notes updated.' });
  } catch (err) {
    logger.error('Update admin notes error', { err });
    res.status(500).json({ error: 'Failed to update admin notes' });
  }
};

// ─── GET DISPUTE STATS ────────────────────────────────────────
exports.getDisputeStats = async (req, res) => {
  try {
    const result = await db.query(`
      SELECT
        COUNT(*) FILTER (WHERE status = 'open') AS open_count,
        COUNT(*) FILTER (WHERE status = 'under_review') AS under_review_count,
        COUNT(*) FILTER (WHERE status = 'resolved') AS resolved_count,
        COUNT(*) AS total_count
      FROM disputes
    `);

    res.json(result.rows[0]);
  } catch (err) {
    logger.error('Get dispute stats error', { err });
    res.status(500).json({ error: 'Failed to fetch dispute stats' });
  }
};


// ─── START REVIEW (Admin) ───────────────────────────────────
exports.startReview = async (req, res) => {
  try {
    const { disputeId } = req.params;
    const adminId = req.user.id;

    // Perform status transition atomically with race condition prevention
    const dispute = await withTransaction(db, async (client) => {
      // Lock and fetch dispute in 'open' status
      const { rows: disputeRows } = await client.query(
        'SELECT * FROM disputes WHERE id = $1 FOR UPDATE',
        [disputeId]
      );

      if (!disputeRows.length) {
        const err = new Error('Dispute not found');
        err.status = 404;
        throw err;
      }

      const dispute = disputeRows[0];

      // Verify status is 'open' (atomic check after lock)
      if (dispute.status !== DISPUTE_STATUSES.OPEN) {
        const err = new Error(`Dispute is in '${dispute.status}' status and cannot be moved to review.`);
        err.status = 409;
        throw err;
      }

      // Update status to under_review (atomic within transaction). The guard
      // re-checks 'open': the earlier read locked the row, so a zero-row
      // update means a concurrent transition won.
      const { rows: updateRows } = await client.query(
        `UPDATE disputes SET status = $1, reviewed_at = NOW() WHERE id = $2 AND status = 'open' RETURNING *`,
        [DISPUTE_STATUSES.UNDER_REVIEW, disputeId]
      );

      if (!updateRows.length) {
        throw new Error('Dispute state changed during update');
      }

      // P3-2-F16: entering review finalizes the evidence. The trigger hashes
      // each row and blocks later edits, so neither party can alter what the
      // admin is about to read.
      await client.query(
        `UPDATE dispute_evidence SET is_final = TRUE
          WHERE dispute_id = $1 AND COALESCE(is_final, FALSE) = FALSE`,
        [disputeId]
      );

      return updateRows[0];
    }, 'start_dispute_review');

    // Log and notify AFTER transaction commits
    try {
      await logAdminAction({
        adminId,
        action: 'start_dispute_review',
        targetType: 'dispute',
        targetId: disputeId,
        details: {},
        // Audit fix, finding 35: stamp impersonated_by (NULL direct).
        req,
      });
    } catch (logErr) {
      logger.error('Failed to log admin action', { err: logErr });
    }

    await notifyDisputeParties(disputeId, 'dispute_under_review');

    res.json({
      message: 'Dispute is now under review.',
      dispute: { id: disputeId, status: 'under_review' }
    });
  } catch (err) {
    if (err.status === 404) {
      return res.status(404).json({ error: err.message });
    }
    if (err.status === 409) {
      return res.status(409).json({ error: err.message });
    }
    logger.error('Start review error', { err });
    res.status(500).json({ error: 'Failed to start dispute review.' });
  }
};

// P3-2-F20: startReview was one-way; a dispute sent to review by mistake had
// no path back. Reopen moves under_review -> open (guarded, audited). Evidence
// finalized on review entry stays finalized: the record is append-only.
exports.reopenDispute = async (req, res) => {
  try {
    const { disputeId } = req.params;
    const adminId = req.user.id;

    const dispute = await withTransaction(db, async (client) => {
      const { rows: disputeRows } = await client.query(
        'SELECT * FROM disputes WHERE id = $1 FOR UPDATE',
        [disputeId]
      );
      if (!disputeRows.length) {
        const err = new Error('Dispute not found');
        err.status = 404;
        throw err;
      }
      if (disputeRows[0].status !== DISPUTE_STATUSES.UNDER_REVIEW) {
        const err = new Error(`Only disputes under review can be reopened (current: '${disputeRows[0].status}').`);
        err.status = 409;
        throw err;
      }
      const { rows: updateRows } = await client.query(
        `UPDATE disputes SET status = $1, reviewed_at = NULL, updated_at = NOW()
          WHERE id = $2 AND status = $3 RETURNING *`,
        [DISPUTE_STATUSES.OPEN, disputeId, DISPUTE_STATUSES.UNDER_REVIEW]
      );
      if (!updateRows.length) {
        throw new Error('Dispute state changed during update');
      }
      return updateRows[0];
    }, 'reopen_dispute');

    try {
      await logAdminAction({
        adminId,
        action: 'reopen_dispute',
        targetType: 'dispute',
        targetId: disputeId,
        details: {},
        // Audit fix, finding 35: stamp impersonated_by (NULL direct).
        req,
      });
    } catch (logErr) {
      logger.error('Failed to log admin action', { err: logErr });
    }

    await notifyDisputeParties(disputeId, 'dispute_reopened');

    res.json({
      message: 'Dispute reopened.',
      dispute: { id: disputeId, status: 'open' }
    });
  } catch (err) {
    if (err.status === 404) {
      return res.status(404).json({ error: err.message });
    }
    if (err.status === 409) {
      return res.status(409).json({ error: err.message });
    }
    logger.error('Reopen dispute error', { err });
    res.status(500).json({ error: 'Failed to reopen dispute.' });
  }
};

exports.normalizeResolution = normalizeResolution;
exports.DISPUTE_RESOLUTIONS = DISPUTE_RESOLUTIONS;
// ADM-016: the dual-approval executor re-runs the locked resolution.
exports.executeDisputeResolution = executeDisputeResolution;
