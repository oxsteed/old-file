const db                    = require('../db');
const { sendNotification }  = require('../services/notificationService');
const logger                = require('../utils/logger');
const { withTransaction }   = require('../utils/transaction');
const { AppError }          = require('../middleware/errorHandler');

const DISPUTE_STATUSES = Object.freeze({
  OPEN: 'open',
  UNDER_REVIEW: 'under_review',
  RESOLVED: 'resolved',
  CLOSED: 'closed',
});

const DISPUTE_REASONS = Object.freeze({
  WORK_NOT_COMPLETED: 'work_not_completed',
  POOR_QUALITY: 'poor_quality',
  NO_SHOW: 'no_show',
  OVERCHARGED: 'overcharged',
  PROPERTY_DAMAGE: 'property_damage',
  SAFETY_CONCERN: 'safety_concern',
  FRAUD: 'fraud',
  OTHER: 'other',
});

const DISPUTE_REASON_VALUES = Object.freeze(Object.values(DISPUTE_REASONS));

// ─── OPEN DISPUTE ─────────────────────────────────────────────
exports.openDispute = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { jobId } = req.params;
    const { reason, description, job_type } = req.body;

    const fields = {};
    if (!DISPUTE_REASON_VALUES.includes(reason)) {
      fields.reason = `Invalid reason. Must be one of: ${DISPUTE_REASON_VALUES.join(', ')}`;
    }
    if (!description || description.trim().length < 20) {
      fields.description = 'Please provide at least 20 characters of description';
    }
    if (Object.keys(fields).length) {
      throw new AppError('Validation failed', 400, 'validation_failed', fields);
    }

    // Verify the requesting user is a party to this job
    const { rows: jobRows } = await db.query(
      `SELECT id FROM jobs WHERE id = $1 AND (client_id = $2 OR assigned_helper_id = $2)`,
      [jobId, userId]
    );

    if (!jobRows.length) {
      throw new AppError('You are not a party to this job', 403, 'forbidden');
    }

    // Get user name (outside transaction for single query)
    const { rows: userRows } = await db.query(
      'SELECT first_name, last_name FROM users WHERE id = $1',
      [userId]
    );
    const userName = userRows.length
      ? `${userRows[0].first_name} ${userRows[0].last_name}`
      : 'Unknown';

    // Determine role from user record
    const openedByRole = req.user.role === 'helper' ? 'helper' : 'customer';

    // Create dispute atomically with race condition prevention
    const dispute = await withTransaction(db, async (client) => {
      // Lock the job row to prevent concurrent disputes
      const { rows: jobLockRows } = await client.query(
        'SELECT id FROM jobs WHERE id = $1 FOR UPDATE',
        [jobId]
      );

      if (!jobLockRows.length) {
        throw new AppError('Job not found', 404, 'not_found');
      }

      // Check for existing disputes AFTER locking
      const { rows: existRows } = await client.query(
        `SELECT id FROM disputes WHERE job_id = $1 AND status NOT IN ($2,$3)`,
        [jobId, DISPUTE_STATUSES.RESOLVED, DISPUTE_STATUSES.CLOSED]
      );

      if (existRows.length) {
        throw new AppError('A dispute is already open for this job', 409, 'already_exists');
      }

      // Create dispute
      const { rows: disputeRows } = await client.query(`
        INSERT INTO disputes (
          job_id, job_type, opened_by, opened_by_name,
          opened_by_role, reason, description, status
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
        RETURNING *
      `, [
        jobId, job_type || 'standard', userId, userName,
        openedByRole, reason, description.trim(), DISPUTE_STATUSES.OPEN
      ]);

      if (!disputeRows.length) {
        throw new AppError('Failed to create dispute', 500, 'processing_error');
      }

      const dispute = disputeRows[0];

      // HOLD ESCROW FUNDS if job has pending escrow payment (atomic within transaction)
      const { rows: paymentRows } = await client.query(`
        SELECT id, status, escrow_status FROM payments
        WHERE job_id = $1 AND status IN ('authorized', 'captured')
        FOR UPDATE
        LIMIT 1
      `, [jobId]);

      if (paymentRows.length > 0) {
        const payment = paymentRows[0];

        // Only hold if not already held/disputed
        if (payment.escrow_status !== 'disputed' && payment.escrow_status !== 'held') {
          const { rows: updateRows } = await client.query(
            `UPDATE payments SET escrow_status = $1, updated_at = NOW() WHERE id = $2 AND escrow_status NOT IN ('disputed', 'held') RETURNING id`,
            ['disputed', payment.id]
          );

          if (updateRows.length > 0) {
            // Log to audit trail (non-critical)
            await client.query(`
              INSERT INTO platform_ledger (user_id, type, amount_cents, description, metadata)
              VALUES (NULL, 'dispute_escrow_hold', 0, $1, $2)
            `, [
              `Dispute #${dispute.id} opened - escrow hold on payment ${payment.id}`,
              JSON.stringify({ dispute_id: dispute.id, payment_id: payment.id, job_id: jobId })
            ]).catch(err => logger.error('Failed to log escrow hold', { err }));
          }
        }
      }

      return dispute;
    }, 'open_dispute');

    // Notify admins AFTER successful dispute creation (outside transaction)
    try {
      const { rows: adminRows } = await db.query(
        `SELECT id FROM users WHERE role IN ('admin', 'super_admin') AND is_active = true`
      );
      await Promise.allSettled(
        adminRows.map(admin =>
          sendNotification({
            userId: admin.id,
            type: 'dispute_opened',
            title: 'New Dispute Opened',
            message: `${userName} opened a dispute for job ${jobId}. Reason: ${reason}`,
            metadata: { disputeId: dispute.id, jobId }
          })
        )
      );
    } catch (notifErr) {
      logger.error('Failed to send dispute notification:', notifErr);
      // Don't fail the response if notifications fail
    }

    res.status(201).json({
      dispute,
      message: 'Dispute opened successfully.'
    });
  } catch (err) {
    next(err);
  }
};

// ─── GET DISPUTE DETAIL ───────────────────────────────────────
exports.getDispute = async (req, res, next) => {
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
      throw new AppError('Dispute not found', 404, 'not_found');
    }

    const dispute = rows[0];

    // Non-admins can only see their own disputes
    if (!isAdmin && dispute.opened_by !== userId) {
      throw new AppError('Not authorized', 403, 'forbidden');
    }

    res.json({ dispute });
  } catch (err) {
    next(err);
  }
};

// ─── GET MY DISPUTES ──────────────────────────────────────────
exports.getMyDisputes = async (req, res, next) => {
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
    next(err);
  }
};

// ─── SUBMIT EVIDENCE (text only, stored in disputes table) ─────
exports.submitEvidence = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { disputeId } = req.params;
    const { evidence } = req.body;
    const isAdmin = ['admin','super_admin'].includes(req.user.role);

    const fields = {};
    if (!evidence?.trim()) fields.evidence = 'Evidence cannot be empty';
    if (Object.keys(fields).length) {
      throw new AppError('Validation failed', 400, 'validation_failed', fields);
    }

    // Verify dispute exists and user has access
    const { rows: disputeRows } = await db.query(
      'SELECT * FROM disputes WHERE id = $1 AND status = $2',
      [disputeId, DISPUTE_STATUSES.OPEN]
    );

    if (!disputeRows.length) {
      throw new AppError('Dispute not found or not accepting evidence', 404, 'not_found');
    }

    const dispute = disputeRows[0];

    if (!isAdmin && dispute.opened_by !== userId) {
      throw new AppError('Not authorized', 403, 'forbidden');
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
    next(err);
  }
};


// ─── SEND DISPUTE MESSAGE ─────────────────────────────────────
exports.sendDisputeMessage = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { disputeId } = req.params;
    const { message } = req.body;

    const fields = {};
    if (!message || !message.trim()) fields.message = 'Message cannot be empty';
    if (Object.keys(fields).length) {
      throw new AppError('Validation failed', 400, 'validation_failed', fields);
    }

    // Verify dispute exists and user has access
    const { rows: disputeRows } = await db.query(
      'SELECT * FROM disputes WHERE id = $1',
      [disputeId]
    );

    if (!disputeRows.length) {
      throw new AppError('Dispute not found', 404, 'not_found');
    }

    const dispute = disputeRows[0];
    const isAdmin = ['admin', 'super_admin'].includes(req.user.role);

    if (!isAdmin && dispute.opened_by !== userId) {
      throw new AppError('Not authorized', 403, 'forbidden');
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
    next(err);
  }
};

// ─── RESOLVE DISPUTE (ADMIN ONLY) ─────────────────────────────
/**
 * Admin resolution endpoint
 * PUT /api/admin/disputes/:disputeId/resolve
 *
 * Body:
 * {
 *   resolutionType: 'refund_full' | 'refund_partial' | 'no_refund' | 'mutual_agreement',
 *   refundAmount: 1000 (in cents, if partial),
 *   adminNotes: 'Explanation...'
 * }
 */
exports.resolveDispute = async (req, res, next) => {
  try {
    const { disputeId } = req.params;
    const { resolutionType, refundAmount, adminNotes } = req.body;

    if (!['refund_full', 'refund_partial', 'no_refund', 'mutual_agreement'].includes(resolutionType)) {
      throw new AppError('Invalid resolution type', 400, 'validation_failed', {
        resolutionType: 'Must be one of: refund_full, refund_partial, no_refund, mutual_agreement'
      });
    }

    // Resolve in transaction
    const result = await withTransaction(db, async (client) => {
      // Fetch and lock dispute
      const { rows: disputeRows } = await client.query(
        'SELECT * FROM disputes WHERE id = $1 FOR UPDATE',
        [disputeId]
      );

      if (!disputeRows.length) {
        throw new AppError('Dispute not found', 404, 'dispute_not_found');
      }

      const dispute = disputeRows[0];

      // Update dispute
      const { rows: updatedRows } = await client.query(`
        UPDATE disputes
        SET
          status = $1,
          resolution_type = $2,
          refund_amount = $3,
          admin_notes = $4,
          resolved_by = $5,
          resolved_at = NOW(),
          updated_at = NOW()
        WHERE id = $6
        RETURNING *
      `, ['resolved_by_admin', resolutionType, refundAmount || 0, adminNotes || null, req.user.id, disputeId]);

      const updatedDispute = updatedRows[0];

      // Handle escrow payment release/refund
      const { rows: paymentRows } = await client.query(`
        SELECT id, amount FROM payments
        WHERE job_id = $1 AND escrow_status = 'disputed'
        FOR UPDATE
      `, [dispute.job_id]);

      if (paymentRows.length > 0) {
        const payment = paymentRows[0];
        let newEscrowStatus = 'released';

        if (resolutionType === 'refund_full') {
          newEscrowStatus = 'refunded';
        } else if (resolutionType === 'refund_partial') {
          newEscrowStatus = 'released'; // Partial refund processed
        }

        await client.query(`
          UPDATE payments
          SET
            escrow_status = $1,
            updated_at = NOW()
          WHERE id = $2
        `, [newEscrowStatus, payment.id]);

        logger.info('Dispute resolved - escrow updated', {
          disputeId,
          resolutionType,
          escrowStatus: newEscrowStatus,
          refundAmount: refundAmount || 0
        });
      }

      return updatedDispute;
    }, 'resolve_dispute');

    // Notify both parties of resolution
    try {
      const { rows: jobRows } = await db.query(
        'SELECT client_id, assigned_helper_id FROM jobs WHERE id = $1',
        [result.job_id]
      );

      if (jobRows.length > 0) {
        const job = jobRows[0];
        const message = `Dispute resolved: ${resolutionType.replace(/_/g, ' ')}`;

        await Promise.allSettled([
          sendNotification({
            userId: job.client_id,
            type: 'dispute_resolved',
            title: 'Your dispute has been resolved',
            message,
            metadata: { disputeId, jobId: result.job_id }
          }),
          sendNotification({
            userId: job.assigned_helper_id,
            type: 'dispute_resolved',
            title: 'A dispute on your job has been resolved',
            message,
            metadata: { disputeId, jobId: result.job_id }
          })
        ]);
      }
    } catch (notifErr) {
      logger.warn('Failed to notify dispute resolution', { disputeId, error: notifErr.message });
    }

    res.json({
      success: true,
      data: result,
      message: 'Dispute resolved'
    });
  } catch (err) {
    next(err);
  }
};
