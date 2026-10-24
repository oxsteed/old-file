// CCPA Data Request Controller - Privacy Rights Management
// Handles data access/deletion/opt-out requests with 45-day compliance deadlines
const pool = require('../db');
const logger = require('../utils/logger');
const { AppError } = require('../middleware/errorHandler');
const { validate, rules } = require('../utils/validate');
const { sendEmail } = require('../utils/email');

const VALID_REQUEST_TYPES = ['access', 'deletion', 'opt_out'];
const CCPA_DEADLINE_DAYS = 45;

/**
 * Create a CCPA data request
 * POST /api/legal/privacy/request
 */
async function createCCPARequest(req, res, next) {
  try {
    const { requestType, email, requestNotes } = req.body;
    let userId = req.user?.id;

    const errs = validate(req.body, {
      requestType: [rules.required, rules.oneOf(VALID_REQUEST_TYPES)],
      email: [rules.required, rules.email, rules.maxLen(254)],
      requestNotes: [rules.maxLen(1000)]
    });
    if (errs) throw new AppError('Validation failed', 400, 'validation_failed', errs);

    // If not authenticated, find user by email
    if (!userId) {
      const userResult = await pool.query('SELECT id FROM users WHERE email = $1', [email.toLowerCase()]);
      if (userResult.rows.length > 0) {
        userId = userResult.rows[0].id;
      }
    }

    if (!userId && requestType !== 'opt_out') {
      throw new AppError('User not found', 404, 'user_not_found');
    }

    // Check for duplicate recent requests (<30 days)
    const recentRequest = await pool.query(
      `SELECT id, submitted_at FROM ccpa_data_requests
       WHERE request_type = $2
         AND submitted_at >= CURRENT_TIMESTAMP - INTERVAL '30 days'
         AND ((user_id IS NOT NULL AND user_id = $1) OR (user_id IS NULL AND lower(email) = lower($3)))
       LIMIT 1`,
      [userId || null, requestType, email.toLowerCase()]
    );

    if (recentRequest.rows.length > 0) {
      throw new AppError(
        'A similar request was recently submitted. Please wait 30 days before submitting another.',
        409,
        'duplicate_request',
        { lastSubmittedAt: recentRequest.rows[0].submitted_at }
      );
    }

    // Calculate due date (45 days from now)
    const dueAt = new Date();
    dueAt.setDate(dueAt.getDate() + CCPA_DEADLINE_DAYS);

    const result = await pool.query(
      `INSERT INTO ccpa_data_requests
       (user_id, request_type, email, status, submitted_at, due_at, request_notes)
       VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP, $5, $6)
       RETURNING id, submitted_at, due_at`,
      [userId, requestType, email.toLowerCase(), 'pending', dueAt, requestNotes || null]
    );

    const request = result.rows[0];

    // Log to audit
    await logCCPAAction('ccpa_request', userId, req.user?.id || userId, req.user?.role || 'user', request.id, 'pending', {
      requestType,
      email,
      daysToRespond: CCPA_DEADLINE_DAYS
    });

    // Send confirmation email to user
    const userEmail = email.toLowerCase();
    try {
      await sendEmail(userEmail, 'CCPA Request Confirmation', {
        template: 'ccpa_request_confirmation',
        subject: 'Your CCPA Request Has Been Submitted',
        requestType,
        dueDate: dueAt.toLocaleDateString(),
        requestId: request.id
      });
    } catch (emailErr) {
      logger.error('Failed to send CCPA confirmation email', { userId, error: emailErr.message });
    }

    logger.info('CCPA request created', { userId, requestType, requestId: request.id });

    res.status(201).json({
      success: true,
      requestId: request.id,
      submittedAt: request.submitted_at,
      dueAt: request.due_at,
      expectedResponseTime: `${CCPA_DEADLINE_DAYS} days`
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Get a specific CCPA request
 * GET /api/legal/privacy/requests/{requestId}
 */
async function getCCPARequest(req, res, next) {
  try {
    const { requestId } = req.params;
    const userId = req.user?.id;
    const isAdmin = req.user?.role === 'admin' || req.user?.role === 'super_admin';

    if (!requestId) throw new AppError('Request ID is required', 400, 'missing_request_id');

    const result = await pool.query('SELECT * FROM ccpa_data_requests WHERE id = $1', [requestId]);

    if (result.rows.length === 0) {
      throw new AppError('Request not found', 404, 'not_found');
    }

    const request = result.rows[0];

    // Check authorization: user can only see their own, admins can see all
    if (!isAdmin && request.user_id !== userId) {
      throw new AppError('Unauthorized', 403, 'forbidden');
    }

    // Calculate days remaining
    const now = new Date();
    const dueDate = new Date(request.due_at);
    const daysRemaining = Math.ceil((dueDate - now) / (1000 * 60 * 60 * 24));

    res.json({
      success: true,
      request: {
        id: request.id,
        userId: request.user_id,
        requestType: request.request_type,
        email: request.email,
        status: request.status,
        submittedAt: request.submitted_at,
        dueAt: request.due_at,
        completedAt: request.completed_at,
        fulfillmentDate: request.fulfillment_date,
        daysRemaining,
        dataProvided: request.data_provided,
        denialReason: request.denial_reason,
        requestNotes: request.request_notes,
        adminNotes: request.admin_notes,
        fulfilledBy: request.fulfilled_by_id,
        createdAt: request.created_at,
        updatedAt: request.updated_at
      }
    });
  } catch (err) {
    next(err);
  }
}

/**
 * List CCPA requests (admin only)
 * GET /api/admin/legal/ccpa-requests
 */
async function listCCPARequests(req, res, next) {
  try {
    const { status, requestType, sort = 'newest', search, page = 1, limit = 25 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    if (isNaN(offset) || isNaN(limit) || parseInt(limit) > 500) {
      throw new AppError('Invalid pagination parameters', 400, 'invalid_pagination');
    }

    let countQuery = 'SELECT COUNT(*) as total FROM ccpa_data_requests cdr LEFT JOIN users u ON cdr.user_id = u.id WHERE 1=1';
    let dataQuery = `SELECT cdr.*, u.email as user_email, u.first_name, u.last_name
                    FROM ccpa_data_requests cdr
                    LEFT JOIN users u ON cdr.user_id = u.id
                    WHERE 1=1`;
    const params = [];
    let paramCount = 1;

    if (status && ['pending', 'processing', 'awaiting_user', 'completed', 'expired', 'denied'].includes(status)) {
      countQuery += ` AND cdr.status = $${paramCount}`;
      dataQuery += ` AND cdr.status = $${paramCount}`;
      params.push(status);
      paramCount++;
    }

    if (requestType && VALID_REQUEST_TYPES.includes(requestType)) {
      countQuery += ` AND cdr.request_type = $${paramCount}`;
      dataQuery += ` AND cdr.request_type = $${paramCount}`;
      params.push(requestType);
      paramCount++;
    }

    if (search) {
      countQuery += ` AND (u.email ILIKE $${paramCount} OR u.first_name ILIKE $${paramCount} OR u.last_name ILIKE $${paramCount})`;
      dataQuery += ` AND (u.email ILIKE $${paramCount} OR u.first_name ILIKE $${paramCount} OR u.last_name ILIKE $${paramCount})`;
      params.push(`%${search}%`);
      paramCount++;
    }

    // Calculate SLA status - determine column name used for sorting
    let statusCaseExpr = 'CASE WHEN cdr.due_at < CURRENT_TIMESTAMP THEN 1 WHEN cdr.due_at < (CURRENT_TIMESTAMP + INTERVAL \'5 days\') THEN 2 ELSE 3 END';

    if (sort === 'due_soon') {
      dataQuery += ` ORDER BY cdr.due_at ASC`;
    } else if (sort === 'overdue_first') {
      dataQuery += ` ORDER BY ${statusCaseExpr} ASC, cdr.due_at ASC`;
    } else if (sort === 'oldest') {
      dataQuery += ` ORDER BY cdr.submitted_at ASC`;
    } else {
      dataQuery += ` ORDER BY cdr.submitted_at DESC`;
    }

    dataQuery += ` LIMIT $${paramCount} OFFSET $${paramCount + 1}`;
    params.push(parseInt(limit), offset);

    // T56-F01: the count query takes only the filter params (no LIMIT/OFFSET).
    const [countResult, dataResult] = await Promise.all([
      pool.query(countQuery, params.slice(0, paramCount - 1)),
      pool.query(dataQuery, params)
    ]);

    const total = parseInt(countResult.rows[0].total);
    const pages = Math.ceil(total / parseInt(limit));

    // Get SLA counts
    const slaCounts = await pool.query(
      `SELECT
        SUM(CASE WHEN due_at < CURRENT_TIMESTAMP THEN 1 ELSE 0 END) as overdue,
        SUM(CASE WHEN due_at < (CURRENT_TIMESTAMP + INTERVAL '5 days') THEN 1 ELSE 0 END) as due_soon,
        SUM(CASE WHEN due_at >= (CURRENT_TIMESTAMP + INTERVAL '5 days') THEN 1 ELSE 0 END) as on_track
       FROM ccpa_data_requests WHERE status IN ('pending', 'processing')`
    );

    const slaCounts_row = slaCounts.rows[0];
    const overdueCount = parseInt(slaCounts_row.overdue) || 0;
    const dueSoonCount = parseInt(slaCounts_row.due_soon) || 0;
    const onTrackCount = parseInt(slaCounts_row.on_track) || 0;

    logger.info('Listed CCPA requests', { total, status, requestType, page, limit });

    res.json({
      success: true,
      requests: dataResult.rows.map(row => ({
        id: row.id,
        userId: row.user_id,
        userEmail: row.user_email,
        userName: `${row.first_name} ${row.last_name}`,
        requestType: row.request_type,
        email: row.email,
        status: row.status,
        submittedAt: row.submitted_at,
        dueAt: row.due_at,
        completedAt: row.completed_at,
        adminNotes: row.admin_notes,
        denialReason: row.denial_reason,
        createdAt: row.created_at
      })),
      pagination: { total, page: parseInt(page), limit: parseInt(limit), pages },
      slaStatus: {
        overdueCount,
        dueSoonCount,
        onTrackCount
      }
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Update a CCPA request status and details (admin only)
 * PUT /api/admin/legal/ccpa-requests/{requestId}
 */
async function updateCCPARequest(req, res, next) {
  try {
    const { requestId } = req.params;
    const { status, adminNotes, dataProvided, denialReason, fulfillmentDate } = req.body;
    const adminId = req.user?.id;

    const validStatuses = ['pending', 'processing', 'awaiting_user', 'completed', 'expired', 'denied'];
    if (status && !validStatuses.includes(status)) {
      throw new AppError('Invalid status', 400, 'invalid_status');
    }

    if (adminNotes && adminNotes.length > 2000) {
      throw new AppError('Admin notes exceed 2000 characters', 400, 'notes_too_long');
    }

    const requestResult = await pool.query('SELECT * FROM ccpa_data_requests WHERE id = $1', [requestId]);

    if (requestResult.rows.length === 0) {
      throw new AppError('Request not found', 404, 'not_found');
    }

    const request = requestResult.rows[0];
    if (status === 'completed') {
      if (!['pending','processing'].includes(request.status)) throw new AppError('Request is already terminal or awaiting user action', 409, 'ccpa_invalid_transition');
      if (request.request_type === 'deletion') {
        const result = await require('../services/ccpaErasureService').completeRequest(requestId, adminId, fulfillmentDate);
        if (result.skipped) throw new AppError('Request status changed', 409, 'ccpa_invalid_transition');
        return res.status(202).json({ success: true, requestId, status: 'processing', erasureQueued: true });
      }
    }
    if (status && status !== 'processing' && status !== 'completed') {
      const erasure = await pool.query("SELECT request_id FROM ccpa_erasure_jobs WHERE request_id=$1 AND status IN ('pending','processing')", [requestId]);
      if (erasure.rows.length) throw new AppError('Erasure is already queued',409,'ccpa_erasure_in_progress');
    }

    // Build update query
    const updateFields = [];
    const updateParams = [];
    let paramCount = 1;

    if (status) {
      updateFields.push(`status = $${paramCount}`);
      updateParams.push(status);
      paramCount++;

      if (status === 'completed') {
        updateFields.push(`completed_at = CURRENT_TIMESTAMP`);
        if (adminId) {
          updateFields.push(`fulfilled_by_id = $${paramCount}`);
          updateParams.push(adminId);
          paramCount++;
        }
      }
    }

    if (adminNotes !== undefined) {
      updateFields.push(`admin_notes = $${paramCount}`);
      updateParams.push(adminNotes);
      paramCount++;
    }

    if (dataProvided) {
      updateFields.push(`data_provided = $${paramCount}`);
      updateParams.push(JSON.stringify(dataProvided));
      paramCount++;
    }

    if (denialReason && denialReason.length <= 500) {
      updateFields.push(`denial_reason = $${paramCount}`);
      updateParams.push(denialReason);
      paramCount++;
    }

    if (fulfillmentDate) {
      updateFields.push(`fulfillment_date = $${paramCount}`);
      updateParams.push(new Date(fulfillmentDate));
      paramCount++;
    }

    updateFields.push(`updated_at = CURRENT_TIMESTAMP`);

    updateParams.push(requestId);

    const updateQuery = `UPDATE ccpa_data_requests SET ${updateFields.join(', ')} WHERE id = $${paramCount}${status === 'completed' ? " AND status IN ('pending','processing')" : ''} RETURNING *`;

    const updateResult = await pool.query(updateQuery, updateParams);
    const updatedRequest = updateResult.rows[0];
    if (!updatedRequest) throw new AppError('Request status changed',409,'ccpa_invalid_transition');

    // Log to audit
    await logCCPAAction('ccpa_completed', request.user_id, adminId, 'admin', requestId, status || request.status, {
      previousStatus: request.status,
      newStatus: status,
      reason: denialReason || adminNotes
    });

    // Send notification email if completed or denied
    if (status === 'completed' || status === 'denied') {
      const userEmail = request.email;
      try {
        if (status === 'completed') await require('../services/ccpaErasureService').notifyCompleted(request);
        else await sendEmail({ to: userEmail, subject: 'Your privacy request could not be completed',
          text: `Request #${requestId}: ${denialReason || 'Contact support@oxsteed.com for details.'}` });
      } catch (emailErr) {
        logger.error('Failed to send CCPA notification email', { requestId, error: emailErr.message });
      }
    }

    logger.info('CCPA request updated', { requestId, newStatus: status, updatedBy: adminId });

    res.json({
      success: true,
      updatedAt: new Date().toISOString(),
      requestId,
      status: updatedRequest.status
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Send notification email for CCPA request (admin only)
 * POST /api/admin/legal/ccpa-requests/{requestId}/send-notification
 */
async function sendCCPANotification(req, res, next) {
  try {
    const { requestId } = req.params;
    const { message, attachData = false, denialReason } = req.body;
    const adminId = req.user?.id;

    const requestResult = await pool.query('SELECT * FROM ccpa_data_requests WHERE id = $1', [requestId]);

    if (requestResult.rows.length === 0) {
      throw new AppError('Request not found', 404, 'not_found');
    }

    const request = requestResult.rows[0];
    const userEmail = request.email;

    try {
      if (attachData && request.status === 'completed') {
        // Compile user data
        const userData = await compileUserData(request.user_id, request.request_type);

        // Send with attachment
        await sendEmail(userEmail, 'Your Requested Data is Ready for Download', {
          template: 'ccpa_data_delivery',
          subject: 'Your Data Access Request - Files Ready',
          requestType: request.request_type,
          data: userData,
          requestId
        });
      } else if (denialReason) {
        // Send denial notification
        await sendEmail(userEmail, 'CCPA Request Status Update', {
          template: 'ccpa_request_denied',
          subject: 'Your CCPA Request Status',
          denialReason,
          requestId
        });

        // Update request status
        await pool.query(
          'UPDATE ccpa_data_requests SET status = $1, denial_reason = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3',
          ['denied', denialReason, requestId]
        );
      } else if (message) {
        // Send custom message
        await sendEmail(userEmail, 'CCPA Request Status Update', {
          template: 'ccpa_generic_message',
          subject: 'Your CCPA Request Status',
          message,
          requestId
        });
      }

      logger.info('CCPA notification email sent', { requestId, sentBy: adminId });

      res.json({
        success: true,
        sentAt: new Date().toISOString(),
        requestId
      });
    } catch (emailErr) {
      throw new AppError(`Failed to send email: ${emailErr.message}`, 500, 'email_failed');
    }
  } catch (err) {
    next(err);
  }
}

/**
 * Bulk mark requests as completed (admin only)
 * POST /api/admin/legal/ccpa-requests/bulk/mark-completed
 */
async function bulkMarkCCPACompleted(req, res, next) {
  try {
    const { requestIds, fulfillmentDate } = req.body;
    const adminId = req.user?.id;

    if (!Array.isArray(requestIds) || requestIds.length === 0) {
      throw new AppError('requestIds must be a non-empty array', 400, 'invalid_input');
    }

    if (requestIds.length > 1000) {
      throw new AppError('Cannot bulk update more than 1000 requests at once', 400, 'too_many_requests');
    }

    if (requestIds.some(id => !/^[1-9][0-9]*$/.test(String(id)))) throw new AppError('Invalid request id',400,'invalid_input');
    const fDate = fulfillmentDate ? new Date(fulfillmentDate) : new Date();

    if (Number.isNaN(fDate.getTime())) throw new AppError('Invalid fulfillment date',400,'invalid_date');
    const service = require('../services/ccpaErasureService');
    let updatedCount = 0, queuedCount = 0;
    const skippedIds = [], failedIds = [];
    for (const id of [...new Set(requestIds.map(String))]) {
      if (!/^[1-9][0-9]*$/.test(id)) throw new AppError('Invalid request id',400,'invalid_input');
      try {
        const result = await service.completeRequest(id, adminId, fDate);
        if (result.skipped) skippedIds.push(id);
        else if (result.queued) queuedCount++;
        else { updatedCount++; await service.notifyCompleted(result.request); }
      } catch (err) {
        failedIds.push(id);
        logger.error('CCPA bulk completion failed', { requestId: id, code: err.code });
      }
    }

    // Log bulk action
    await logCCPAAction('ccpa_bulk_completed', null, adminId, 'admin', requestIds.join(','), 'completed', {
      bulkUpdateCount: updatedCount,
      requestIds
    });

    logger.info('CCPA requests bulk marked completed', { count: updatedCount, adminId });

    res.json({
      success: true,
      completedAt: new Date().toISOString(),
      updatedCount, queuedCount, skippedIds, failedIds
    });
  } catch (err) {
    next(err);
  }
}

// Helper: Log CCPA action
async function logCCPAAction(actionType, userId, actorId, actorRole, resourceId, status, metadata) {
  try {
    await pool.query(
      `INSERT INTO legal_audit_log
       (action_type, user_id, actor_id, actor_role, resource_id, resource_type, status, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [actionType, userId, actorId, actorRole, resourceId, 'ccpa_request', status, JSON.stringify(metadata)]
    );
  } catch (err) {
    logger.error('Failed to log CCPA action', { actionType, error: err.message });
  }
}

// ADM-045: explicit column allowlist for the CCPA profile export. The export
// is emailed to the requester, so credentials and secrets must NEVER leave
// the database via this path. `SELECT * FROM users` would include
// password_hash, totp_secret, reset_token, email_verify_token, tax_id_last4,
// and background-check vendor IDs. Only the columns below are exportable.
const USER_PROFILE_EXPORT_COLUMNS = [
  'id',
  'email',
  'phone',
  'first_name',
  'last_name',
  'username',
  'role',
  'subscription_status',
  'email_verified',
  'background_check_status',
  'background_check_passed_at',
  'w9_on_file',
  'w9_submitted_at',
  'identity_verified',
  'identity_verified_at',
  'is_active',
  'is_banned',
  'ban_reason',
  'banned_at',
  'preferred_language',
  'created_at',
  'updated_at',
  'last_login_at',
  'deleted_at'
];

// Helper: Compile user data for CCPA access request
async function compileUserData(userId, requestType) {
  try {
    const userData = {};

    if (requestType === 'access' || requestType === 'deletion') {
      // Profile data — allowlist projection, never SELECT * (ADM-045)
      const userResult = await pool.query(
        `SELECT ${USER_PROFILE_EXPORT_COLUMNS.join(', ')} FROM users WHERE id = $1`,
        [userId]
      );
      if (userResult.rows.length > 0) {
        userData.profile = userResult.rows[0];
      }

      // Messages
      const messagesResult = await pool.query(
        'SELECT * FROM messages WHERE sender_id = $1 OR receiver_id = $1 ORDER BY created_at DESC LIMIT 10000',
        [userId]
      );
      userData.messages = messagesResult.rows;

      // Payments
      const paymentsResult = await pool.query(
        'SELECT * FROM payments WHERE payer_id = $1 OR payee_id = $1 ORDER BY created_at DESC LIMIT 1000',
        [userId]
      );
      userData.payments = paymentsResult.rows;
    }

    return userData;
  } catch (err) {
    logger.error('Failed to compile user data', { userId, error: err.message });
    return {};
  }
}

module.exports = {
  createCCPARequest,
  getCCPARequest,
  listCCPARequests,
  updateCCPARequest,
  sendCCPANotification,
  bulkMarkCCPACompleted
};
