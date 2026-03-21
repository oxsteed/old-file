const db                   = require('../db');
const { sendNotification } = require('../services/notificationService');
const { logAdminAction }   = require('../services/auditService');
const { issueRefund }      = require('../services/stripeService');
const upload               = require('../middleware/upload');

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
  const dbClient = await db.connect();
  try {
    await dbClient.query('BEGIN');

    const userId           = req.user.id;
    const { jobId }        = req.params;
    const { reason, description } = req.body;

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

    // Verify user was part of this job and job is completed
    const { rows: jobRows } = await dbClient.query(`
      SELECT j.*,
        u_c.email AS client_email,
        u_h.email AS helper_email,
        u_c.first_name AS client_name,
        u_h.first_name AS helper_name
      FROM jobs j
      JOIN users u_c ON j.client_id = u_c.id
      LEFT JOIN users u_h ON j.assigned_helper_id = u_h.id
      WHERE j.id = $1
        AND (j.client_id = $2 OR j.assigned_helper_id = $2)
        AND j.status IN ('completed','closed')
    `, [jobId, userId]);

    if (!jobRows.length) {
      return res.status(403).json({
        error: 'Can only dispute completed jobs you were part of.'
      });
    }

    const job = jobRows[0];

    // Check no existing open dispute
    const { rows: existRows } = await dbClient.query(`
      SELECT id FROM disputes
      WHERE job_id = $1 AND status NOT IN ('resolved','closed')
    `, [jobId]);

    if (existRows.length) {
      return res.status(409).json({
        error: 'A dispute is already open for this job.'
      });
    }

    // Determine roles
    const isClient      = job.client_id === userId;
    const openedByRole  = isClient ? 'client' : 'helper';
    const againstUserId = isClient ? job.assigned_helper_id : job.client_id;
    const evidenceDeadline = new Date(Date.now() + 72 * 60 * 60 * 1000);

    // Create dispute
    const { rows: disputeRows } = await dbClient.query(`
      INSERT INTO disputes (
        job_id, opened_by, opened_by_role,
        against_user_id, reason, description,
        status, evidence_deadline
      ) VALUES ($1,$2,$3,$4,$5,$6,'open',$7)
      RETURNING *
    `, [
      jobId, userId, openedByRole,
      againstUserId, reason, description.trim(),
      evidenceDeadline
    ]);

    const dispute = disputeRows[0];

    // Freeze escrow
    await dbClient.query(`
      UPDATE escrow_holds
      SET status = 'disputed', updated_at = now()
      WHERE job_id = $1
    `, [jobId]);

    // Set job status to disputed
    await dbClient.query(`
      UPDATE jobs
      SET status = 'disputed', updated_at = now()
      WHERE id = $1
    `, [jobId]);

    await dbClient.query('COMMIT');

    // Notify other party
    const otherName  = isClient ? job.client_name : job.helper_name;
    await sendNotification({
      userId:     againstUserId,
      type:       'dispute_update',
      title:      'A dispute has been opened',
      body:       `A dispute was filed regarding "${job.title}". Please submit your evidence within 72 hours.`,
      data:       { jobId, disputeId: dispute.id },
      action_url: `/disputes/${dispute.id}`
    });

    // Notify opening party
    await sendNotification({
      userId,
      type:       'dispute_update',
      title:      'Dispute opened',
      body:       `Your dispute for "${job.title}" is now under review. Submit evidence within 72 hours.`,
      data:       { jobId, disputeId: dispute.id },
      action_url: `/disputes/${dispute.id}`
    });

    res.status(201).json({
      dispute,
      message: 'Dispute opened. Both parties have 72 hours to submit evidence.'
    });
  } catch (err) {
    await dbClient.query('ROLLBACK');
    console.error('openDispute error:', err);
    res.status(500).json({ error: 'Failed to open dispute.' });
  } finally {
    dbClient.release();
  }
};

// ─── SUBMIT EVIDENCE ──────────────────────────────────────────
exports.submitEvidence = async (req, res) => {
  try {
    const userId      = req.user.id;
    const { disputeId } = req.params;
    const { content } = req.body;
    const files       = req.files || [];

    // Verify user is party to this dispute
    const { rows: disputeRows } = await db.query(`
      SELECT d.*, j.client_id, j.assigned_helper_id
      FROM disputes d
      JOIN jobs j ON d.job_id = j.id
      WHERE d.id = $1
        AND (j.client_id = $2 OR j.assigned_helper_id = $2)
        AND d.status = 'open'
        AND d.evidence_deadline > now()
    `, [disputeId, userId]);

    if (!disputeRows.length) {
      return res.status(403).json({
        error: 'Dispute not found, not authorized, or evidence window closed.'
      });
    }

    const dispute    = disputeRows[0];
    const isClient   = dispute.client_id === userId;
    const submitterRole = isClient ? 'client' : 'helper';

    const evidenceRecords = [];

    // Text evidence
    if (content?.trim()) {
      const { rows } = await db.query(`
        INSERT INTO dispute_evidence
          (dispute_id, submitted_by, submitter_role, type, content)
        VALUES ($1,$2,$3,'text',$4)
        RETURNING *
      `, [disputeId, userId, submitterRole, content.trim()]);
      evidenceRecords.push(rows[0]);
    }

    // File evidence
    for (const file of files) {
      const fileType = file.mimetype.startsWith('image') ? 'image'
                     : file.mimetype.startsWith('video') ? 'video'
                     : 'document';

      const { rows } = await db.query(`
        INSERT INTO dispute_evidence
          (dispute_id, submitted_by, submitter_role,
           type, file_url, file_name)
        VALUES ($1,$2,$3,$4,$5,$6)
        RETURNING *
      `, [
        disputeId, userId, submitterRole,
        fileType, file.location, file.originalname
      ]);
      evidenceRecords.push(rows[0]);
    }

    if (!evidenceRecords.length) {
      return res.status(400).json({ error: 'No evidence provided.' });
    }

    // Notify admin team
    await sendNotification({
      userId:     process.env.ADMIN_NOTIFICATION_USER_ID,
      type:       'dispute_update',
      title:      'New dispute evidence submitted',
      body:       `Evidence submitted for dispute ${disputeId}`,
      data:       { disputeId },
      action_url: `/admin/disputes/${disputeId}`
    });

    res.status(201).json({
      evidence: evidenceRecords,
      message:  `${evidenceRecords.length} evidence item(s) submitted.`
    });
  } catch (err) {
    console.error('submitEvidence error:', err);
    res.status(500).json({ error: 'Failed to submit evidence.' });
  }
};

// ─── GET DISPUTE DETAIL ───────────────────────────────────────
exports.getDispute = async (req, res) => {
  try {
    const userId      = req.user.id;
    const { disputeId } = req.params;
    const isAdmin     = ['admin','super_admin'].includes(req.user.role);

    // Build access condition — admins see all, users see their own
    const accessCondition = isAdmin
      ? ''
      : `AND (j.client_id = $2 OR j.assigned_helper_id = $2)`;

    const params = isAdmin ? [disputeId] : [disputeId, userId];

    const { rows: disputeRows } = await db.query(`
      SELECT
        d.*,
        j.title         AS job_title,
        j.final_price   AS job_amount,
        j.client_id,
        j.assigned_helper_id,
        u_op.first_name || ' ' || u_op.last_name AS opened_by_name,
        u_op.avatar_url                            AS opened_by_avatar,
        u_ag.first_name || ' ' || u_ag.last_name  AS against_user_name,
        u_ag.avatar_url                            AS against_user_avatar,
        u_res.first_name || ' ' || u_res.last_name AS resolved_by_name,
        e.gross_amount  AS escrow_amount,
        e.status        AS escrow_status
      FROM disputes d
      JOIN jobs j           ON d.job_id = j.id
      JOIN users u_op       ON d.opened_by = u_op.id
      JOIN users u_ag       ON d.against_user_id = u_ag.id
      LEFT JOIN users u_res ON d.resolved_by = u_res.id
      LEFT JOIN escrow_holds e ON e.job_id = j.id
      WHERE d.id = $1 ${accessCondition}
    `, params);

    if (!disputeRows.length) {
      return res.status(404).json({ error: 'Dispute not found.' });
    }

    const dispute = disputeRows[0];

    // Evidence — admins see all, parties see only their own + other's
    const { rows: evidence } = await db.query(`
      SELECT
        de.*,
        u.first_name || ' ' || u.last_name AS submitted_by_name,
        u.avatar_url                        AS submitted_by_avatar
      FROM dispute_evidence de
      JOIN users u ON de.submitted_by = u.id
      WHERE de.dispute_id = $1
      ORDER BY de.created_at ASC
    `, [disputeId]);

    // Messages — filter admin-only for non-admins
    const msgCondition = isAdmin ? '' : 'AND dm.is_admin_only = false';
    const { rows: messages } = await db.query(`
      SELECT
        dm.*,
        u.first_name || ' ' || u.last_name AS sender_name,
        u.avatar_url                        AS sender_avatar
      FROM dispute_messages dm
      JOIN users u ON dm.sender_id = u.id
      WHERE dm.dispute_id = $1 ${msgCondition}
      ORDER BY dm.created_at ASC
    `, [disputeId]);

    res.json({ dispute, evidence, messages });
  } catch (err) {
    console.error('getDispute error:', err);
    res.status(500).json({ error: 'Failed to fetch dispute.' });
  }
};

// ─── SEND DISPUTE MESSAGE ─────────────────────────────────────
exports.sendDisputeMessage = async (req, res) => {
  try {
    const userId      = req.user.id;
    const { disputeId } = req.params;
    const { message, is_admin_only = false } = req.body;
    const isAdmin     = ['admin','super_admin'].includes(req.user.role);

    if (!message?.trim()) {
      return res.status(400).json({ error: 'Message cannot be empty.' });
    }

    if (message.length > 1000) {
      return res.status(400).json({ error: 'Message too long (max 1000 chars).' });
    }

    // Verify access
    const { rows: disputeRows } = await db.query(`
      SELECT d.*, j.client_id, j.assigned_helper_id,
             j.title AS job_title
      FROM disputes d
      JOIN jobs j ON d.job_id = j.id
      WHERE d.id = $1
        AND d.status IN ('open','under_review')
    `, [disputeId]);

    if (!disputeRows.length) {
      return res.status(404).json({
        error: 'Dispute not found or not accepting messages.'
      });
    }

    const dispute = disputeRows[0];

    if (!isAdmin && dispute.client_id !== userId
        && dispute.assigned_helper_id !== userId) {
      return res.status(403).json({ error: 'Not authorized.' });
    }

    // Determine sender role
    const senderRole = isAdmin
      ? 'admin'
      : dispute.client_id === userId ? 'client' : 'helper';

    // Admin-only flag only valid for admins
    const adminOnly = isAdmin && Boolean(is_admin_only);

    const { rows } = await db.query(`
      INSERT INTO dispute_messages
        (dispute_id, sender_id, sender_role, message, is_admin_only)
      VALUES ($1,$2,$3,$4,$5)
      RETURNING *
    `, [disputeId, userId, senderRole, message.trim(), adminOnly]);

    const newMsg = rows[0];

    // Notify the other party (not admin-only messages)
    if (!adminOnly) {
      const notifyUserId = senderRole === 'client'
        ? dispute.assigned_helper_id
        : senderRole === 'helper'
        ? dispute.client_id
        : null; // Admin message notifies both

      const usersToNotify = senderRole === 'admin'
        ? [dispute.client_id, dispute.assigned_helper_id].filter(Boolean)
        : [notifyUserId].filter(Boolean);

      for (const uid of usersToNotify) {
        await sendNotification({
          userId:     uid,
          type:       'dispute_update',
          title:      'New message in your dispute',
          body:       `${senderRole === 'admin' ? 'Support' : 'The other party'} sent a message regarding "${dispute.job_title}"`,
          data:       { disputeId },
          action_url: `/disputes/${disputeId}`
        });

        // Real-time via socket
        const { broadcastToUser } = require('../services/socketService');
        broadcastToUser(uid, 'dispute:message', {
          disputeId,
          message: newMsg
        });
      }
    }

    res.status(201).json({ message: newMsg });
  } catch (err) {
    console.error('sendDisputeMessage error:', err);
    res.status(500).json({ error: 'Failed to send message.' });
  }
};

// ─── GET MY DISPUTES ──────────────────────────────────────────
exports.getMyDisputes = async (req, res) => {
  try {
    const userId = req.user.id;

    const { rows } = await db.query(`
      SELECT
        d.id, d.status, d.reason, d.resolution,
        d.created_at, d.evidence_deadline,
        d.opened_by_role,
        j.title       AS job_title,
        j.id          AS job_id,
        j.final_price AS job_amount,
        u_ag.first_name || ' ' || u_ag.last_name AS against_user_name
      FROM disputes d
      JOIN jobs j       ON d.job_id = j.id
      JOIN users u_ag   ON d.against_user_id = u_ag.id
      WHERE d.opened_by = $1
         OR d.against_user_id = $1
      ORDER BY d.created_at DESC
    `, [userId]);

    res.json({ disputes: rows });
  } catch (err) {
    console.error('getMyDisputes error:', err);
    res.status(500).json({ error: 'Failed to fetch disputes.' });
  }
};
