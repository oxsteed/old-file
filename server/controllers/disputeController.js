const db                    = require('../db');
const { sendNotification }  = require('../services/notificationService');

const DISPUTE_REASONS = [
  'work_not_completed',
  'poor_quality',
  'no_show',
  'overcharged',
  'property_damage',
  'safety_concern',
  'fraud',
  'other'
];

// ─── OPEN DISPUTE ─────────────────────────────────────────────
exports.openDispute = async (req, res) => {
  try {
    const userId = req.user.id;
    const { jobId } = req.params;
    const { reason, description, job_type } = req.body;

    if (!DISPUTE_REASONS.includes(reason)) {
      return res.status(400).json({
        error: `Invalid reason. Must be one of: ${DISPUTE_REASONS.join(', ')}`
      });
    }

    if (!description || description.trim().length < 20) {
      return res.status(400).json({
        error: 'Please provide at least 20 characters of description.'
      });
    }

    // Check no existing open dispute for this job
    const { rows: existRows } = await db.query(
      `SELECT id FROM disputes WHERE job_id = $1 AND status NOT IN ('resolved','closed')`,
      [jobId]
    );

    if (existRows.length) {
      return res.status(409).json({
        error: 'A dispute is already open for this job.'
      });
    }

    // Get user name for the opened_by_name field
    const { rows: userRows } = await db.query(
      'SELECT first_name, last_name FROM users WHERE id = $1',
      [userId]
    );
    const userName = userRows.length
      ? `${userRows[0].first_name} ${userRows[0].last_name}`
      : 'Unknown';

    // Determine role from user record
    const openedByRole = req.user.role === 'helper' ? 'helper' : 'customer';

    // Create dispute
    const { rows: disputeRows } = await db.query(`
      INSERT INTO disputes (
        job_id, job_type, opened_by, opened_by_name,
        opened_by_role, reason, description, status
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,'open')
      RETURNING *
    `, [
      jobId, job_type || 'standard', userId, userName,
      openedByRole, reason, description.trim()
    ]);

    const dispute = disputeRows[0];

    // Notify admin
    try {
      await sendNotification({
        userId: null,
        type: 'dispute_opened',
        title: 'New Dispute Opened',
        message: `${userName} opened a dispute for job ${jobId}. Reason: ${reason}`,
        metadata: { disputeId: dispute.id, jobId }
      });
    } catch (notifErr) {
      console.error('Failed to send dispute notification:', notifErr);
    }

    res.status(201).json({
      dispute,
      message: 'Dispute opened successfully.'
    });
  } catch (err) {
    console.error('openDispute error:', err);
    res.status(500).json({ error: 'Failed to open dispute.' });
  }
};

// ─── GET DISPUTE DETAIL ───────────────────────────────────────
exports.getDispute = async (req, res) => {
  try {
    const userId = req.user.id;
    const { disputeId } = req.params;
    const isAdmin = ['admin','super_admin'].includes(req.user.role);

    const { rows } = await db.query(`
      SELECT
        d.*,
        u_op.first_name || ' ' || u_op.last_name AS opener_full_name,
        u_op.email AS opened_by_email,
        u_res.first_name || ' ' || u_res.last_name AS resolved_by_name
      FROM disputes d
      LEFT JOIN users u_op ON d.opened_by = u_op.id
      LEFT JOIN users u_res ON d.resolved_by = u_res.id
      WHERE d.id = $1
    `, [disputeId]);

    if (!rows.length) {
      return res.status(404).json({ error: 'Dispute not found.' });
    }

    const dispute = rows[0];

    // Non-admins can only see their own disputes
    if (!isAdmin && dispute.opened_by !== userId) {
      return res.status(403).json({ error: 'Not authorized.' });
    }

    res.json({ dispute });
  } catch (err) {
    console.error('getDispute error:', err);
    res.status(500).json({ error: 'Failed to fetch dispute.' });
  }
};

// ─── GET MY DISPUTES ──────────────────────────────────────────
exports.getMyDisputes = async (req, res) => {
  try {
    const userId = req.user.id;

    const { rows } = await db.query(`
      SELECT
        d.id, d.status, d.reason, d.resolution,
        d.created_at, d.resolved_at,
        d.opened_by_role, d.opened_by_name,
        d.job_id, d.job_type, d.description
      FROM disputes d
      WHERE d.opened_by = $1
      ORDER BY d.created_at DESC
    `, [userId]);

    res.json({ disputes: rows });
  } catch (err) {
    console.error('getMyDisputes error:', err);
    res.status(500).json({ error: 'Failed to fetch disputes.' });
  }
};

// ─── SUBMIT EVIDENCE (text only, stored in disputes table) ─────
exports.submitEvidence = async (req, res) => {
  try {
    const userId = req.user.id;
    const { disputeId } = req.params;
    const { evidence } = req.body;
    const isAdmin = ['admin','super_admin'].includes(req.user.role);

    if (!evidence?.trim()) {
      return res.status(400).json({ error: 'Evidence cannot be empty.' });
    }

    // Verify dispute exists and user has access
    const { rows: disputeRows } = await db.query(
      'SELECT * FROM disputes WHERE id = $1 AND status = $2',
      [disputeId, 'open']
    );

    if (!disputeRows.length) {
      return res.status(404).json({
        error: 'Dispute not found or not accepting evidence.'
      });
    }

    const dispute = disputeRows[0];

    if (!isAdmin && dispute.opened_by !== userId) {
      return res.status(403).json({ error: 'Not authorized.' });
    }

    // Determine which evidence field to update based on role
    const userRole = req.user.role;
    const field = userRole === 'helper' ? 'evidence_helper' : 'evidence_poster';

    await db.query(
      `UPDATE disputes SET ${field} = $1 WHERE id = $2`,
      [evidence.trim(), disputeId]
    );

    res.json({
      message: 'Evidence submitted successfully.',
      field,
      disputeId
    });
  } catch (err) {
    console.error('submitEvidence error:', err);
    res.status(500).json({ error: 'Failed to submit evidence.' });
  }
};


// ─── SEND DISPUTE MESSAGE ─────────────────────────────────────
exports.sendDisputeMessage = async (req, res) => {
  try {
    const userId = req.user.id;
    const { disputeId } = req.params;
    const { message } = req.body;

    if (!message || !message.trim()) {
      return res.status(400).json({ error: 'Message cannot be empty.' });
    }

    // Verify dispute exists and user has access
    const { rows: disputeRows } = await db.query(
      'SELECT * FROM disputes WHERE id = $1',
      [disputeId]
    );

    if (!disputeRows.length) {
      return res.status(404).json({ error: 'Dispute not found.' });
    }

    const dispute = disputeRows[0];
    const isAdmin = ['admin', 'super_admin'].includes(req.user.role);

    if (!isAdmin && dispute.opened_by !== userId) {
      return res.status(403).json({ error: 'Not authorized.' });
    }

    // Insert message into dispute_messages table
    const { rows } = await db.query(
      `INSERT INTO dispute_messages (dispute_id, sender_id, message, is_admin)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [disputeId, userId, message.trim(), isAdmin]
    );

    res.status(201).json({
      message: 'Message sent successfully.',
      disputeMessage: rows[0]
    });
  } catch (err) {
    console.error('sendDisputeMessage error:', err);
    res.status(500).json({ error: 'Failed to send dispute message.' });
  }
};
