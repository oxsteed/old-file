const pool = require('../db');

// Create a bid on a job
exports.createBid = async (req, res) => {
  try {
    const { job_id, amount, message, estimated_hours } = req.body;

    const job = await pool.query('SELECT * FROM jobs WHERE id = $1', [job_id]);
    if (!job.rows[0]) return res.status(404).json({ error: 'Job not found' });
    if (job.rows[0].client_id === req.user.id) return res.status(400).json({ error: 'Cannot bid on your own job' });
    if (!['published', 'matched'].includes(job.rows[0].status)) return res.status(400).json({ error: 'Job is not accepting bids' });

    // Check for existing bid
    const existing = await pool.query('SELECT * FROM bids WHERE job_id = $1 AND helper_id = $2', [job_id, req.user.id]);
    if (existing.rows[0]) return res.status(400).json({ error: 'You already placed a bid on this job' });

    const result = await pool.query(
     'INSERT INTO bids (job_id, helper_id, amount, message, eta_hours) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [job_id, req.user.id, amount, message, estimated_hours]
    );

    // Update job status to matched if first bid
    await pool.query(`UPDATE jobs SET status = 'matched', updated_at = NOW() WHERE id = $1 AND status = 'published'`, [job_id]);

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Create bid error:', err);
    res.status(500).json({ error: 'Failed to create bid' });
  }
};

// Get bids for a job
exports.getJobBids = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT b.*, u.first_name as helper_name, hp.profile_photo_url as helper_avatar, hp.avg_rating as helper_rating,
        (SELECT COUNT(*) FROM jobs WHERE assigned_helper_id = b.helper_id AND status = 'completed') as jobs_completed
      FROM bids b
      JOIN users u ON b.helper_id = u.id
      LEFT JOIN helper_profiles hp ON hp.user_id = b.helper_id
      WHERE b.job_id = $1
      ORDER BY b.created_at DESC`,
      [req.params.job_id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Get job bids error:', err);
    res.status(500).json({ error: 'Failed to fetch bids' });
  }
};

// Get my bids (as helper)
exports.getMyBids = async (req, res) => {
  try {
    const { status } = req.query;
    let query = `SELECT b.*, j.title as job_title, j.category_name as job_category, j.status as job_status, j.location_city, j.location_state
      FROM bids b JOIN jobs j ON b.job_id = j.id WHERE b.helper_id = $1`;
    const params = [req.user.id];
    if (status) { query += ' AND b.status = $2'; params.push(status); }
    query += ' ORDER BY b.created_at DESC';
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error('Get my bids error:', err);
    res.status(500).json({ error: 'Failed to fetch bids' });
  }
};

// Update bid
exports.updateBid = async (req, res) => {
  try {
    const bid = await pool.query('SELECT * FROM bids WHERE id = $1', [req.params.id]);
    if (!bid.rows[0]) return res.status(404).json({ error: 'Bid not found' });
    if (bid.rows[0].helper_id !== req.user.id) return res.status(403).json({ error: 'Not authorized' });
    if (bid.rows[0].status !== 'pending') return res.status(400).json({ error: 'Can only update pending bids' });

    const { amount, message, eta_hours } = req.body;
    const result = await pool.query(
      'UPDATE bids SET amount = COALESCE($1, amount), message = COALESCE($2, message), eta_hours = COALESCE($3, eta_hours), updated_at = NOW() WHERE id = $4 RETURNING *',
      [amount, message, eta_hours, req.params.id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Update bid error:', err);
    res.status(500).json({ error: 'Failed to update bid' });
  }
};

// Withdraw bid
exports.withdrawBid = async (req, res) => {
  try {
    const bid = await pool.query('SELECT * FROM bids WHERE id = $1', [req.params.id]);
    if (!bid.rows[0]) return res.status(404).json({ error: 'Bid not found' });
    if (bid.rows[0].helper_id !== req.user.id) return res.status(403).json({ error: 'Not authorized' });
    if (bid.rows[0].status !== 'pending') return res.status(400).json({ error: 'Can only withdraw pending bids' });

    const result = await pool.query(
      `UPDATE bids SET status = 'withdrawn', withdrawn_at = NOW(), updated_at = NOW() WHERE id = $1 RETURNING *`,
      [req.params.id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Withdraw bid error:', err);
    res.status(500).json({ error: 'Failed to withdraw bid' });
  }
};
