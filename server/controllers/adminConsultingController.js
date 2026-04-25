// Admin dashboard controller for managing consulting requests
const logger = require('../utils/logger');
const db = require('../db');

exports.getConsultingRequests = async (req, res) => {
  const { status, limit = 50, offset = 0 } = req.query;
  try {
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
