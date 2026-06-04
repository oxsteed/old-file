// Admin dashboard controller for managing consulting requests
const logger = require('../utils/logger');
const db = require('../db');
const { sendEmail } = require('../utils/email');

const VALID_CONSULTING_STATUSES = ['pending', 'contacted', 'scheduled', 'in_progress', 'completed', 'cancelled', 'archived'];

exports.getConsultingRequests = async (req, res) => {
  const { status, limit = 50, offset = 0, search } = req.query;
  try {
    const conditions = [];
    const params = [];
    let idx = 1;

    if (status) {
      conditions.push(`cs.status = $${idx++}`);
      params.push(status);
    }

    if (search) {
      conditions.push(`(cs.first_name ILIKE $${idx} OR cs.last_name ILIKE $${idx} OR cs.email ILIKE $${idx})`);
      params.push(`%${search}%`);
      idx++;
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const query = `
      SELECT cs.* FROM consulting_sessions cs
      ${whereClause}
      ORDER BY cs.created_at DESC
      LIMIT $${idx} OFFSET $${idx + 1}
    `;
    params.push(parseInt(limit), parseInt(offset));

    const result = await db.query(query, params);
    const countResult = await db.query(
      `SELECT COUNT(*) FROM consulting_sessions cs ${whereClause}`,
      params.slice(0, idx - 1)
    );

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
  const { page = 1, limit = 20, status = '', service_tier = '', search = '' } = req.query;

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

    if (search) {
      conditions.push(`(first_name ILIKE $${paramIndex} OR last_name ILIKE $${paramIndex} OR email ILIKE $${paramIndex})`);
      values.push(`%${search}%`);
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
  const { status, consultant_assigned_id, scheduled_at, notes, meeting_url } = req.body;

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

    if (meeting_url !== undefined) {
      updates.push(`meeting_url = $${paramIndex}`);
      values.push(meeting_url);
      paramIndex++;
    }

    if (notes !== undefined) {
      updates.push(`notes = $${paramIndex}`);
      values.push(notes);
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

/**
 * Create a consulting request/session manually (admin-initiated)
 * POST /api/consulting/admin/requests/create
 * POST /api/consulting/admin/sessions/create
 */
exports.createSessionManually = async (req, res) => {
  const {
    first_name, last_name, email, phone, business_name,
    service_tier = 'initial', description = '', areas_of_help = [],
    consultant_id, scheduled_at, meeting_url, status = 'pending',
  } = req.body;

  if (!email) {
    return res.status(400).json({ error: 'Email is required' });
  }

  try {
    const result = await db.query(
      `INSERT INTO consulting_sessions
         (first_name, last_name, email, phone, business_name, service_tier, description, areas_of_help,
          consultant_assigned_id, scheduled_at, meeting_url, status, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW(),NOW())
       RETURNING *`,
      [
        first_name || '', last_name || '', email, phone || null, business_name || null,
        service_tier, description,
        areas_of_help.length ? areas_of_help : null,
        consultant_id || null, scheduled_at || null, meeting_url || null, status,
      ]
    );

    logger.info('Consulting session created manually', { adminId: req.user?.id, sessionId: result.rows[0].id });
    return res.status(201).json(result.rows[0]);
  } catch (err) {
    logger.error('Error creating consulting session manually', { err });
    return res.status(500).json({ error: 'Failed to create session' });
  }
};

/**
 * Update request status (alias supporting body or param)
 * PATCH /api/consulting/admin/requests/:id/status
 */
exports.updateRequestStatusById = async (req, res) => {
  const { id } = req.params;
  const { status, scheduled_at, meeting_url, consultant_id } = req.body;

  if (!status) {
    return res.status(400).json({ error: 'Status is required' });
  }

  try {
    const updates = ['status = $1', 'updated_at = NOW()'];
    const values = [status];
    let idx = 2;

    if (scheduled_at) { updates.push(`scheduled_at = $${idx++}`); values.push(scheduled_at); }
    if (meeting_url !== undefined) { updates.push(`meeting_url = $${idx++}`); values.push(meeting_url); }
    if (consultant_id) { updates.push(`consultant_assigned_id = $${idx++}`); values.push(consultant_id); }

    values.push(id);
    const result = await db.query(
      `UPDATE consulting_sessions SET ${updates.join(', ')} WHERE id = $${idx} RETURNING *`,
      values
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Request not found' });
    }

    logger.info('Consulting request status updated', { adminId: req.user?.id, id, status });
    return res.json(result.rows[0]);
  } catch (err) {
    logger.error('Error updating request status by id', { id, err });
    return res.status(500).json({ error: 'Failed to update status' });
  }
};

/**
 * Enhanced getDashboardStats with more metrics
 */
exports.getEnhancedDashboardStats = async (req, res) => {
  try {
    const stats = await db.query(`
      SELECT
        (SELECT COUNT(*) FROM consulting_sessions WHERE status = 'pending') as pending_requests,
        (SELECT COUNT(*) FROM consulting_sessions WHERE status = 'scheduled') as scheduled_sessions,
        (SELECT COUNT(*) FROM consulting_sessions WHERE status = 'completed') as completed_sessions,
        (SELECT COUNT(*) FROM consulting_sessions WHERE status = 'cancelled') as cancelled_sessions,
        (SELECT COUNT(DISTINCT email) FROM consulting_sessions WHERE status IN ('scheduled','completed')) as total_clients,
        (SELECT AVG(nps_score) FROM consulting_session_feedback WHERE nps_score IS NOT NULL) as avg_nps,
        (SELECT COALESCE(SUM(amount_cents),0) FROM consulting_payments WHERE status = 'completed') as total_revenue_cents,
        (SELECT COALESCE(SUM(amount_cents),0) FROM consulting_payments WHERE status IN ('pending','processing')) as pending_revenue_cents,
        (SELECT COALESCE(SUM(amount_cents),0) FROM consulting_payments WHERE status = 'refunded') as refunded_cents,
        (SELECT COUNT(*) FROM consulting_purchases WHERE status = 'completed') as active_packages
    `);

    const s = stats.rows[0];
    const total = parseInt(s.completed_sessions) + parseInt(s.cancelled_sessions);
    const cancellationRate = total > 0 ? Math.round((parseInt(s.cancelled_sessions) / total) * 100) : 0;

    return res.json({ ...s, cancellation_rate: cancellationRate });
  } catch (err) {
    logger.error('Error fetching enhanced dashboard stats', { err });
    return res.status(500).json({ error: 'Failed to fetch stats' });
  }
};

/**
 * List all admin purchases
 * GET /api/consulting/admin/purchases
 */
exports.listPurchases = async (req, res) => {
  try {
    const result = await db.query(`
      SELECT cp.*, u.first_name, u.last_name, u.email, pkg.package_name, pkg.service_tier as package_tier
      FROM consulting_purchases cp
      LEFT JOIN users u ON cp.user_id = u.id
      LEFT JOIN consulting_packages pkg ON cp.package_id = pkg.id
      ORDER BY cp.created_at DESC
      LIMIT 100
    `);
    return res.json(result.rows);
  } catch (err) {
    logger.error('Error listing consulting purchases', { err });
    return res.status(500).json({ error: 'Failed to fetch purchases' });
  }
};

/**
 * List all admin invoices
 * GET /api/consulting/admin/invoices
 */
exports.listInvoices = async (req, res) => {
  try {
    const result = await db.query(`
      SELECT ci.*, u.first_name, u.last_name, u.email as client_email,
             pkg.package_name, cp.service_tier
      FROM consulting_invoices ci
      LEFT JOIN consulting_purchases cp ON ci.purchase_id = cp.id
      LEFT JOIN users u ON ci.user_id = u.id
      LEFT JOIN consulting_packages pkg ON cp.package_id = pkg.id
      ORDER BY ci.issued_date DESC
      LIMIT 200
    `);
    return res.json(result.rows);
  } catch (err) {
    logger.error('Error listing consulting invoices', { err });
    return res.status(500).json({ error: 'Failed to fetch invoices' });
  }
};

/**
 * Generate a manual invoice for a client not in the system
 * POST /api/consulting/admin/invoices/generate-manual
 */
exports.generateManualInvoice = async (req, res) => {
  const { client_email, client_name, package_tier, amount_cents, notes } = req.body;
  if (!client_email || !client_name) {
    return res.status(400).json({ error: 'Client email and name required' });
  }
  try {
    const invoiceNumber = `CONS-${Date.now()}`;
    const result = await db.query(
      `INSERT INTO consulting_invoices (invoice_number, amount_cents, status, issued_date, due_date, notes)
       VALUES ($1, $2, 'sent', CURRENT_DATE, CURRENT_DATE + INTERVAL '30 days', $3)
       RETURNING *`,
      [invoiceNumber, amount_cents || 0, notes || null]
    );

    // Non-blocking email send
    sendEmail({
      to: client_email,
      subject: `Invoice ${invoiceNumber} - OxSteed Consulting`,
      html: `<p>Dear ${client_name},</p><p>Please find your invoice for consulting services attached.</p><p><strong>Invoice #:</strong> ${invoiceNumber}<br><strong>Amount:</strong> $${((amount_cents || 0) / 100).toFixed(2)}</p><p>Please contact us if you have any questions.</p>`,
    }).catch(err => logger.warn('Failed to send invoice email', { error: err.message }));

    logger.info('Manual invoice generated', { invoiceNumber, adminId: req.user?.id, client_email });
    return res.status(201).json({ ...result.rows[0], client_email, client_name });
  } catch (err) {
    logger.error('Error generating manual invoice', { err });
    return res.status(500).json({ error: 'Failed to generate invoice' });
  }
};

/**
 * Download an invoice as CSV (admin)
 * GET /api/consulting/admin/invoices/:invoiceId/download
 */
exports.downloadInvoice = async (req, res) => {
  const { invoiceId } = req.params;
  try {
    const result = await db.query(
      `SELECT ci.id, ci.purchase_id, ci.user_id, ci.invoice_number, ci.amount_cents, ci.issued_date, ci.due_date, ci.status, ci.notes, ci.created_at,
              cp.package_name, u.email, u.first_name, u.last_name
       FROM consulting_invoices ci
       LEFT JOIN consulting_purchases cp ON cp.id = ci.purchase_id
       LEFT JOIN users u ON u.id = ci.user_id
       WHERE ci.id = $1`,
      [invoiceId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Invoice not found' });
    }

    const invoice = result.rows[0];
    const invoiceName = `consulting-invoice-${invoice.invoice_number || invoice.id}.csv`;
    const csv = [
      ['invoice_id', 'invoice_number', 'amount_cents', 'issued_date', 'due_date', 'status', 'package_name', 'customer_name', 'customer_email', 'notes', 'created_at']
        .join(','),
      [
        invoice.id,
        invoice.invoice_number || '',
        invoice.amount_cents || 0,
        invoice.issued_date ? new Date(invoice.issued_date).toISOString(),
        invoice.due_date ? new Date(invoice.due_date).toISOString(),
        invoice.status || '',
        `"${String(invoice.package_name || '').replaceAll('"', '""')}"`,
        `"${String(`${invoice.first_name || ''} ${invoice.last_name || ''}`.trim()).replaceAll('"', '""')}"`,
        invoice.email || '',
        `"${String(invoice.notes || '').replaceAll('"', '""')}"`,
        new Date(invoice.created_at).toISOString(),
      ].join(','),
    ].join('\n');

    res.set({
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${invoiceName}"`,
      'Cache-Control': 'no-store',
    });
    return res.status(200).send(csv);
  } catch (err) {
    logger.error('Error downloading consulting invoice', { invoiceId, err });
    return res.status(500).json({ error: 'Failed to download invoice' });
  }
};

/**
 * Update consulting package (admin)
 * PATCH /api/consulting/admin/packages/:id
 */
exports.updatePackage = async (req, res) => {
  const { id } = req.params;
  const { name, description, base_price, session_count, is_active } = req.body;
  try {
    const updates = [];
    const values = [];
    let idx = 1;

    if (name !== undefined) { updates.push(`package_name = $${idx++}`); values.push(name); }
    if (description !== undefined) { updates.push(`description = $${idx++}`); values.push(description); }
    if (base_price !== undefined) { updates.push(`base_price = $${idx++}`); values.push(base_price); }
    if (session_count !== undefined) { updates.push(`duration_hours = $${idx++}`); values.push(session_count); }
    if (is_active !== undefined) { updates.push(`is_active = $${idx++}`); values.push(is_active); }

    if (updates.length === 0) return res.status(400).json({ error: 'No fields to update' });

    values.push(id);
    const result = await db.query(
      `UPDATE consulting_packages SET ${updates.join(', ')} WHERE id = $${idx} RETURNING *`,
      values
    );

    if (result.rows.length === 0) return res.status(404).json({ error: 'Package not found' });
    return res.json(result.rows[0]);
  } catch (err) {
    logger.error('Error updating consulting package', { id, err });
    return res.status(500).json({ error: 'Failed to update package' });
  }
};

/**
 * Send session reminder email
 * POST /api/consulting/admin/sessions/:id/send-reminder
 */
exports.sendSessionReminder = async (req, res) => {
  const { id } = req.params;
  try {
    const result = await db.query(
      'SELECT * FROM consulting_sessions WHERE id = $1',
      [id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Session not found' });

    const session = result.rows[0];
    if (session.email) {
      await sendEmail({
        to: session.email,
        subject: 'Reminder: Your Consulting Session',
        html: `<p>Hi ${session.first_name},</p><p>This is a reminder about your upcoming consulting session${session.scheduled_at ? ` on ${new Date(session.scheduled_at).toLocaleString()}` : ''}.</p>${session.meeting_url ? `<p><a href="${session.meeting_url}">Join the session</a></p>` : ''}<p>Please reach out if you need to reschedule.</p>`,
      });
    }

    await db.query('UPDATE consulting_sessions SET updated_at = NOW() WHERE id = $1', [id]);
    return res.json({ message: 'Reminder sent' });
  } catch (err) {
    logger.error('Error sending session reminder', { id, err });
    return res.status(500).json({ error: 'Failed to send reminder' });
  }
};

/**
 * Send follow-up email after session
 * POST /api/consulting/admin/sessions/:id/send-followup
 */
exports.sendSessionFollowUp = async (req, res) => {
  const { id } = req.params;
  try {
    const result = await db.query('SELECT * FROM consulting_sessions WHERE id = $1', [id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Session not found' });

    const session = result.rows[0];
    if (session.email) {
      await sendEmail({
        to: session.email,
        subject: 'Thank You - Consulting Session Follow-up',
        html: `<p>Hi ${session.first_name},</p><p>Thank you for your consulting session with OxSteed. We hope it was valuable.</p><p>Please review your action items and reach out if you have any questions about next steps.</p><p>We look forward to supporting your business journey.</p>`,
      });
    }

    return res.json({ message: 'Follow-up email sent' });
  } catch (err) {
    logger.error('Error sending follow-up email', { id, err });
    return res.status(500).json({ error: 'Failed to send follow-up' });
  }
};
