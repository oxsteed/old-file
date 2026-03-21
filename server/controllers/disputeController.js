const pool = require('../db');

// Create a dispute
exports.createDispute = async (req, res) => {
  try {
    const { job_id, reason, description, evidence } = req.body;
    const job = await pool.query('SELECT * FROM jobs WHERE id = $1', [job_id]);
    if (!job.rows[0]) return res.status(404).json({ error: 'Job not found' });
    const isPoster = job.rows[0].poster_id === req.user.id;
    const isHelper = job.rows[0].helper_id === req.user.id;
    if (!isPoster && !isHelper) return res.status(403).json({ error: 'Not authorized' });
    const against = isPoster ? job.rows[0].helper_id : job.rows[0].poster_id;
    // Check for existing open dispute
    const existing = await pool.query('SELECT * FROM disputes WHERE job_id = $1 AND status IN ($2, $3)', [job_id, 'open', 'under_review']);
    if (existing.rows[0]) return res.status(400).json({ error: 'An active dispute already exists for this job' });
    // Get payment if exists
    const payment = await pool.query('SELECT id FROM payments WHERE job_id = $1 ORDER BY created_at DESC LIMIT 1', [job_id]);
    const result = await pool.query(
      `INSERT INTO disputes (job_id, payment_id, raised_by, against_user, reason, description, evidence)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [job_id, payment.rows[0]?.id || null, req.user.id, against, reason, description, JSON.stringify(evidence || [])]
    );
    // Update job status
    await pool.query(`UPDATE jobs SET status = 'disputed', updated_at = NOW() WHERE id = $1`, [job_id]);
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Create dispute error:', err);
    res.status(500).json({ error: 'Failed to create dispute' });
  }
};

// Get dispute by ID
exports.getDispute = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT d.*, j.title as job_title, u1.first_name as raised_by_name, u2.first_name as against_name,
       (SELECT json_agg(row_to_json(dm)) FROM (SELECT dm.*, su.first_name as sender_name FROM dispute_messages dm JOIN users su ON dm.sender_id = su.id WHERE dm.dispute_id = d.id ORDER BY dm.created_at ASC) dm) as messages
       FROM disputes d JOIN jobs j ON d.job_id = j.id JOIN users u1 ON d.raised_by = u1.id JOIN users u2 ON d.against_user = u2.id WHERE d.id = $1`,
      [req.params.id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Dispute not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Get dispute error:', err);
    res.status(500).json({ error: 'Failed to fetch dispute' });
  }
};

// Add message to dispute
exports.addMessage = async (req, res) => {
  try {
    const { message, attachments } = req.body;
    const dispute = await pool.query('SELECT * FROM disputes WHERE id = $1', [req.params.id]);
    if (!dispute.rows[0]) return res.status(404).json({ error: 'Dispute not found' });
    if (!['open', 'under_review'].includes(dispute.rows[0].status)) {
      return res.status(400).json({ error: 'Dispute is closed' });
    }
    const result = await pool.query(
      'INSERT INTO dispute_messages (dispute_id, sender_id, message, attachments, is_admin) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [req.params.id, req.user.id, message, JSON.stringify(attachments || []), req.user.role === 'admin']
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Add dispute message error:', err);
    res.status(500).json({ error: 'Failed to add message' });
  }
};

// Get my disputes
exports.getMyDisputes = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT d.*, j.title as job_title FROM disputes d JOIN jobs j ON d.job_id = j.id
       WHERE d.raised_by = $1 OR d.against_user = $1 ORDER BY d.created_at DESC`,
      [req.user.id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Get my disputes error:', err);
    res.status(500).json({ error: 'Failed to fetch disputes' });
  }
};

// Resolve dispute (admin only)
exports.resolveDispute = async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
    const { resolution, resolution_type, refund_amount, admin_notes } = req.body;
    const result = await pool.query(
      `UPDATE disputes SET status = $1, resolution = $2, resolution_type = $3, resolved_by = $4, refund_amount = $5, admin_notes = $6, resolved_at = NOW(), updated_at = NOW() WHERE id = $7 RETURNING *`,
      [resolution_type === 'refund_full' || resolution_type === 'refund_partial' ? 'resolved_poster' : 'resolved_helper', resolution, resolution_type, req.user.id, refund_amount, admin_notes, req.params.id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Dispute not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Resolve dispute error:', err);
    res.status(500).json({ error: 'Failed to resolve dispute' });
  }
};
