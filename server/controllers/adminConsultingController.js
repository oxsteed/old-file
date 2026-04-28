// Admin dashboard controller for managing consulting requests
const logger = require('../utils/logger');
const db = require('../db');
const { sendEmail } = require('../utils/email');

const VALID_CONSULTING_STATUSES = ['pending', 'scheduled', 'completed', 'cancelled'];

exports.getConsultingRequests = async (req, res) => {
  const { status, limit = 50, offset = 0 } = req.query;
  try {
    // Validate status parameter if provided
    if (status && !VALID_CONSULTING_STATUSES.includes(status)) {
      return res.status(400).json({ error: 'Invalid status value' });
    }

    let query = `SELECT cs.*, c.current_phase, c.progress_pct FROM consulting_sessions cs
                 LEFT JOIN consulting_session_phases c ON cs.id = c.session_id`;
    const params = [];

    if (status) {
      query += ` WHERE cs.status = $${params.length + 1}`;
      params.push(status);
    }

    query += ` ORDER BY cs.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(parseInt(limit), parseInt(offset));

    const result = await db.query(query, params);
    const countResult = await db.query('SELECT COUNT(*) FROM consulting_sessions' + (status ? ` WHERE status = $1` : ''), status ? [status] : []);

    res.json({
      requests: result.rows,
      total: parseInt(countResult.rows[0].count),
      limit: parseInt(limit),
      offset: parseInt(offset),
    });
  } catch (err) {
    logger.error('Error fetching consulting requests', { error: err.message });
    res.status(500).json({ error: 'Failed to fetch requests' });
  }
};

exports.assignConsultantToRequest = async (req, res) => {
  const { session_id, consultant_id } = req.body;
  try {
    const consultant = await db.query('SELECT * FROM consultants WHERE id = $1', [consultant_id]);
    if (!consultant.rows.length) return res.status(404).json({ error: 'Consultant not found' });

    const result = await db.query(
      `UPDATE consulting_sessions SET consultant_id = $1, assigned_at = NOW(), status = 'scheduled'
       WHERE id = $2 RETURNING *`,
      [consultant_id, session_id]
    );

    // Send notification email to consultant
    const session = result.rows[0];
    const user = await db.query('SELECT email FROM users WHERE id = $1', [session.user_id]);

    logger.info('Consultant assigned to session', { session_id, consultant_id });
    res.json(result.rows[0]);
  } catch (err) {
    logger.error('Error assigning consultant', { error: err.message });
    res.status(500).json({ error: 'Failed to assign consultant' });
  }
};

exports.updateRequestStatus = async (req, res) => {
  const { session_id, status } = req.body;
  try {
    const result = await db.query(
      `UPDATE consulting_sessions SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
      [status, session_id]
    );
    logger.info('Consulting request status updated', { session_id, status });
    res.json(result.rows[0]);
  } catch (err) {
    logger.error('Error updating request status', { error: err.message });
    res.status(500).json({ error: 'Failed to update status' });
  }
};

exports.getAvailableConsultants = async (req, res) => {
  const { role } = req.query;
  try {
    let query = `SELECT c.*, u.first_name, u.last_name, u.email,
                 COUNT(cs.id) as active_sessions
                 FROM consultants c
                 LEFT JOIN users u ON c.user_id = u.id
                 LEFT JOIN consulting_sessions cs ON c.id = cs.consultant_id AND cs.status IN ('pending', 'scheduled')
                 WHERE c.status = 'active'`;
    const params = [];

    if (role) {
      query += ` AND c.role = $${params.length + 1}`;
      params.push(role);
    }

    query += ` GROUP BY c.id, u.id ORDER BY active_sessions ASC`;

    const result = await db.query(query, params);
    res.json(result.rows);
  } catch (err) {
    logger.error('Error fetching available consultants', { error: err.message });
    res.status(500).json({ error: 'Failed to fetch consultants' });
  }
};

exports.generateInvoice = async (req, res) => {
  const { purchase_id } = req.body;
  try {
    const purchase = await db.query(
      `SELECT cp.*, pkg.name, u.email, u.first_name FROM consulting_purchases cp
       JOIN consulting_packages pkg ON cp.package_id = pkg.id
       JOIN users u ON cp.user_id = u.id
       WHERE cp.id = $1`,
      [purchase_id]
    );

    if (!purchase.rows.length) return res.status(404).json({ error: 'Purchase not found' });

    const p = purchase.rows[0];
    const invoiceNumber = `CONS-${Date.now()}`;

    const result = await db.query(
      `INSERT INTO consulting_invoices (purchase_id, user_id, invoice_number, amount_cents, issued_date, due_date, status)
       VALUES ($1, $2, $3, $4, CURRENT_DATE, CURRENT_DATE + INTERVAL '30 days', 'sent')
       RETURNING *`,
      [purchase_id, p.user_id, invoiceNumber, p.total_cost_cents]
    );

    logger.info('Invoice generated', { invoice_number: invoiceNumber, purchase_id });
    res.json(result.rows[0]);
  } catch (err) {
    logger.error('Error generating invoice', { error: err.message });
    res.status(500).json({ error: 'Failed to generate invoice' });
  }
};

exports.getDashboardStats = async (req, res) => {
  try {
    const stats = await db.query(`
      SELECT
        (SELECT COUNT(*) FROM consulting_sessions WHERE status = 'pending') as pending_requests,
        (SELECT COUNT(*) FROM consulting_sessions WHERE status = 'scheduled') as scheduled_sessions,
        (SELECT COUNT(*) FROM consulting_purchases WHERE status = 'completed') as active_packages,
        (SELECT AVG(nps_score) FROM consulting_session_feedback WHERE nps_score IS NOT NULL) as avg_nps,
        (SELECT COUNT(DISTINCT user_id) FROM consulting_purchases WHERE status = 'completed') as total_clients
    `);

    res.json(stats.rows[0]);
  } catch (err) {
    logger.error('Error fetching dashboard stats', { error: err.message });
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
};

/**
 * List all consulting sessions with filtering and pagination
 * GET /api/consulting/admin/sessions
 */
exports.listSessions = async (req, res) => {
  const { page = 1, limit = 20, status = '', service_tier = '' } = req.query;

  const pageNum = parseInt(page) || 1;
  const limitNum = Math.min(parseInt(limit) || 20, 100);
  const offset = (pageNum - 1) * limitNum;

  try {
    // Build query conditions
    const conditions = [];
    const values = [];
    let paramIndex = 1;

    if (status) {
      conditions.push(`status = $${paramIndex}`);
      values.push(status);
      paramIndex++;
    }

    if (service_tier) {
      conditions.push(`service_tier = $${paramIndex}`);
      values.push(service_tier);
      paramIndex++;
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Get total count
    const countQuery = `SELECT COUNT(*) as total FROM consulting_sessions ${whereClause}`;
    const countResult = await db.query(countQuery, values.slice(0, paramIndex - 1));
    const total = parseInt(countResult.rows[0].total);
    const pages = Math.ceil(total / limitNum);

    // Get paginated results
    const query = `
      SELECT * FROM consulting_sessions
      ${whereClause}
      ORDER BY created_at DESC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;
    values.push(limitNum, offset);

    const result = await db.query(query, values);

    logger.info('Consulting sessions listed', {
      adminId: req.user?.id,
      count: result.rows.length,
      total,
      filters: { status, service_tier },
    });

    return res.json({
      data: result.rows,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages,
      },
    });
  } catch (err) {
    logger.error('Error listing consulting sessions', { err });
    return res.status(500).json({ error: 'Failed to fetch sessions' });
  }
};

/**
 * Get single consulting session
 * GET /api/consulting/admin/sessions/:id
 */
exports.getSessionDetail = async (req, res) => {
  const { id } = req.params;

  try {
    const result = await db.query(
      'SELECT * FROM consulting_sessions WHERE id = $1',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Session not found' });
    }

    logger.info('Consulting session retrieved', {
      adminId: req.user?.id,
      sessionId: id,
    });

    return res.json(result.rows[0]);
  } catch (err) {
    logger.error('Error fetching consulting session', { sessionId: id, err });
    return res.status(500).json({ error: 'Failed to fetch session' });
  }
};

/**
 * Update consulting session status and details
 * PATCH /api/consulting/admin/sessions/:id
 */
exports.updateSessionDetails = async (req, res) => {
  const { id } = req.params;
  const { status, consultant_assigned_id, scheduled_at } = req.body;

  try {
    // Verify session exists
    const sessionCheck = await db.query(
      'SELECT id FROM consulting_sessions WHERE id = $1',
      [id]
    );

    if (sessionCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Session not found' });
    }

    // Build update query
    const updates = [];
    const values = [];
    let paramIndex = 1;

    if (status) {
      updates.push(`status = $${paramIndex}`);
      values.push(status);
      paramIndex++;
    }

    if (consultant_assigned_id !== undefined) {
      updates.push(`consultant_assigned_id = $${paramIndex}`);
      values.push(consultant_assigned_id);
      paramIndex++;

      // Fetch consultant user data for email
      if (consultant_assigned_id) {
        const consultantUser = await db.query(
          'SELECT u.email, u.first_name FROM users u WHERE u.id = $1',
          [consultant_assigned_id]
        );
        if (consultantUser.rows.length) {
          const consultant = consultantUser.rows[0];
          // Email sending is non-blocking - failures are logged but don't fail the request
          sendEmail({
            to: consultant.email,
            subject: 'New Consulting Session Assigned',
            html: `<p>Hi ${consultant.first_name},</p><p>You have been assigned a new consulting session. Please log in to the admin dashboard to view details and get started.</p><p>Session ID: ${id}</p>`,
          }).catch(err => logger.warn('Failed to send consultant assignment email', { error: err.message, consultant_id: consultant_assigned_id }));
        }
      }
    }

    if (scheduled_at) {
      updates.push(`scheduled_at = $${paramIndex}`);
      values.push(scheduled_at);
      paramIndex++;
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    // Always update the updated_at timestamp
    updates.push(`updated_at = NOW()`);

    values.push(id);
    const query = `
      UPDATE consulting_sessions
      SET ${updates.join(', ')}
      WHERE id = $${paramIndex}
      RETURNING *
    `;

    const result = await db.query(query, values);

    logger.info('Consulting session updated', {
      adminId: req.user?.id,
      sessionId: id,
      updates: { status, consultant_assigned_id, scheduled_at },
    });

    return res.json(result.rows[0]);
  } catch (err) {
    logger.error('Error updating consulting session', { sessionId: id, err });
    return res.status(500).json({ error: 'Failed to update session' });
  }
};

/**
 * Mark a scheduled consulting session as completed
 * PATCH /api/consulting/admin/sessions/:sessionId/complete
 */
exports.completeSession = async (req, res) => {
  const { sessionId } = req.params;

  try {
    // Find the scheduled session record
    const scheduledResult = await db.query(
      'SELECT id FROM consulting_sessions_scheduled WHERE session_id = $1',
      [sessionId]
    );

    if (scheduledResult.rows.length === 0) {
      return res.status(404).json({ error: 'Scheduled session not found' });
    }

    const scheduledId = scheduledResult.rows[0].id;

    // Mark session as completed
    const result = await db.query(
      `UPDATE consulting_sessions_scheduled
       SET status = 'completed', updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [scheduledId]
    );

    logger.info('Consulting session marked as completed', {
      adminId: req.user?.id,
      sessionId,
      scheduledId,
    });

    return res.json({
      message: 'Session marked as completed. Post-session follow-up email will be sent automatically.',
      session: result.rows[0],
    });
  } catch (err) {
    logger.error('Error completing consulting session', { sessionId, err });
    return res.status(500).json({ error: 'Failed to complete session' });
  }
};

/**
 * Mark a scheduled consulting session as no-show
 * PATCH /api/consulting/admin/sessions/:sessionId/no-show
 */
exports.markNoShow = async (req, res) => {
  const { sessionId } = req.params;

  try {
    // Find the scheduled session record
    const scheduledResult = await db.query(
      'SELECT id FROM consulting_sessions_scheduled WHERE session_id = $1',
      [sessionId]
    );

    if (scheduledResult.rows.length === 0) {
      return res.status(404).json({ error: 'Scheduled session not found' });
    }

    const scheduledId = scheduledResult.rows[0].id;

    // Mark session as no-show
    const result = await db.query(
      `UPDATE consulting_sessions_scheduled
       SET status = 'no_show', updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [scheduledId]
    );

    logger.info('Consulting session marked as no-show', {
      adminId: req.user?.id,
      sessionId,
      scheduledId,
    });

    return res.json({
      message: 'Session marked as no-show. Follow-up email will be sent to customer.',
      session: result.rows[0],
    });
  } catch (err) {
    logger.error('Error marking consulting session as no-show', { sessionId, err });
    return res.status(500).json({ error: 'Failed to mark session as no-show' });
  }
};
