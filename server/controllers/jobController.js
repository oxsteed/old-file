const pool = require('../db');

// Create a new job
exports.createJob = async (req, res) => {
  try {
    const {
      title, description, category, category_name,
      job_type, budget_min, budget_max,
      location_address, location_city, location_state, location_zip,
      location_lat, location_lng,
      priority, scheduled_date,
      media_urls
    } = req.body;

    // Map client fields: client sends 'category' but DB uses category_name
    const finalCategoryName = category_name || category || null;
    const finalCategory = category || null;

    // Handle media: uploaded files or provided URLs
    let images = [];
    if (req.files && req.files.length > 0) {
      images = req.files.map(f => f.path || f.location || f.filename);
    } else if (media_urls) {
      images = typeof media_urls === 'string' ? JSON.parse(media_urls) : (Array.isArray(media_urls) ? media_urls : []);
    }

    const result = await pool.query(
      `INSERT INTO jobs (
        client_id, title, description, category_id, category_name,
        job_type, status, budget_min, budget_max,
        location_address, location_city, location_state, location_zip,
        location_lat, location_lng,
        is_urgent, scheduled_start_at,
        media_urls
      ) VALUES (
        $1,$2,$3,$4,$5,$6,'published',$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17
      ) RETURNING *`,
      [
        req.user.id, title, description, null, finalCategoryName,
        'tier1_intro', budget_min || null, budget_max || null,
        location_address || null, location_city || null, location_state || null,
        location_zip || null, location_lat || null, location_lng || null,
        priority === 'urgent', scheduled_date || null,
        images
      ]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Create job error:', err);
    res.status(500).json({ error: 'Failed to create job: ' + err.message, detail: err.message });
  }
};

// Get all jobs with filters
exports.getJobs = async (req, res) => {
  try {
    const {
      category, city, state, status,
      min_budget, max_budget, sort,
      page = 1, limit = 20
    } = req.query;

    const offset = (page - 1) * limit;
    let conditions = [];
    let params = [];
    let paramIdx = 1;

    if (category) {
      conditions.push(`j.category_name = $${paramIdx++}`);
      params.push(category);
    }
    if (city) {
      conditions.push(`j.location_city ILIKE $${paramIdx++}`);
      params.push(`%${city}%`);
    }
    if (state) {
      conditions.push(`j.location_state = $${paramIdx++}`);
      params.push(state);
    }
    if (status) {
      conditions.push(`j.status = $${paramIdx++}`);
      params.push(status);
    }
    if (min_budget) {
      conditions.push(`j.budget_max >= $${paramIdx++}`);
      params.push(min_budget);
    }
    if (max_budget) {
      conditions.push(`j.budget_min <= $${paramIdx++}`);
      params.push(max_budget);
    }

    const whereClause = conditions.length
      ? `WHERE ${conditions.join(' AND ')}`
      : '';

    let orderBy = 'j.created_at DESC';
    if (sort === 'budget_high') orderBy = 'j.budget_max DESC NULLS LAST';
    if (sort === 'budget_low') orderBy = 'j.budget_min ASC NULLS LAST';
    if (sort === 'urgent') orderBy = 'j.is_urgent DESC, j.created_at DESC';

    const { rows } = await pool.query(`
      SELECT
        j.*,
        u.first_name || ' ' || u.last_name AS client_name,
        u.email AS client_email
      FROM jobs j
      JOIN users u ON j.client_id = u.id
      ${whereClause}
      ORDER BY ${orderBy}
      LIMIT $${paramIdx++} OFFSET $${paramIdx++}
    `, [...params, limit, offset]);

    const { rows: countRows } = await pool.query(`
      SELECT COUNT(*) FROM jobs j ${whereClause}
    `, params);

    res.json({
      jobs: rows,
      total: parseInt(countRows[0].count),
      page: parseInt(page),
      limit: parseInt(limit)
    });
  } catch (err) {
    console.error('Get jobs error:', err);
    res.status(500).json({ error: 'Failed to fetch jobs' });
  }
};

// Get single job by ID
exports.getJob = async (req, res) => {
  try {
    const { id } = req.params;

    const { rows } = await pool.query(`
      SELECT
        j.*,
        u.first_name || ' ' || u.last_name AS client_name,
        u.email AS client_email,
        h.first_name || ' ' || h.last_name AS helper_name
      FROM jobs j
      JOIN users u ON j.client_id = u.id
      LEFT JOIN users h ON j.assigned_helper_id = h.id
      WHERE j.id = $1
    `, [id]);

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Job not found' });
    }

    res.json(rows[0]);
  } catch (err) {
    console.error('Get job error:', err);
    res.status(500).json({ error: 'Failed to fetch job' });
  }
};

// Update a job (only by the client who created it)
exports.updateJob = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      title, description, category, category_name,
      budget_min, budget_max,
      location_city, location_state, location_zip,
      priority, scheduled_date
    } = req.body;

    const finalCategoryName = category_name || category || null;

    const { rows } = await pool.query(`
      UPDATE jobs SET
        title = COALESCE($1, title),
        description = COALESCE($2, description),
        category_name = COALESCE($3, category_name),
        budget_min = COALESCE($4, budget_min),
        budget_max = COALESCE($5, budget_max),
        location_city = COALESCE($6, location_city),
        location_state = COALESCE($7, location_state),
        location_zip = COALESCE($8, location_zip),
        is_urgent = COALESCE($9, is_urgent),
        scheduled_start_at = COALESCE($10, scheduled_start_at),
        updated_at = now()
      WHERE id = $11 AND client_id = $12 AND status IN ('draft','published')
      RETURNING *
    `, [
      title, description, finalCategoryName,
      budget_min, budget_max,
      location_city, location_state, location_zip,
      priority === 'urgent' ? true : (priority === 'normal' ? false : null), scheduled_date || null,
      id, req.user.id
    ]);

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Job not found or cannot be edited' });
    }

    res.json(rows[0]);
  } catch (err) {
    console.error('Update job error:', err);
    res.status(500).json({ error: 'Failed to update job' });
  }
};

// Cancel a job (soft)
exports.cancelJob = async (req, res) => {
  try {
    const { id } = req.params;

    const { rows } = await pool.query(`
      UPDATE jobs SET status = 'cancelled', deleted_at = now(), updated_at = now()
      WHERE id = $1 AND client_id = $2
      AND status IN ('draft','published','matched','negotiating')
      RETURNING *
    `, [id, req.user.id]);

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Job not found or cannot be cancelled' });
    }

    res.json({ message: 'Job cancelled', job: rows[0] });
  } catch (err) {
    console.error('Cancel job error:', err);
    res.status(500).json({ error: 'Failed to cancel job' });
  }
};

// Assign a helper to a job
exports.assignHelper = async (req, res) => {
  try {
    const { job_id, helper_id } = req.body;

    const { rows } = await pool.query(`
      UPDATE jobs SET
        assigned_helper_id = $1,
        status = 'accepted',
        updated_at = now()
      WHERE id = $2 AND client_id = $3
      AND status IN ('published','matched','negotiating')
      RETURNING *
    `, [helper_id, job_id, req.user.id]);

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Job not found or cannot be assigned' });
    }

    res.json({ message: 'Helper assigned', job: rows[0] });
  } catch (err) {
    console.error('Assign helper error:', err);
    res.status(500).json({ error: 'Failed to assign helper' });
  }
};

// Start a job
exports.startJob = async (req, res) => {
  try {
    const { id } = req.params;

    const { rows } = await pool.query(`
      UPDATE jobs SET
        status = 'in_progress',
        started_at = now(),
        updated_at = now()
      WHERE id = $1 AND (client_id = $2 OR assigned_helper_id = $2)
      AND status = 'accepted'
      RETURNING *
    `, [id, req.user.id]);

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Job not found or cannot be started' });
    }

    res.json({ message: 'Job started', job: rows[0] });
  } catch (err) {
    console.error('Start job error:', err);
    res.status(500).json({ error: 'Failed to start job' });
  }
};

// Complete a job
exports.completeJob = async (req, res) => {
  try {
    const { id } = req.params;

    const { rows } = await pool.query(`
      UPDATE jobs SET
        status = 'completed',
        completed_at = now(),
        updated_at = now()
      WHERE id = $1 AND (client_id = $2 OR assigned_helper_id = $2)
      AND status = 'in_progress'
      RETURNING *
    `, [id, req.user.id]);

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Job not found or cannot be completed' });
    }

    res.json({ message: 'Job completed', job: rows[0] });
  } catch (err) {
    console.error('Complete job error:', err);
    res.status(500).json({ error: 'Failed to complete job' });
  }
};

// Close a job (after completion, enables reviews)
exports.closeJob = async (req, res) => {
  try {
    const { id } = req.params;
    const { rows } = await pool.query(`
      UPDATE jobs SET status = 'closed', updated_at = now()
      WHERE id = $1 AND (client_id = $2 OR assigned_helper_id = $2)
      AND status = 'completed'
      RETURNING *
    `, [id, req.user.id]);
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Job not found or cannot be closed' });
    }
    res.json({ message: 'Job closed', job: rows[0] });
  } catch (err) {
    console.error('Close job error:', err);
    res.status(500).json({ error: 'Failed to close job' });
  }
};

// Get jobs posted by current user
exports.getMyJobs = async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT * FROM jobs
      WHERE client_id = $1
      ORDER BY created_at DESC
    `, [req.user.id]);

    res.json(rows);
  } catch (err) {
    console.error('Get my jobs error:', err);
    res.status(500).json({ error: 'Failed to fetch your jobs' });
  }
};
