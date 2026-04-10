const db                    = require('../db');
const logger = require('../utils/logger');
const { sendNotification }  = require('../services/notificationService');
const { logAdminAction }    = require('../services/auditService');

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
    logger.error('Get all disputes error:', err);
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
    logger.error('Get dispute detail error:', err);
    res.status(500).json({ error: 'Failed to fetch dispute detail' });
  }
};

// ─── RESOLVE DISPUTE ──────────────────────────────────────────
exports.resolveDispute = async (req, res) => {
  try {
    const { disputeId } = req.params;
    const { resolution, admin_notes, resolution_notes } = req.body;
    const notes = admin_notes || resolution_notes || null; // accept both field names
    const adminId = req.user.id;

    if (!resolution) {
      return res.status(400).json({ error: 'Resolution is required.' });
    }

    // Verify dispute exists and is not already resolved
    const { rows: disputeRows } = await db.query(
      'SELECT * FROM disputes WHERE id = $1 AND status != $2',
      [disputeId, 'resolved']
    );

    if (!disputeRows.length) {
      return res.status(404).json({
        error: 'Dispute not found or already resolved.'
      });
    }

    const dispute = disputeRows[0];

    // Update dispute
    await db.query(`
      UPDATE disputes
      SET status = 'resolved',
          resolution = $1,
          admin_notes = $2,
          resolved_by = $3,
          resolved_at = NOW()
      WHERE id = $4
    `, [resolution, notes, adminId, disputeId]);

    // Log admin action
    try {
      await logAdminAction({
        adminId,
        action: 'resolve_dispute',
        targetType: 'dispute',
        targetId: disputeId,
        details: { resolution, admin_notes: notes }
      });
    } catch (logErr) {
      logger.error('Failed to log admin action:', logErr);
    }

    // Notify the dispute opener
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
      logger.error('Failed to send dispute notification:', notifErr);
    }

    res.json({
      message: 'Dispute resolved successfully.',
      dispute: { id: disputeId, status: 'resolved', resolution }
    });
  } catch (err) {
    logger.error('Resolve dispute error:', err);
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
    logger.error('Update admin notes error:', err);
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
    logger.error('Get dispute stats error:', err);
    res.status(500).json({ error: 'Failed to fetch dispute stats' });
  }
};


// ─── START REVIEW (Admin) ───────────────────────────────────
exports.startReview = async (req, res) => {
  try {
    const { disputeId } = req.params;
    const adminId = req.user.id;

    // Verify dispute exists and is in 'open' status
    const { rows: disputeRows } = await db.query(
      'SELECT * FROM disputes WHERE id = $1 AND status = $2',
      [disputeId, 'open']
    );

    if (!disputeRows.length) {
      return res.status(404).json({
        error: 'Dispute not found or not in open status.'
      });
    }

    // Update status to under_review
    await db.query(
      `UPDATE disputes SET status = 'under_review', reviewed_at = NOW() WHERE id = $1`,
      [disputeId]
    );

    // Log admin action
    try {
      await logAdminAction({
        adminId,
        action: 'start_dispute_review',
        targetType: 'dispute',
        targetId: disputeId,
        details: {}
      });
    } catch (logErr) {
      logger.error('Failed to log admin action:', logErr);
    }

    // Notify the dispute opener
    try {
      const dispute = disputeRows[0];
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
      logger.error('Failed to send review notification:', notifErr);
    }

    res.json({
      message: 'Dispute is now under review.',
      dispute: { id: disputeId, status: 'under_review' }
    });
  } catch (err) {
    logger.error('Start review error:', err);
    res.status(500).json({ error: 'Failed to start dispute review.' });
  }
};
