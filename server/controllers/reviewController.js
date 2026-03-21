const pool = require('../db');

// Create a review for a job
exports.createReview = async (req, res) => {
  try {
    const { job_id, reviewed_id, rating, body } = req.body;
    if (!rating || rating < 1 || rating > 5) {
      return res.status(400).json({ error: 'Rating must be between 1 and 5' });
    }
    const job = await pool.query('SELECT * FROM jobs WHERE id = $1', [job_id]);
    if (!job.rows[0]) return res.status(404).json({ error: 'Job not found' });
    if (job.rows[0].status !== 'completed') {
      return res.status(400).json({ error: 'Can only review completed jobs' });
    }
    const existing = await pool.query(
      'SELECT id FROM reviews WHERE reviewer_id = $1 AND job_id = $2',
      [req.user.id, job_id]
    );
    if (existing.rows[0]) {
      return res.status(400).json({ error: 'You already reviewed this job' });
    }
    const result = await pool.query(
      `INSERT INTO reviews (reviewer_id, reviewed_id, job_id, rating, body, job_completed)
       VALUES ($1, $2, $3, $4, $5, true) RETURNING *`,
      [req.user.id, reviewed_id, job_id, rating, body]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Create review error:', err);
    res.status(500).json({ error: 'Failed to create review' });
  }
};

// Get reviews for a user
exports.getUserReviews = async (req, res) => {
  try {
    const { user_id } = req.params;
    const result = await pool.query(
      `SELECT r.*, u.first_name, u.last_name, j.title as job_title
       FROM reviews r
       JOIN users u ON r.reviewer_id = u.id
       LEFT JOIN jobs j ON r.job_id = j.id
       WHERE r.reviewed_id = $1 AND r.removed = false
       ORDER BY r.created_at DESC`,
      [user_id]
    );
    const stats = await pool.query(
      `SELECT COUNT(*) as total, ROUND(AVG(rating), 1) as average
       FROM reviews WHERE reviewed_id = $1 AND removed = false`,
      [user_id]
    );
    res.json({ reviews: result.rows, stats: stats.rows[0] });
  } catch (err) {
    console.error('Get user reviews error:', err);
    res.status(500).json({ error: 'Failed to fetch reviews' });
  }
};

// Get reviews for a job
exports.getJobReviews = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT r.*, u.first_name, u.last_name
       FROM reviews r
       JOIN users u ON r.reviewer_id = u.id
       WHERE r.job_id = $1 AND r.removed = false
       ORDER BY r.created_at DESC`,
      [req.params.job_id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Get job reviews error:', err);
    res.status(500).json({ error: 'Failed to fetch reviews' });
  }
};

// Get my reviews (given and received)
exports.getMyReviews = async (req, res) => {
  try {
    const { type = 'received' } = req.query;
    const field = type === 'given' ? 'reviewer_id' : 'reviewed_id';
    const joinField = type === 'given' ? 'reviewed_id' : 'reviewer_id';
    const result = await pool.query(
      `SELECT r.*, u.first_name, u.last_name, j.title as job_title
       FROM reviews r
       JOIN users u ON r.${joinField} = u.id
       LEFT JOIN jobs j ON r.job_id = j.id
       WHERE r.${field} = $1 AND r.removed = false
       ORDER BY r.created_at DESC`,
      [req.user.id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Get my reviews error:', err);
    res.status(500).json({ error: 'Failed to fetch reviews' });
  }
};

// Flag a review
exports.flagReview = async (req, res) => {
  try {
    const { reason } = req.body;
    const result = await pool.query(
      'UPDATE reviews SET flagged = true, flagged_reason = $1 WHERE id = $2 RETURNING *',
      [reason, req.params.id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Review not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Flag review error:', err);
    res.status(500).json({ error: 'Failed to flag review' });
  }
};
