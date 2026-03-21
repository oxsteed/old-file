const db                   = require('../db');
const { sendNotification } = require('../services/notificationService');
const { logAdminAction }   = require('../services/auditService');
const { issueRefund }      = require('../services/stripeService');
const { releaseEscrow }    = require('../services/stripeService');

// ─── LIST ALL DISPUTES (Admin) ────────────────────────────────
exports.getAllDisputes = async (req, res) => {
  try {
    const { status = 'open', page = 1, limit = 20 } = req.query;
    const offset = (page - 1) * limit;

    const { rows } = await db.query(`
      SELECT
        d.id, d.status, d.reason, d.resolution,
        d.created_at, d.evidence_deadline,
        d.opened_by_role, d.resolved_at,
        j.title         AS job_title,
        j.final_price   AS job_amount,
        j.id            AS job_id,
        u_op.first_name || ' ' || u_op.last_name  AS opened_by_name,
        u_op.email                                  AS opened_by_email,
        u_ag.first_name || ' ' || u_ag.last_name   AS against_user_name,
        u_ag.email                                  AS against_user_email,
        (SELECT COUNT(*) FROM dispute_evidence de
         WHERE de.dispute_id = d.id)                AS evidence_count,
        (SELECT COUNT(*) FROM dispute_messages dm
         WHERE dm.dispute_id = d.id
           AND dm.is_admin_only = false)             AS message_count,
        e.gross_amount  AS escrow_amount,
        e.status        AS escrow_status
      FROM disputes d
      JOIN jobs j           ON d.job_id = j.id
      JOIN users u_op       ON d.opened_by = u_op.id
      JOIN users u_ag       ON d.against_user_id = u_ag.id
      LEFT JOIN escrow_holds e ON e.job_id = j.id
      WHERE d.status = $1
      ORDER BY d.created_at ASC
      LIMIT $2 OFFSET $3
    `, [status, limit, offset]);

    const { rows: countRows } = await db.query(
      `SELECT COUNT(*) FROM disputes WHERE status = $1`, [status]
    );

    res.json({
      disputes: rows,
      total:    parseInt(countRows[0].count),
      page:     parseInt(page),
      limit:    parseInt(limit)
    });
  } catch (err) {
    console.error('getAllDisputes error:', err);
    res.status(500).json({ error: 'Failed to fetch disputes.' });
  }
};

// ─── START REVIEW (move to under_review) ─────────────────────
exports.startReview = async (req, res) => {
  try {
    const adminId     = req.user.id;
    const { disputeId } = req.params;

    const { rows } = await db.query(`
      UPDATE disputes
      SET status = 'under_review', updated_at = now()
      WHERE id = $1 AND status = 'open'
      RETURNING *
    `, [disputeId]);

    if (!rows.length) {
      return res.status(404).json({ error: 'Dispute not found or not open.' });
    }

    const dispute = rows[0];

    // Notify both parties
    for (const uid of [dispute.opened_by, dispute.against_user_id]) {
      await sendNotification({
        userId:     uid,
        type:       'dispute_update',
        title:      'Your dispute is under review',
        body:       'Our team has started reviewing your dispute. We will reach out if we need more information.',
        data:       { disputeId },
        action_url: `/disputes/${disputeId}`
      });
    }

    await logAdminAction({
      adminId,
      action:     'dispute_review_started',
      targetType: 'dispute',
      targetId:   disputeId,
      req
    });

    res.json({ message: 'Dispute moved to under_review.', dispute });
  } catch (err) {
    console.error('startReview error:', err);
    res.status(500).json({ error: 'Failed to start review.' });
  }
};

// ─── RESOLVE DISPUTE ──────────────────────────────────────────
exports.resolveDispute = async (req, res) => {
  const dbClient = await db.connect();
  try {
    await dbClient.query('BEGIN');

    const adminId         = req.user.id;
    const { disputeId }   = req.params;
    const {
      resolution,         // full_refund | partial_refund | release_to_helper | dismissed
      resolution_notes,
      refund_amount       // only for partial_refund (in dollars)
    } = req.body;

    const validResolutions = [
      'full_refund','partial_refund',
      'release_to_helper','dismissed'
    ];

    if (!validResolutions.includes(resolution)) {
      return res.status(400).json({ error: 'Invalid resolution type.' });
    }

    if (!resolution_notes?.trim()) {
      return res.status(400).json({ error: 'Resolution notes required.' });
    }

    if (resolution === 'partial_refund' && !refund_amount) {
      return res.status(400).json({ error: 'Refund amount required for partial refund.' });
    }

    // Get dispute with all related data
    const { rows: disputeRows } = await dbClient.query(`
      SELECT d.*, j.client_id, j.assigned_helper_id,
             j.title AS job_title, j.final_price,
             j.id AS job_id,
             e.gross_amount, e.id AS escrow_id
      FROM disputes d
      JOIN jobs j           ON d.job_id = j.id
      LEFT JOIN escrow_holds e ON e.job_id = j.id
      WHERE d.id = $1
        AND d.status IN ('open','under_review')
    `, [disputeId]);

    if (!disputeRows.length) {
      return res.status(404).json({
        error: 'Dispute not found or already resolved.'
      });
    }

    const dispute = disputeRows[0];

    // ── Execute financial resolution ──────────────────────────

    if (resolution === 'full_refund') {
      // Full refund to client
      await issueRefund(dispute.job_id, resolution_notes);
      await dbClient.query(`
        UPDATE escrow_holds
        SET status = 'refunded', updated_at = now()
        WHERE id = $1
      `, [dispute.escrow_id]);

    } else if (resolution === 'partial_refund') {
      // Partial refund — refund client portion, release rest to helper
      const refundCents = Math.round(parseFloat(refund_amount) * 100);
      await issueRefund(dispute.job_id, resolution_notes, refundCents);

      // Release remainder to helper
      const { releaseEscrow } = require('../services/stripeService');
            await releaseEscrow(dispute.job_id);

      await dbClient.query(`
        UPDATE escrow_holds
        SET status = 'partial_refund', updated_at = now()
        WHERE id = $1
      `, [dispute.escrow_id]);

    } else if (resolution === 'release_to_helper') {
      // Release full escrow to helper — client loses dispute
      await releaseEscrow(dispute.job_id);

      await dbClient.query(`
        UPDATE escrow_holds
        SET status = 'released', updated_at = now()
        WHERE id = $1
      `, [dispute.escrow_id]);

    } else if (resolution === 'dismissed') {
      // No financial action — just close the dispute
      // Escrow remains — admin must manually decide separately
      await dbClient.query(`
        UPDATE escrow_holds
        SET status = 'release_pending', updated_at = now()
        WHERE id = $1
      `, [dispute.escrow_id]);
    }

    // ── Update dispute record ─────────────────────────────────
    await dbClient.query(`
      UPDATE disputes
      SET status           = 'resolved',
          resolution       = $1,
          resolution_notes = $2,
          refund_amount    = $3,
          resolved_by      = $4,
          resolved_at      = now(),
          updated_at       = now()
      WHERE id = $5
    `, [
      resolution,
      resolution_notes.trim(),
      refund_amount ? parseFloat(refund_amount) : null,
      adminId,
      disputeId
    ]);

    // ── Update job status ─────────────────────────────────────
    const jobFinalStatus = ['full_refund','dismissed'].includes(resolution)
      ? 'cancelled' : 'closed';

    await dbClient.query(`
      UPDATE jobs
      SET status = $1, updated_at = now()
      WHERE id = $2
    `, [jobFinalStatus, dispute.job_id]);

    await dbClient.query('COMMIT');

    // ── Notifications to both parties ─────────────────────────
    const resolutionMessages = {
      full_refund:       'The dispute was resolved in your favor. A full refund has been issued.',
      partial_refund:    `The dispute was partially resolved. A refund of $${refund_amount} has been issued.`,
      release_to_helper: 'The dispute was resolved. Payment has been released to the helper.',
      dismissed:         'The dispute has been dismissed. No financial action was taken.'
    };

    const clientMsg  = resolution === 'full_refund' || resolution === 'partial_refund'
      ? resolutionMessages[resolution]
      : 'The dispute has been resolved. Please check the details.';

    const helperMsg  = resolution === 'release_to_helper'
      ? 'The dispute was resolved in your favor. Payment is on its way.'
      : 'The dispute has been resolved. Please check the details.';

    await sendNotification({
      userId:     dispute.client_id,
      type:       'dispute_update',
      title:      'Dispute resolved',
      body:       clientMsg,
      data:       { disputeId, resolution },
      action_url: `/disputes/${disputeId}`
    });

    await sendNotification({
      userId:     dispute.assigned_helper_id,
      type:       'dispute_update',
      title:      'Dispute resolved',
      body:       helperMsg,
      data:       { disputeId, resolution },
      action_url: `/disputes/${disputeId}`
    });

    await logAdminAction({
      adminId,
      action:     'dispute_resolved',
      targetType: 'dispute',
      targetId:   disputeId,
      description: `Resolution: ${resolution}. Notes: ${resolution_notes}`,
      before:     { status: 'under_review' },
      after:      { status: 'resolved', resolution },
      req
    });

    res.json({
      message:    `Dispute resolved: ${resolution}`,
      resolution,
      disputeId
    });
  } catch (err) {
    await dbClient.query('ROLLBACK');
    console.error('resolveDispute error:', err);
    res.status(500).json({ error: err.message || 'Failed to resolve dispute.' });
  } finally {
    dbClient.release();
  }
};
