const pool = require('../db');

// Create a new job
exports.createJob = async (req, res) => {
  try {
    const { title, description, category, subcategory, budget_min, budget_max, priority, location_address, location_city, location_state, location_zip, location_lat, location_lng, is_remote, scheduled_date, scheduled_time_start, scheduled_time_end, estimated_duration_hours, requirements, images, tags } = req.body;
    const result = await pool.query(
      `INSERT INTO jobs (poster_id, title, description, category, subcategory, budget_min, budget_max, priority, location_address, location_city, location_state, location_zip, location_lat, location_lng, is_remote, scheduled_date, scheduled_time_start, scheduled_time_end, estimated_duration_hours, requirements, images, tags)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22) RETURNING *`,
      [req.user.id, title, description, category, subcategory, budget_min, budget_max, priority || 'normal', location_address, location_city, location_state, location_zip, location_lat, location_lng, is_remote || false, scheduled_date, scheduled_time_start, scheduled_time_end, estimated_duration_hours, JSON.stringify(requirements || []), JSON.stringify(images || []), JSON.stringify(tags || [])]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Create job error:', err);
    res.status(500).json({ error: 'Failed to create job' });
  }
};

// Get all jobs with filters
exports.getJobs = async (req, res) => {
  try {
    const { category, city, state, status, min_budget, max_budget, sort, page = 1, limit = 20 } = req.query;
    let query = 'SELECT j.*, u.first_name as poster_name, u.avatar_url as poster_avatar, (SELECT COUNT(*) FROM bids WHERE job_id = j.id) as bid_count FROM jobs j JOIN users u ON j.poster_id = u.id WHERE 1=1';
    const params = [];
    let idx = 1;
    if (category) { query += ` AND j.category = $${idx++}`; params.push(category); }
    if (city) { query += ` AND j.location_city ILIKE $${idx++}`; params.push(`%${city}%`); }
    if (state) { query += ` AND j.location_state = $${idx++}`; params.push(state); }
    if (status) { query += ` AND j.status = $${idx++}`; params.push(status); }
    else { query += ` AND j.status IN ('open', 'bidding')`; }
    if (min_budget) { query += ` AND j.budget_max >= $${idx++}`; params.push(min_budget); }
    if (max_budget) { query += ` AND j.budget_min <= $${idx++}`; params.push(max_budget); }
    if (sort === 'newest') query += ' ORDER BY j.created_at DESC';
    else if (sort === 'budget_high') query += ' ORDER BY j.budget_max DESC NULLS LAST';
    else if (sort === 'budget_low') query += ' ORDER BY j.budget_min ASC NULLS LAST';
    else query += ' ORDER BY j.created_at DESC';
    const offset = (page - 1) * limit;
    query += ` LIMIT $${idx++} OFFSET $${idx++}`;
    params.push(limit, offset);
    const countQuery = query.replace(/SELECT.*FROM/, 'SELECT COUNT(*) FROM').split('ORDER BY')[0].split('LIMIT')[0];
    const [jobsResult, countResult] = await Promise.all([
      pool.query(query, params),
      pool.query(countQuery, params.slice(0, -2))
    ]);
    res.json({ jobs: jobsResult.rows, total: parseInt(countResult.rows[0].count), page: parseInt(page), limit: parseInt(limit) });
  } catch (err) {
    console.error('Get jobs error:', err);
    res.status(500).json({ error: 'Failed to fetch jobs' });
  }
};

// Get single job by ID
exports.getJob = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT j.*, u.first_name as poster_name, u.avatar_url as poster_avatar, u.email as poster_email,
       (SELECT json_agg(row_to_json(b)) FROM (SELECT b.*, hu.first_name as helper_name, hu.avatar_url as helper_avatar FROM bids b JOIN users hu ON b.helper_id = hu.id WHERE b.job_id = j.id ORDER BY b.created_at DESC) b) as bids
       FROM jobs j JOIN users u ON j.poster_id = u.id WHERE j.id = $1`,
      [req.params.id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Job not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Get job error:', err);
    res.status(500).json({ error: 'Failed to fetch job' });
  }
};

// Update job
exports.updateJob = async (req, res) => {
  try {
    const job = await pool.query('SELECT * FROM jobs WHERE id = $1', [req.params.id]);
    if (!job.rows[0]) return res.status(404).json({ error: 'Job not found' });
    if (job.rows[0].poster_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Not authorized' });
    }
    const { title, description, category, budget_min, budget_max, priority, scheduled_date } = req.body;
    const result = await pool.query(
      `UPDATE jobs SET title = COALESCE($1, title), description = COALESCE($2, description), category = COALESCE($3, category), budget_min = COALESCE($4, budget_min), budget_max = COALESCE($5, budget_max), priority = COALESCE($6, priority), scheduled_date = COALESCE($7, scheduled_date), updated_at = NOW() WHERE id = $8 RETURNING *`,
      [title, description, category, budget_min, budget_max, priority, scheduled_date, req.params.id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Update job error:', err);
    res.status(500).json({ error: 'Failed to update job' });
  }
};

// Cancel job
exports.cancelJob = async (req, res) => {
  try {
    const job = await pool.query('SELECT * FROM jobs WHERE id = $1', [req.params.id]);
    if (!job.rows[0]) return res.status(404).json({ error: 'Job not found' });
    if (job.rows[0].poster_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Not authorized' });
    }
    if (['completed', 'cancelled'].includes(job.rows[0].status)) {
      return res.status(400).json({ error: 'Cannot cancel this job' });
    }
    const result = await pool.query(
      `UPDATE jobs SET status = 'cancelled', cancelled_at = NOW(), cancellation_reason = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
      [req.body.reason || 'Cancelled by poster', req.params.id]
    );
    // Reject all pending bids
    await pool.query(`UPDATE bids SET status = 'rejected', rejected_at = NOW() WHERE job_id = $1 AND status = 'pending'`, [req.params.id]);
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Cancel job error:', err);
    res.status(500).json({ error: 'Failed to cancel job' });
  }
};

// Assign helper to job
exports.assignHelper = async (req, res) => {
  try {
    const { bid_id } = req.body;
    const bid = await pool.query('SELECT * FROM bids WHERE id = $1', [bid_id]);
    if (!bid.rows[0]) return res.status(404).json({ error: 'Bid not found' });
    const job = await pool.query('SELECT * FROM jobs WHERE id = $1', [bid.rows[0].job_id]);
    if (!job.rows[0]) return res.status(404).json({ error: 'Job not found' });
    if (job.rows[0].poster_id !== req.user.id) return res.status(403).json({ error: 'Not authorized' });
    // Accept bid and assign helper
    await pool.query(`UPDATE bids SET status = 'accepted', accepted_at = NOW() WHERE id = $1`, [bid_id]);
    // Reject other pending bids
    await pool.query(`UPDATE bids SET status = 'rejected', rejected_at = NOW() WHERE job_id = $1 AND id != $2 AND status = 'pending'`, [bid.rows[0].job_id, bid_id]);
    const result = await pool.query(
      `UPDATE jobs SET helper_id = $1, status = 'assigned', final_price = $2, assigned_at = NOW(), updated_at = NOW() WHERE id = $3 RETURNING *`,
      [bid.rows[0].helper_id, bid.rows[0].amount, bid.rows[0].job_id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Assign helper error:', err);
    res.status(500).json({ error: 'Failed to assign helper' });
  }
};

// Start job (helper confirms they started)
exports.startJob = async (req, res) => {
  try {
    const job = await pool.query('SELECT * FROM jobs WHERE id = $1', [req.params.id]);
    if (!job.rows[0]) return res.status(404).json({ error: 'Job not found' });
    if (job.rows[0].helper_id !== req.user.id) return res.status(403).json({ error: 'Not authorized' });
    if (job.rows[0].status !== 'assigned') return res.status(400).json({ error: 'Job must be assigned first' });
    const result = await pool.query(
      `UPDATE jobs SET status = 'in_progress', started_at = NOW(), updated_at = NOW() WHERE id = $1 RETURNING *`,
      [req.params.id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Start job error:', err);
    res.status(500).json({ error: 'Failed to start job' });
  }
};

// Complete job (both parties must confirm)
exports.completeJob = async (req, res) => {
  try {
    const job = await pool.query('SELECT * FROM jobs WHERE id = $1', [req.params.id]);
    if (!job.rows[0]) return res.status(404).json({ error: 'Job not found' });
    if (job.rows[0].status !== 'in_progress') return res.status(400).json({ error: 'Job must be in progress' });
    const isPoster = job.rows[0].poster_id === req.user.id;
    const isHelper = job.rows[0].helper_id === req.user.id;
    if (!isPoster && !isHelper) return res.status(403).json({ error: 'Not authorized' });
    const updateField = isPoster ? 'poster_confirmed' : 'helper_confirmed';
    await pool.query(`UPDATE jobs SET ${updateField} = true, updated_at = NOW() WHERE id = $1`, [req.params.id]);
    // Check if both confirmed
    const updated = await pool.query('SELECT * FROM jobs WHERE id = $1', [req.params.id]);
    if (updated.rows[0].poster_confirmed && updated.rows[0].helper_confirmed) {
      const result = await pool.query(
        `UPDATE jobs SET status = 'completed', completed_at = NOW(), updated_at = NOW() WHERE id = $1 RETURNING *`,
        [req.params.id]
      );
      return res.json({ ...result.rows[0], fully_completed: true });
    }
    res.json({ ...updated.rows[0], fully_completed: false, message: `Waiting for ${isPoster ? 'helper' : 'poster'} confirmation` });
  } catch (err) {
    console.error('Complete job error:', err);
    res.status(500).json({ error: 'Failed to complete job' });
  }
};

// Get my jobs (as poster or helper)
exports.getMyJobs = async (req, res) => {
  try {
    const { role = 'poster', status } = req.query;
    let query;
    if (role === 'helper') {
      query = 'SELECT j.*, u.first_name as poster_name FROM jobs j JOIN users u ON j.poster_id = u.id WHERE j.helper_id = $1';
    } else {
      query = 'SELECT j.*, hu.first_name as helper_name FROM jobs j LEFT JOIN users hu ON j.helper_id = hu.id WHERE j.poster_id = $1';
    }
    const params = [req.user.id];
    if (status) { query += ' AND j.status = $2'; params.push(status); }
    query += ' ORDER BY j.created_at DESC';
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error('Get my jobs error:', err);
    res.status(500).json({ error: 'Failed to fetch jobs' });
  }
};
