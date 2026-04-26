const pool = require('../db');
const { scoreAndMatch } = require('../services/matchService');
const { uploadFile, getPublicUrl } = require('../utils/storage');
const logger = require('../utils/logger');
const { fuzzCoords } = require('../models/jobModel');
const { withJobTransaction } = require('../utils/transaction');
const { captureAuthorizedPaymentWithClient } = require('../services/paymentCaptureService');

function isTier3EscrowJob(jobRow) {
  const label = String(jobRow?.job_type_label || '').toLowerCase();
  const jt = String(jobRow?.job_type || '').toLowerCase();
  return label.includes('tier3') || label.includes('escrow') || jt.includes('tier3') || jt.includes('escrow');
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
      // Phase 7: Business Skills
      required_skills,
    } = req.body;

    // ── Validate required fields ────────────────────────────────────────────────────────────────────
    const errs = {};
    if (!title || title.trim().length < 10)       errs.title       = 'Title must be at least 10 characters';
    if (!description || description.trim().length < 50) errs.description = 'Description must be at least 50 characters';
    if (!location_city)                            errs.location    = 'Location is required';
    if (Object.keys(errs).length) {
      return res.status(400).json({ error: 'validation_failed', fields: errs });
    }

    // ── Resolve category ──────────────────────────────────────────────────────────────────────────
    const finalCategoryId   = category_id   || null;
    const finalCategoryName = category_name || category || null;

    // ── Resolve media — upload files to S3 ─────────────────────────────────────────────────────
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

    // ── Resolve budget ────────────────────────────────────────────────────────────────────────────
    const resolvedBudgetType = budget_type || 'open';
    const resolvedBudgetMin  = resolvedBudgetType !== 'open' ? (budget_min  || null) : null;
    const resolvedBudgetMax  = resolvedBudgetType !== 'open' ? (budget_max  || null) : null;
    const isUrgent           = (urgency === 'asap') || (priority === 'urgent');

    // ── Fuzz public coords ───────────────────────────────────────────────────────────────────────────
    const approx = fuzzCoords(location_lat, location_lng);

    // ── Serialise requirements ─────────────────────────────────────────────────────────────────────────
    let reqJson = '[]';
    if (requirements) {
      reqJson = typeof requirements === 'string' ? requirements : JSON.stringify(requirements);
    }

    // ── Process required skills ────────────────────────────────────────────────────────────────────────
    let skillsJson = '[]';
    let skillIds = '{}';
    if (required_skills && Array.isArray(required_skills) && required_skills.length > 0) {
      // Validate skill count
      if (required_skills.length > 20) {
        return res.status(400).json({ error: 'validation_failed', fields: { required_skills: 'Maximum 20 skills allowed' } });
      }
      // Extract IDs for efficient filtering and store full objects
      skillIds = `{${required_skills.map(s => s.id || s.skill_id).join(',')}}`;
      skillsJson = JSON.stringify(required_skills);
    }

    // ── Build location_point expression ─────────────────────────────────────────────────────────────
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
          required_skills, skill_ids,
          scheduled_date, scheduled_time, recurrence,
          preferred_helper_id, preferred_helper_name,
          private_notes,
          status, expires_at
       )
       VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
          $11,$12,$13,$14,$15,$16,$17,$18,$19,
          ${hasGeo ? `ST_SetSRID(ST_MakePoint($19::float,$18::float),4326)::geography` : 'NULL'},
          $20,$21,$22,$23,$24,
          $25,$26,$27,$28,$29,$30,
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
        skillsJson, skillIds,
        scheduled_date || null, scheduled_time || null, recurrence || 'none',
        preferred_helper_id || null, preferred_helper_name || null,
        private_notes || null,
      ]
    );

    // Strip exact GPS coordinates from the response — helpers see only fuzzy coords
    // eslint-disable-next-line no-unused-vars
    const { location_lat: _rlat, location_lng: _rlng, location_point: _rpt, ...safeJob } = rows[0];

    // ── Synchronous match scoring ───────────────────────────────────────────────────────────────────────
    let matchResult = { total: 0, notified: 0 };
    try {
      matchResult = await scoreAndMatch(rows[0]);
    } catch (matchErr) {
      // Never fail the publish because of match scoring
      logger.error('Match scoring error (non-fatal)', { jobId: rows[0]?.id, error: matchErr.message });
    }

    // ── Clear the user's draft ──────────────────────────────────────────────────────────────────────────
    try {
      await pool.query(
        `DELETE FROM job_drafts WHERE client_id = $1`,
        [req.user.id]
      );
    } catch (_) { /* non-fatal */ }

    return res.status(201).json({
      ...safeJob,
      match_count:  matchResult.total    || 0,
      notify_count: matchResult.notified || 0,
    });
  } catch (err) {
    logger.error('Create job error', { userId: req.user?.id, error: err.message });
    res.status(500).json({ error: 'Failed to create job' });
  }
};

// Get all jobs with filters
exports.getJobs = async (req, res) => {
  try {
    const {
      category, city, state, status, q,
      min_budget, max_budget, sort,
    } = req.query;

    const page  = Math.max(1, parseInt(req.query.page)  || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
    const offset = (page - 1) * limit;
    let conditions = [`u.is_active = true`, `j.deleted_at IS NULL`];
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

    const VALID_SORTS = ['', 'budget_high', 'budget_low', 'urgent', 'newest'];
    if (sort && !VALID_SORTS.includes(sort)) {
      return res.status(400).json({ error: `Invalid sort value. Allowed: ${VALID_SORTS.filter(Boolean).join(', ')}` });
    }
    let orderBy = 'j.created_at DESC';
    if (sort === 'budget_high') orderBy = 'j.budget_max DESC NULLS LAST';
    if (sort === 'budget_low') orderBy = 'j.budget_min ASC NULLS LAST';
    if (sort === 'urgent') orderBy = 'j.is_urgent DESC, j.created_at DESC';

    const { rows } = await pool.query(`
      SELECT
        j.id, j.title, j.description, j.category_name, j.status,
        j.budget_type, j.budget_min, j.budget_max, j.is_urgent,
        j.location_city, j.location_state, j.location_approx_lat, j.location_approx_lng,
        j.created_at, j.expires_at, j.bid_count,
        u.first_name || ' ' || u.last_name AS client_name
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
    logger.error('Get jobs error', { error: err.message });
    res.status(500).json({ error: 'Failed to fetch jobs' });
  }
};

// Get single job by ID
exports.getJob = async (req, res) => {
  try {
    const { id } = req.params;

    const { rows } = await pool.query(`
      SELECT
        j.id, j.client_id, j.title, j.description, j.category_name, j.category_id,
        j.budget_type, j.budget_min, j.budget_max, j.urgency, j.is_urgent, j.status,
        j.job_type, j.job_type_label,
        j.location_city, j.location_state, j.location_zip,
        j.location_approx_lat, j.location_approx_lng,
        j.requirements, j.media_urls, j.bid_count, j.assigned_helper_id,
        j.created_at, j.expires_at,
        u.first_name || ' ' || u.last_name AS client_name,
        h.first_name || ' ' || h.last_name AS helper_name
      FROM jobs j
      JOIN users u ON j.client_id = u.id
      LEFT JOIN users h ON j.assigned_helper_id = h.id
      WHERE j.id = $1 AND j.deleted_at IS NULL
    `, [id]);

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Job not found' });
    }

    res.json(rows[0]);
  } catch (err) {
    logger.error('Get job error', { jobId: req.params?.id, error: err.message });
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
    logger.error('Update job error', { jobId: req.params?.id, userId: req.user?.id, error: err.message });
    res.status(500).json({ error: 'Failed to update job' });
  }
};

// Cancel a job (soft)
exports.cancelJob = async (req, res) => {
  try {
    const { id } = req.params;

    // Step 1: Verify job exists and belongs to requester (outside transaction)
    const { rows: jobRows } = await pool.query(
      `SELECT id, client_id, status FROM jobs WHERE id = $1 AND client_id = $2`,
      [id, req.user.id]
    );

    if (!jobRows[0]) {
      return res.status(404).json({ error: 'Job not found or you are not authorized' });
    }

    const job = jobRows[0];

    // Step 2: Verify job is in a cancellable state
    if (!['draft', 'published', 'matched', 'negotiating'].includes(job.status)) {
      return res.status(400).json({
        error: `Job cannot be cancelled in '${job.status}' state. Only draft, published, matched, and negotiating jobs can be cancelled.`
      });
    }

    // Step 3: Check for pending/authorized payments (escrow holds)
    const { rows: paymentRows } = await pool.query(`
      SELECT id FROM payments
      WHERE job_id = $1 AND status IN ('authorized', 'captured')
      AND escrow_status IN ('authorized', 'held', 'disputed')
    `, [id]);

    if (paymentRows.length > 0) {
      return res.status(409).json({
        error: 'Cannot cancel job with pending payments',
        message: 'This job has pending or authorized payments. Cancel or refund the payments before cancelling the job.'
      });
    }

    // Step 4: Atomically cancel job and reject all active bids (transactional)
    const result = await withJobTransaction(pool, async (client) => {
      // Cancel the job with status check to prevent race conditions
      const { rows: updateRows } = await client.query(`
        UPDATE jobs
        SET status = 'cancelled', deleted_at = now(), updated_at = now()
        WHERE id = $1
        AND status IN ('draft','published','matched','negotiating')
        RETURNING *
      `, [id]);

      if (!updateRows.length) {
        throw new Error('Job state changed during cancellation — status is no longer cancellable');
      }

      // Reject all pending/accepted bids
      const { rows: bidRows } = await client.query(`
        UPDATE bids
        SET status = 'rejected', updated_at = now()
        WHERE job_id = $1 AND status IN ('pending', 'accepted')
        RETURNING id, helper_id
      `, [id]);

      return { job: updateRows[0], rejectedBids: bidRows };
    }, 'cancel_job');

    // Step 5: Log the cancellation and rejected bids (outside transaction)
    if (result.rejectedBids.length > 0) {
      logger.info('Job cancelled with bid rejections', {
        jobId: id,
        userId: req.user.id,
        rejectedBidCount: result.rejectedBids.length,
        rejectedHelperIds: result.rejectedBids.map(b => b.helper_id)
      });
    } else {
      logger.info('Job cancelled', { jobId: id, userId: req.user.id });
    }

    res.json({
      message: 'Job cancelled',
      job: result.job,
      rejected_bids: result.rejectedBids.length
    });
  } catch (err) {
    logger.error('Cancel job error', { jobId: req.params?.id, userId: req.user?.id, error: err.message });
    res.status(500).json({ error: 'Failed to cancel job' });
  }
};

// Assign a helper to a job
exports.assignHelper = async (req, res) => {
  try {
    const { job_id, helper_id } = req.body;

    // Validate helper exists and is active (outside transaction for early validation)
    const helperCheck = await pool.query(
      `SELECT id, role, onboarding_completed, deleted_at FROM users WHERE id = $1`,
      [helper_id]
    );
    if (!helperCheck.rows[0] || helperCheck.rows[0].deleted_at) {
      return res.status(404).json({ error: 'Helper not found or inactive' });
    }
    if (!helperCheck.rows[0].onboarding_completed) {
      return res.status(400).json({ error: 'Helper has not completed onboarding' });
    }
    if (!['helper_free', 'helper_pro', 'helper', 'broker'].includes(helperCheck.rows[0].role)) {
      return res.status(400).json({ error: 'User is not a helper' });
    }

    // Check job exists and belongs to requester (outside transaction)
    const jobCheck = await pool.query(
      `SELECT id, client_id, status, assigned_helper_id FROM jobs WHERE id = $1`,
      [job_id]
    );
    if (!jobCheck.rows[0]) {
      return res.status(404).json({ error: 'Job not found' });
    }
    if (jobCheck.rows[0].client_id !== req.user.id) {
      return res.status(403).json({ error: 'Not authorized to assign helpers to this job' });
    }
    if (!['published', 'matched', 'negotiating'].includes(jobCheck.rows[0].status)) {
      return res.status(400).json({ error: 'Job cannot be assigned in its current state' });
    }
    if (jobCheck.rows[0].assigned_helper_id && jobCheck.rows[0].assigned_helper_id !== helper_id) {
      return res.status(400).json({ error: 'Job already has a helper assigned' });
    }

    // Wrap assignment in transaction for atomicity
    const result = await withJobTransaction(pool, async (client) => {
      const { rows } = await client.query(`
        UPDATE jobs SET
          assigned_helper_id = $1,
          status = 'accepted',
          updated_at = now()
        WHERE id = $2 AND client_id = $3
        AND status IN ('published','matched','negotiating')
        AND (assigned_helper_id IS NULL OR assigned_helper_id = $1)
        RETURNING *
      `, [helper_id, job_id, req.user.id]);

      if (!rows.length) {
        throw new Error('Job assignment failed — state changed during processing');
      }
      return rows[0];
    }, 'assign_helper');

    res.json({ message: 'Helper assigned', job: result });
  } catch (err) {
    logger.error('Assign helper error', { jobId: req.body?.job_id, helperId: req.body?.helper_id, userId: req.user?.id, error: err.message });
    res.status(500).json({ error: 'Failed to assign helper' });
  }
};

// Start a job
exports.startJob = async (req, res) => {
  try {
    const { id } = req.params;

    // Pre-check: job must exist, have a helper assigned, be in accepted state
    const { rows: jobRows } = await pool.query(`
      SELECT id, client_id, assigned_helper_id, status, expires_at
      FROM jobs
      WHERE id = $1 AND (client_id = $2 OR assigned_helper_id = $2)
    `, [id, req.user.id]);

    if (!jobRows[0]) {
      return res.status(404).json({ error: 'Job not found or you are not authorized' });
    }

    const job = jobRows[0];

    if (job.status !== 'accepted') {
      return res.status(400).json({ error: `Job cannot be started in '${job.status}' state. Job must be in 'accepted' state.` });
    }

    if (!job.assigned_helper_id) {
      return res.status(400).json({ error: 'Job cannot be started without an assigned helper' });
    }

    if (job.expires_at && new Date(job.expires_at) < new Date()) {
      return res.status(400).json({ error: 'Job has expired and cannot be started' });
    }

    // Wrap state transition in transaction for atomicity
    const result = await withJobTransaction(pool, async (client) => {
      const { rows } = await client.query(`
        UPDATE jobs SET
          status = 'in_progress',
          started_at = now(),
          updated_at = now()
        WHERE id = $1
        AND status = 'accepted'
        AND assigned_helper_id IS NOT NULL
        RETURNING *
      `, [id]);

      if (!rows.length) {
        throw new Error('Job start failed — state changed during processing');
      }
      return rows[0];
    }, 'start_job');

    res.json({ message: 'Job started', job: result });
  } catch (err) {
    logger.error('Start job error', { jobId: req.params?.id, userId: req.user?.id, error: err.message });
    res.status(500).json({ error: 'Failed to start job' });
  }
};

// Complete a job
exports.completeJob = async (req, res) => {
  try {
    const { id } = req.params;

    // First, verify the job exists and user has permission (outside transaction for early validation)
    const { rows: jobRows } = await pool.query(`
      SELECT id, client_id, assigned_helper_id, status, job_type, job_type_label
      FROM jobs
      WHERE id = $1 AND (client_id = $2 OR assigned_helper_id = $2)
      AND status = 'in_progress'
    `, [id, req.user.id]);

    if (jobRows.length === 0) {
      return res.status(404).json({ error: 'Job not found or cannot be completed' });
    }

    const job = jobRows[0];

    // Wrap all state changes in a transaction for atomicity
    const result = await withJobTransaction(pool, async (client) => {
      // Tier-3 escrow: when the customer marks complete, capture authorized funds in the same transaction
      // so helpers get paid without a separate "Capture" step (and we roll back if Stripe fails).
      if (job.client_id === req.user.id && isTier3EscrowJob(job)) {
        const { rows: payRows } = await client.query(
          `SELECT id, amount, stripe_payment_intent_id, stripe_account_id, status
           FROM payments WHERE job_id = $1 AND status = 'authorized' FOR UPDATE`,
          [id],
        );
        if (payRows[0]) {
          const dispute = await client.query(
            `SELECT id FROM disputes WHERE job_id = $1 AND status IN ('open', 'in_progress')`,
            [id],
          );
          if (dispute.rows[0]) {
            const e = new Error('DISPUTE_OPEN');
            e.code = 'DISPUTE_OPEN';
            throw e;
          }
          await captureAuthorizedPaymentWithClient(client, payRows[0]);
        }
      }

      const { rows } = await client.query(`
        UPDATE jobs SET
          status = 'completed',
          completed_at = now(),
          updated_at = now()
        WHERE id = $1 AND status = 'in_progress'
        RETURNING *
      `, [id]);

      if (!rows.length) {
        throw new Error('Job state changed during completion — job is no longer in_progress');
      }

      return rows[0];
    }, 'complete_job');

    res.json({ message: 'Job completed', job: result });
  } catch (err) {
    if (err && err.code === 'DISPUTE_OPEN') {
      return res.status(409).json({
        error: 'Cannot complete job while a payment dispute is open. Resolve the dispute first.',
      });
    }
    logger.error('Complete job error', { jobId: req.params?.id, userId: req.user?.id, error: err.message });
    res.status(500).json({ error: 'Failed to complete job' });
  }
};

// Close a job (after completion, enables reviews)
exports.closeJob = async (req, res) => {
  try {
    const { id } = req.params;

    // First, verify the job exists and user has permission (outside transaction for early validation)
    const { rows: jobRows } = await pool.query(`
      SELECT id, status FROM jobs
      WHERE id = $1 AND (client_id = $2 OR assigned_helper_id = $2)
      AND status = 'completed'
    `, [id, req.user.id]);

    if (jobRows.length === 0) {
      return res.status(404).json({ error: 'Job not found or cannot be closed' });
    }

    // Check for open/in_progress disputes
    const { rows: disputeRows } = await pool.query(`
      SELECT id FROM disputes
      WHERE job_id = $1 AND status IN ('open', 'in_progress')
    `, [id]);

    if (disputeRows.length > 0) {
      return res.status(409).json({
        error: 'Cannot close job while a payment dispute is open. Resolve the dispute first.',
      });
    }

    // Check payment status for tier-3 jobs (must be captured/released)
    const { rows: paymentRows } = await pool.query(`
      SELECT id, status FROM payments
      WHERE job_id = $1 AND status NOT IN ('captured', 'released', 'refunded')
    `, [id]);

    if (paymentRows.length > 0) {
      return res.status(409).json({
        error: 'Cannot close job with pending payments. Please ensure all payments are processed.',
      });
    }

    // Wrap state change in a transaction for atomicity
    const result = await withJobTransaction(pool, async (client) => {
      const { rows } = await client.query(`
        UPDATE jobs SET status = 'closed', updated_at = now()
        WHERE id = $1 AND status = 'completed'
        RETURNING *
      `, [id]);
      if (!rows.length) {
        throw new Error('Job state changed during closing — job is no longer completed');
      }
      return rows[0];
    }, 'close_job');

    res.json({ message: 'Job closed', job: result });
  } catch (err) {
    logger.error('Close job error', { jobId: req.params?.id, userId: req.user?.id, error: err.message });
    res.status(500).json({ error: 'Failed to close job' });
  }
};

// Get jobs posted by current user
exports.getMyJobs = async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        id, client_id, title, description,
        category_id, category_name,
        budget_type, budget_min, budget_max,
        urgency, is_urgent, status,
        site_access, job_type_label, notes,
        location_address, location_city, location_state, location_zip,
        location_approx_lat, location_approx_lng,
        requirements, media_urls,
        assigned_helper_id, preferred_helper_id, preferred_helper_name,
        scheduled_date, scheduled_time, recurrence,
        private_notes,
        expires_at, created_at, updated_at
      FROM jobs
      WHERE client_id = $1
      ORDER BY created_at DESC
    `, [req.user.id]);

    res.json(rows);
  } catch (err) {
    logger.error('Get my jobs error', { userId: req.user?.id, error: err.message });
    res.status(500).json({ error: 'Failed to fetch your jobs' });
  }
};
