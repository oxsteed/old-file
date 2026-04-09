const pool = require('../db');
const { scoreAndMatch } = require('../services/matchService');
const { uploadFile, getPublicUrl } = require('../utils/storage');
const logger = require('../utils/logger');

// ── Privacy: fuzz coordinates by +/- 2 miles for public feed ─────────────────
const FUZZ_MILES   = 2;
const MILES_TO_DEG = 1 / 69.0;
function fuzzCoords(lat, lng) {
  if (!lat || !lng) return { lat: null, lng: null };
  return {
    lat: parseFloat((parseFloat(lat) + (Math.random() * 2 - 1) * FUZZ_MILES * MILES_TO_DEG).toFixed(6)),
    lng: parseFloat((parseFloat(lng) + (Math.random() * 2 - 1) * FUZZ_MILES * MILES_TO_DEG).toFixed(6)),
  };
}

// Create a new job (wizard publish)
exports.createJob = async (req, res) => {
  try {
    const {
      title, description,
      category_id, category_name, category,
      budget_type, budget_min, budget_max,
      urgency, site_access, job_type_label, notes,
      location_address, location_city, location_state, location_zip,
      location_lat, location_lng,
      requirements, media_urls,
      // Legacy fields kept for backward compat
      job_type, priority, scheduled_date,
            // New fields from Planned Needs merge
      scheduled_time, recurrence,
      preferred_helper_id, preferred_helper_name,
      private_notes,
    } = req.body;

    // ── Validate required fields ──────────────────────────────────────────
    const errs = {};
    if (!title || title.trim().length < 10)       errs.title       = 'Title must be at least 10 characters';
    if (!description || description.trim().length < 50) errs.description = 'Description must be at least 50 characters';
    if (!location_city)                            errs.location    = 'Location is required';
    if (Object.keys(errs).length) {
      return res.status(400).json({ error: 'validation_failed', fields: errs });
    }

    // ── Resolve category ──────────────────────────────────────────────────
    const finalCategoryId   = category_id   || null;
    const finalCategoryName = category_name || category || null;

    // ── Resolve media — upload files to S3 ───────────────────────────────
    let mediaArr = [];
    if (req.files && req.files.length > 0) {
      const uploads = await Promise.allSettled(
        req.files.map(f => uploadFile(f.buffer, 'jobs', f.originalname, f.mimetype))
      );
      mediaArr = uploads
        .filter(r => r.status === 'fulfilled' && r.value)
        .map(r => getPublicUrl(r.value));
      // If S3 not configured, log warning but don't fail the job creation
      const failed = uploads.filter(r => r.status === 'rejected' || !r.value).length;
      if (failed > 0) logger.warn(`[createJob] ${failed}/${req.files.length} media files not uploaded (S3 not configured?)`);
    } else if (media_urls) {
      mediaArr = typeof media_urls === 'string'
        ? JSON.parse(media_urls)
        : (Array.isArray(media_urls) ? media_urls : []);
    }

    // ── Resolve budget ────────────────────────────────────────────────────
    const resolvedBudgetType = budget_type || 'open';
    const resolvedBudgetMin  = resolvedBudgetType !== 'open' ? (budget_min  || null) : null;
    const resolvedBudgetMax  = resolvedBudgetType !== 'open' ? (budget_max  || null) : null;
    const isUrgent           = (urgency === 'asap') || (priority === 'urgent');

    // ── Fuzz public coords ────────────────────────────────────────────────
    const approx = fuzzCoords(location_lat, location_lng);

    // ── Serialise requirements ────────────────────────────────────────────
    let reqJson = '[]';
    if (requirements) {
      reqJson = typeof requirements === 'string' ? requirements : JSON.stringify(requirements);
    }

    // ── Build location_point expression ──────────────────────────────────
    const hasGeo = location_lat && location_lng;

    const { rows } = await pool.query(
      `INSERT INTO jobs (
          client_id, title, description,
          category_id, category_name,
          budget_type, budget_min, budget_max,
          urgency, is_urgent,
          site_access, job_type_label, notes,
          location_address, location_city, location_state, location_zip,
          location_lat, location_lng,
          location_point,
          location_approx_lat, location_approx_lng,
          requirements, media_urls,
          status, expires_at
                      scheduled_date, scheduled_time, recurrence,
            preferred_helper_id, preferred_helper_name,
            private_notes,
       )
       VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
          $11,$12,$13,$14,$15,$16,$17,$18,$19,
          ${hasGeo ? `ST_SetSRID(ST_MakePoint($19::float,$18::float),4326)::geography` : 'NULL'},
          $20,$21,$22,$23,
                      $24,$25,$26,$27,$28,$29,
          'published', now() + interval '30 days'
       )
       RETURNING *`,
      [
        req.user.id, title.trim(), description.trim(),
        finalCategoryId, finalCategoryName,
        resolvedBudgetType, resolvedBudgetMin, resolvedBudgetMax,
        urgency || 'flexible', isUrgent,
        site_access || 'easy', job_type_label || job_type || 'one_time', notes || null,
        location_address || null, location_city, location_state || null, location_zip || null,
        location_lat  || null, location_lng || null,
        approx.lat, approx.lng,
        reqJson, mediaArr,
                scheduled_date || null, scheduled_time || null, recurrence || 'none',
        preferred_helper_id || null, preferred_helper_name || null,
        private_notes || null,
      ]
    );

    const job = rows[0];

    // ── Synchronous match scoring ─────────────────────────────────────────
    let matchResult = { total: 0, notified: 0 };
    try {
      matchResult = await scoreAndMatch(job);
    } catch (matchErr) {
      // Never fail the publish because of match scoring
      logger.error('Match scoring error (non-fatal)', { err: matchErr });
    }

    // ── Clear the user's draft ────────────────────────────────────────────
    try {
      await pool.query(
        `DELETE FROM job_drafts WHERE client_id = $1`,
        [req.user.id]
      );
    } catch (_) { /* non-fatal */ }

    return res.status(201).json({
      ...job,
      match_count:  matchResult.total    || 0,
      notify_count: matchResult.notified || 0,
    });
  } catch (err) {
    logger.error('Create job error', { err });
    res.status(500).json({ error: 'Failed to create job: ' + err.message });
  }
};

// Get all jobs with filters
exports.getJobs = async (req, res) => {
  try {
    const {
      category, city, state, status, q,
      min_budget, max_budget, sort,
      page = 1, limit = 20
    } = req.query;

    const offset = (page - 1) * limit;
    let conditions = [`u.is_active = true`];
    let params = [];
    let paramIdx = 1;

    if (q) {
      conditions.push(`(j.title ILIKE $${paramIdx} OR j.description ILIKE $${paramIdx} OR j.category_name ILIKE $${paramIdx})`);
      params.push(`%${q}%`);
      paramIdx++;
    }

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
    if (status && ['published','cancelled','completed','in_progress','draft','pending'].includes(status)) {
      conditions.push(`j.status = $${paramIdx++}`);
      params.push(status);
    } else {
      conditions.push(`j.status = 'published'`);
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
            SELECT COUNT(*) FROM jobs j JOIN users u ON j.client_id = u.id ${whereClause}
    `, params);

    res.json({
      jobs: rows,
      total: parseInt(countRows[0].count),
      page: parseInt(page),
      limit: parseInt(limit)
    });
  } catch (err) {
    logger.error('Get jobs error', { err });
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
    logger.error('Get job error', { err });
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
    logger.error('Update job error', { err });
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
    logger.error('Cancel job error', { err });
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
    logger.error('Assign helper error', { err });
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
    logger.error('Start job error', { err });
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
    logger.error('Complete job error', { err });
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
    logger.error('Close job error', { err });
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
    logger.error('Get my jobs error', { err });
    res.status(500).json({ error: 'Failed to fetch your jobs' });
  }
};
