const db                    = require('../db');
const { sendNotification }  = require('../services/notificationService');
const { logAdminAction }    = require('../services/auditService');
const logger                = require('../utils/logger');
const { withTransaction }   = require('../utils/transaction');
const { mapResolutionToEscrowStatus } = require('../utils/disputeResolution');
const stripe = process.env.STRIPE_SECRET_KEY ? require('stripe')(process.env.STRIPE_SECRET_KEY) : null;

const DISPUTE_RESOLUTIONS = Object.freeze({
  REFUND_CUSTOMER: 'refund_customer',
  CUSTOMER_WINS: 'customer_wins',
  SPLIT_RESOLUTION: 'split_resolution',
  HELPER_WINS: 'helper_wins',
});

const DISPUTE_STATUSES = Object.freeze({
  OPEN: 'open',
  UNDER_REVIEW: 'under_review',
  RESOLVED: 'resolved',
  CLOSED: 'closed',
});

// ─── LIST ALL DISPUTES (Admin) ────────────────────────────────
exports.getAllDisputes = async (req, res) => {
  try {
    const { status = 'open', page = 1, limit = 20 } = req.query;
    const offset = (page - 1) * limit;

    const { rows } = await db.query(`
      SELECT
        d.id, d.status, d.reason, d.resolution,
        d.created_at, d.resolved_at,
        d.opened_by_role, d.opened_by_name,
        d.job_id, d.job_type,
        d.description, d.admin_notes,
        d.evidence_poster, d.evidence_helper,
        u_op.first_name || ' ' || u_op.last_name AS opener_full_name,
        u_op.email AS opened_by_email
      FROM disputes d
      LEFT JOIN users u_op ON d.opened_by = u_op.id
      WHERE d.status = $1
      ORDER BY d.created_at DESC
      LIMIT $2 OFFSET $3
    `, [status, limit, offset]);

    const countResult = await db.query(
      'SELECT COUNT(*) FROM disputes WHERE status = $1',
      [status]
    );

    res.json({
      disputes: rows,
      total: parseInt(countResult.rows[0].count),
      page: parseInt(page),
      totalPages: Math.ceil(countResult.rows[0].count / limit)
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

    const { rows } = await db.query(`
      SELECT
        d.*,
        u_op.first_name || ' ' || u_op.last_name AS opener_full_name,
        u_op.email AS opened_by_email
      FROM disputes d
      LEFT JOIN users u_op ON d.opened_by = u_op.id
      WHERE d.id = $1
    `, [disputeId]);

    if (!rows.length) {
      return res.status(404).json({ error: 'Dispute not found' });
    }

    res.json({ dispute: rows[0] });
  } catch (err) {
    logger.error('Get dispute detail error', { err });
    res.status(500).json({ error: 'Failed to fetch dispute detail' });
  }
};

// ─── RESOLVE DISPUTE ──────────────────────────────────────────
exports.resolveDispute = async (req, res) => {
  try {
    const { disputeId } = req.params;
    const { resolution, admin_notes, resolution_notes } = req.body;
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
    let processorRefundId = null;
    let processorRefundAmount = null;

    // Do not mark a dispute refunded until the processor accepts the refund.
    // The idempotency key makes retries safe if the DB transaction later fails.
    if (refundResolution) {
      if (!stripe) return res.status(503).json({ error: 'Refund processing is not configured.' });

      const { rows: paymentRows } = await db.query(`
        SELECT d.status, p.amount, p.status AS payment_status,
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
      if (payment.payment_status !== 'captured') return res.status(409).json({ error: 'Only captured payments can be refunded through dispute resolution.' });
      if (!payment.stripe_payment_intent_id) return res.status(409).json({ error: 'Disputed payment has no payment-processor reference.' });

      const originalCents = Math.round(Number(payment.amount) * 100);
      const fullRefund = resolution !== DISPUTE_RESOLUTIONS.SPLIT_RESOLUTION;
      const refundCents = fullRefund ? originalCents : Math.round(Number(requestedRefundAmount) * 100);
      if (!Number.isInteger(originalCents) || originalCents <= 0 || !Number.isInteger(refundCents)
        || refundCents <= 0 || refundCents > originalCents) {
        return res.status(400).json({ error: 'Refund amount must be positive and no greater than the payment.' });
      }

      try {
        const refund = await stripe.refunds.create({
          payment_intent: payment.stripe_payment_intent_id,
          ...(fullRefund ? {} : { amount: refundCents }),
        }, {
          idempotencyKey: `dispute-refund-${disputeId}-${refundCents}`,
          ...(payment.stripe_account_id ? { stripeAccount: payment.stripe_account_id } : {}),
        });
        processorRefundId = refund.id;
        processorRefundAmount = refundCents / 100;
      } catch (stripeError) {
        logger.error('Dispute refund failed at payment processor', { disputeId, error: stripeError.message });
        return res.status(502).json({ error: 'Refund failed with payment processor. The dispute was not resolved.' });
      }
    }

    // Resolve dispute atomically with escrow updates
    const dispute = await withTransaction(db, async (client) => {
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
               status = CASE WHEN $3 IN ('refund_customer', 'customer_wins') THEN 'refunded' ELSE status END,
               refunded_at = CASE WHEN $3 IN ('refund_customer', 'customer_wins') THEN NOW() ELSE refunded_at END,
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
        }
      }

      return resolvedDispute;
    }, 'resolve_dispute');

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

    try {
      if (dispute.opened_by) {
        await sendNotification({
          userId: dispute.opened_by,
          type: 'dispute_resolved',
          title: 'Dispute Resolved',
          message: `Your dispute has been resolved. Resolution: ${resolution}`,
          metadata: { disputeId, resolution }
        });
      }
    } catch (notifErr) {
      logger.error('Failed to send dispute notification', { err: notifErr });
    }

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

      // Update status to under_review (atomic within transaction)
      const { rows: updateRows } = await client.query(
        `UPDATE disputes SET status = $1, reviewed_at = NOW() WHERE id = $2 AND status = $1 RETURNING *`,
        [DISPUTE_STATUSES.UNDER_REVIEW, disputeId]
      );

      if (!updateRows.length) {
        throw new Error('Dispute state changed during update');
      }

      return updateRows[0];
    }, 'start_dispute_review');

    // Log and notify AFTER transaction commits
    try {
      await logAdminAction({
        adminId,
        action: 'start_dispute_review',
        targetType: 'dispute',
        targetId: disputeId,
        details: {}
      });
    } catch (logErr) {
      logger.error('Failed to log admin action', { err: logErr });
    }

    try {
      if (dispute.opened_by) {
        await sendNotification({
          userId: dispute.opened_by,
          type: 'dispute_under_review',
          title: 'Dispute Under Review',
          message: 'Your dispute is now being reviewed by an admin.',
          metadata: { disputeId }
        });
      }
    } catch (notifErr) {
      logger.error('Failed to send review notification', { err: notifErr });
    }

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
