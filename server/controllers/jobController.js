const pool = require('../db');
const { scoreAndMatch } = require('../services/matchService');
const { uploadFile, getPublicUrl } = require('../utils/storage');
const logger = require('../utils/logger');
const { fuzzCoords } = require('../models/jobModel');
const { withTransaction, withJobTransaction } = require('../utils/transaction');
const { captureAuthorizedPaymentWithClient } = require('../services/paymentCaptureService');
const { AppError } = require('../middleware/errorHandler');

function isTier3EscrowJob(jobRow) {
  const label = String(jobRow?.job_type_label || '').toLowerCase();
  const jt = String(jobRow?.job_type || '').toLowerCase();
  return label.includes('tier3') || label.includes('escrow') || jt.includes('tier3') || jt.includes('escrow');
}

// Create a new job (wizard publish)
exports.createJob = async (req, res, next) => {
  try {
    const {
      title, description,
      category_id, category_name, category,
      budget_type, budget_min, budget_max,
      urgency, site_access, job_type_label, notes,
      location_address, location_city, location_state, location_zip, location_country,
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

    // Multipart (FormData) sends JSON fields as strings
    let parsedRequiredSkills = required_skills;
    if (typeof parsedRequiredSkills === 'string' && parsedRequiredSkills.trim()) {
      try {
        parsedRequiredSkills = JSON.parse(parsedRequiredSkills);
      } catch {
        parsedRequiredSkills = [];
      }
    }
    let parsedRequirements = requirements;
    if (typeof parsedRequirements === 'string' && parsedRequirements.trim()) {
      try {
        parsedRequirements = JSON.parse(parsedRequirements);
      } catch {
        parsedRequirements = [];
      }
    }

    // ── Validate required fields ────────────────────────────────────────────────────────────────────
    const errs = {};
    if (!title || title.trim().length < 10)       errs.title       = 'Title must be at least 10 characters';
    if (!description || description.trim().length < 50) errs.description = 'Description must be at least 50 characters';
    if (!location_city)                            errs.location    = 'City is required';
    if (!location_country)                         errs.location_country = 'Country is required';
    if (Object.keys(errs).length) {
      throw new AppError('Validation failed', 400, 'validation_failed', errs);
    }

    // ── Resolve category ──────────────────────────────────────────────────────────────────────────
    const finalCategoryId   = category_id   || null;
    const finalCategoryName = category_name || category || null;

    // ── Resolve media - upload files to S3 ─────────────────────────────────────────────────────
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
      try {
        mediaArr = typeof media_urls === 'string'
          ? JSON.parse(media_urls)
          : (Array.isArray(media_urls) ? media_urls : []);
      } catch {
        mediaArr = [];
      }
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
    if (parsedRequirements) {
      reqJson = typeof parsedRequirements === 'string'
        ? parsedRequirements
        : JSON.stringify(parsedRequirements);
    }

    // ── Process required skills ────────────────────────────────────────────────────────────────────────
    let skillsJson = '[]';
    let skillIds = '{}';
    if (parsedRequiredSkills && Array.isArray(parsedRequiredSkills) && parsedRequiredSkills.length > 0) {
      // Validate skill count
      if (parsedRequiredSkills.length > 20) {
        throw new AppError('Validation failed', 400, 'validation_failed', {
          required_skills: 'Maximum 20 skills allowed'
        });
      }
      const numericIds = parsedRequiredSkills
        .map((s) => s && (s.id ?? s.skill_id))
        .filter((id) => id !== undefined && id !== null && String(id).trim() !== '' && Number.isFinite(Number(id)));
      // Extract IDs for efficient filtering and store full objects (INT[] must be integers only)
      skillIds = numericIds.length ? `{${numericIds.map((id) => Math.trunc(Number(id))).join(',')}}` : '{}';
      skillsJson = JSON.stringify(parsedRequiredSkills);
    }

    // ── Build location_point expression ─────────────────────────────────────────────────────────────
    const hasGeo = location_lat && location_lng;

    // ── Combine scheduled_date + scheduled_time into a TIMESTAMPTZ ────────────────────────────────────
    // Form sends scheduled_date as "2026-05-15" and scheduled_time as "10:51"
    // Database expects scheduled_time as TIMESTAMPTZ, so combine them
    let scheduledTimestamp = null;
    if (scheduled_date && scheduled_time) {
      // scheduled_time is in HH:MM format; combine with date into ISO-like string
      scheduledTimestamp = `${scheduled_date}T${scheduled_time}:00+00:00`;
    }

    const { rows } = await pool.query(
      `INSERT INTO jobs (
          client_id, title, description,
          category_id, category_name,
          budget_type, budget_min, budget_max,
          urgency, is_urgent,
          site_access, job_type_label, notes,
          location_address, location_city, location_state, location_zip, location_country,
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
          $11,$12,$13,$14,$15,$16,$17,$18,
          $19,$20,
          ${hasGeo ? `ST_SetSRID(ST_MakePoint($20::float,$19::float),4326)::geography` : 'NULL'},
          $21,$22,$23,$24,$25,
          $26,$27,$28,$29,$30,$31,$32,
          'published', now() + interval '30 days'
       )
       RETURNING *`,
      [
        req.user.id, title.trim(), description.trim(),
        finalCategoryId, finalCategoryName,
        resolvedBudgetType, resolvedBudgetMin, resolvedBudgetMax,
        urgency || 'flexible', isUrgent,
        site_access || 'easy', job_type_label || job_type || 'one_time', notes || null,
        location_address || null, location_city, location_state || null, location_zip || null, location_country || null,
        location_lat  || null, location_lng || null,
        approx.lat, approx.lng,
        reqJson, mediaArr,
        skillsJson, skillIds,
        scheduled_date || null, scheduledTimestamp || null, recurrence || 'none',
        preferred_helper_id || null, preferred_helper_name || null,
        private_notes || null,
      ]
    );

    // Strip exact GPS coordinates from the response - helpers see only fuzzy coords
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
    // Log full error details for debugging job creation failures
    logger.error('[createJob] Error inserting job', {
      userId: req.user?.id,
      error: err.message,
      code: err.code,
      detail: err.detail,
      hint: err.hint,
      stack: err.stack,
      formData: {
        title: req.body?.title?.substring(0, 50),
        category: req.body?.category_name,
        location: req.body?.location_city,
      }
    });
    next(err);
  }
};

// Get all jobs with filters
exports.getJobs = async (req, res, next) => {
  try {
    const {
      category, city, state, country, status, q,
      min_budget, max_budget, sort,
      lat, lng, radius,
    } = req.query;

    // ── Geolocation / radius filtering ──────────────────────────────────────────
    // When the client sends lat + lng we perform a PostGIS radius search using
    // the stored location_point geography column. radius is in miles (default 25,
    // capped at 100). Text-based city/state filters are still applied on top when
    // provided alongside coordinates.
    const userLat    = lat  ? parseFloat(lat)  : null;
    const userLng    = lng  ? parseFloat(lng)  : null;
    const radiusMi   = Math.min(100, Math.max(1, parseFloat(radius) || 25));
    const radiusM    = radiusMi * 1609.344; // convert miles → metres for ST_DWithin
    const hasGeoFilter = userLat !== null && userLng !== null
      && !Number.isNaN(userLat) && !Number.isNaN(userLng);

    const page  = Math.max(1, parseInt(req.query.page)  || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
    const offset = (page - 1) * limit;
    let conditions = [`u.is_active = true`, `j.deleted_at IS NULL`];
    let params = [];
    let paramIdx = 1;

    // Radius condition — only matches jobs that have been geocoded (location_point
    // IS NOT NULL). Jobs without coordinates fall through to city/state text match.
    if (hasGeoFilter) {
      conditions.push(
        `(j.location_point IS NOT NULL AND ST_DWithin(j.location_point, ST_SetSRID(ST_MakePoint($${paramIdx}::float, $${paramIdx + 1}::float), 4326)::geography, $${paramIdx + 2}::float))`
      );
      params.push(userLng, userLat, radiusM);
      paramIdx += 3;
    }

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
      conditions.push(`j.location_state ILIKE $${paramIdx++}`);
      params.push(`%${state}%`);
    }
    if (country) {
      conditions.push(`j.location_country ILIKE $${paramIdx++}`);
      params.push(`%${country}%`);
    }
    // Valid job statuses (must match values written by jobController state transitions).
    // 'pending' is NOT a real status — removed to prevent silent empty-result filters.
    const VALID_JOB_STATUSES = ['draft', 'published', 'matched', 'negotiating', 'accepted', 'in_progress', 'completed', 'cancelled', 'closed'];
    if (status && VALID_JOB_STATUSES.includes(status)) {
      conditions.push(`j.status = $${paramIdx++}`);
      params.push(status);
    } else {
      // Show both 'published' and 'matched' jobs on the public board.
      // 'matched' jobs have at least one bid but are still open for competing bids
      // until the customer explicitly accepts one via assignHelper().
      conditions.push(`j.status IN ('published', 'matched')`);
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

    const VALID_SORTS = ['', 'budget_high', 'budget_low', 'urgent', 'newest', 'nearest'];
    if (sort && !VALID_SORTS.includes(sort)) {
      return res.status(400).json({ error: `Invalid sort value. Allowed: ${VALID_SORTS.filter(Boolean).join(', ')}` });
    }
    let orderBy = 'j.created_at DESC';
    if (sort === 'budget_high') orderBy = 'j.budget_max DESC NULLS LAST';
    if (sort === 'budget_low')  orderBy = 'j.budget_min ASC NULLS LAST';
    if (sort === 'urgent')      orderBy = 'j.is_urgent DESC, j.created_at DESC';
    // 'nearest' requires geo params; fall back to newest if coords missing
    if (sort === 'nearest' && hasGeoFilter) orderBy = 'distance_miles ASC NULLS LAST, j.created_at DESC';
    if (sort === 'nearest' && !hasGeoFilter) orderBy = 'j.created_at DESC';

    // Build the distance expression — only computed when we have coords so we
    // don't divide by zero or waste cycles on every normal request.
    const distanceSelect = hasGeoFilter
      ? `, ROUND((ST_Distance(j.location_point, ST_SetSRID(ST_MakePoint($${paramIdx}::float, $${paramIdx + 1}::float), 4326)::geography) / 1609.344)::numeric, 1) AS distance_miles`
      : `, NULL::numeric AS distance_miles`;

    // When geolocation is active, push two extra params (userLng, userLat) for the
    // ST_Distance() call in the SELECT. These are appended AFTER the WHERE params so
    // the count query can reuse `params` unchanged (no distance column there).
    //
    // Param layout (hasGeoFilter = true):
    //   $1 … $(paramIdx-1)  ← WHERE clause params
    //   $paramIdx           ← userLng  (distance SELECT)
    //   $(paramIdx+1)       ← userLat  (distance SELECT)
    //   $(paramIdx+2)       ← limit
    //   $(paramIdx+3)       ← offset
    //
    // Param layout (hasGeoFilter = false):
    //   $1 … $(paramIdx-1)  ← WHERE clause params
    //   $paramIdx           ← limit
    //   $(paramIdx+1)       ← offset
    const selectParams = hasGeoFilter ? [...params, userLng, userLat] : params;
    // "next available index after distance SELECT params" — used for LIMIT/OFFSET
    const limitParamIdx = hasGeoFilter ? paramIdx + 2 : paramIdx;

    const { rows } = await pool.query(`
      SELECT
        j.id, j.title, j.description, j.category_name, j.status,
        j.budget_type, j.budget_min, j.budget_max, j.is_urgent,
        j.location_city, j.location_state, j.location_zip, j.location_country,
        j.location_approx_lat, j.location_approx_lng,
        j.created_at, j.expires_at, j.bid_count,
        u.first_name || ' ' || u.last_name AS client_name
        ${distanceSelect}
      FROM jobs j
      JOIN users u ON j.client_id = u.id
      ${whereClause}
      ORDER BY ${orderBy}
      LIMIT $${limitParamIdx} OFFSET $${limitParamIdx + 1}
    `, [...selectParams, limit, offset]);

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
    next(new AppError('Failed to fetch jobs', 500, 'fetch_jobs_failed'));
  }
};

// Get single job by ID
exports.getJob = async (req, res, next) => {
  try {
    const { id } = req.params;

    const { rows } = await pool.query(`
      SELECT
        j.id, j.client_id, j.title, j.description, j.category_name, j.category_id,
        j.budget_type, j.budget_min, j.budget_max, j.urgency, j.is_urgent, j.status,
        j.job_type, j.job_type_label,
        j.location_address, j.location_city, j.location_state, j.location_zip, j.location_country,
        j.location_approx_lat, j.location_approx_lng,
        j.scheduled_date, j.scheduled_time, j.recurrence,
        j.requirements, j.media_urls, j.bid_count, j.assigned_helper_id,
        j.preferred_helper_id, j.preferred_helper_name,
        j.created_at, j.updated_at, j.expires_at,
        j.started_at, j.completed_at, j.cancelled_at, j.cancellation_reason,
        j.escrow_status,
        u.first_name || ' ' || u.last_name AS client_name,
        h.first_name || ' ' || h.last_name AS helper_name
      FROM jobs j
      JOIN users u ON j.client_id = u.id
      LEFT JOIN users h ON j.assigned_helper_id = h.id
      WHERE j.id = $1 AND j.deleted_at IS NULL
    `, [id]);

    if (rows.length === 0) {
      throw new AppError('Job not found', 404, 'job_not_found');
    }

    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
};

// Update a job (only by the client who created it)
exports.updateJob = async (req, res, next) => {
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
      WHERE id = $11 AND client_id = $12 AND status IN ('draft','published','matched')
      RETURNING *
    `, [
      title, description, finalCategoryName,
      budget_min, budget_max,
      location_city, location_state, location_zip,
      priority === 'urgent' ? true : (priority === 'normal' ? false : null), scheduled_date || null,
      id, req.user.id
    ]);

    if (rows.length === 0) {
      throw new AppError('Job not found or cannot be edited', 404, 'job_not_found');
    }

    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
};


// Assign a helper to a job by accepting a specific bid
exports.assignHelper = async (req, res, next) => {
  try {
    // bid_id is always required.
    // scheduled_start / scheduled_end are optional ISO strings provided by the
    // BidAcceptanceModal when the customer picks an exact time slot.
    // payment_method is required: 'oxsteed' or 'off_platform'
    const { bid_id, scheduled_start, scheduled_end, payment_method } = req.body;

    if (!bid_id) {
      throw new AppError('bid_id is required', 400, 'missing_field', {
        bid_id: 'bid_id is required'
      });
    }

    if (!payment_method || !['oxsteed', 'off_platform'].includes(payment_method)) {
      throw new AppError('payment_method must be oxsteed or off_platform', 400, 'invalid_payment_method', {
        payment_method: 'Must be oxsteed or off_platform'
      });
    }

    // Validate customer-chosen times if provided
    const customerStart = scheduled_start ? new Date(scheduled_start) : null;
    const customerEnd   = scheduled_end   ? new Date(scheduled_end)   : null;
    if ((customerStart && isNaN(customerStart.getTime())) ||
        (customerEnd   && isNaN(customerEnd.getTime()))) {
      throw new AppError('Invalid scheduled_start or scheduled_end', 400, 'validation_failed', {
        scheduled_start: 'Must be a valid ISO timestamp',
      });
    }
    if (customerStart && customerEnd && customerEnd <= customerStart) {
      throw new AppError('scheduled_end must be after scheduled_start', 400, 'validation_failed', {
        scheduled_end: 'Must be after scheduled_start',
      });
    }

    const result = await withTransaction(pool, async (client) => {
      // 1. Look up the bid and verify it belongs to a job owned by the requester.
      //    Fetch scheduling / location fields now so we can create the calendar
      //    appointment in the same transaction (no second round-trip needed).
      const bidLookup = await client.query(
        `SELECT b.id, b.job_id, b.helper_id, b.status, b.eta_hours,
                j.client_id, j.status AS job_status,
                j.title,
                j.scheduled_date, j.scheduled_time,
                j.location_address, j.location_city, j.location_state
         FROM bids b
         JOIN jobs j ON j.id = b.job_id
         WHERE b.id = $1`,
        [bid_id]
      );

      if (bidLookup.rows.length === 0) {
        throw new AppError('Bid not found', 404, 'bid_not_found');
      }

      const bid = bidLookup.rows[0];

      if (bid.client_id !== req.user.id) {
        throw new AppError('Not authorized to accept bids on this job', 403, 'forbidden');
      }

      if (!['published', 'matched', 'negotiating'].includes(bid.job_status)) {
        throw new AppError('Job is not in a state that allows bid acceptance', 409, 'invalid_job_state');
      }

      // 2. Accept the bid atomically - only succeeds if it is still pending
      const acceptResult = await client.query(
        `UPDATE bids SET status = 'accepted', updated_at = NOW()
         WHERE id = $1 AND status = 'pending'
         RETURNING *`,
        [bid_id]
      );

      if (acceptResult.rows.length === 0) {
        throw new AppError('Bid is no longer pending. It may have been withdrawn or already accepted.', 409, 'bid_no_longer_pending');
      }

      const acceptedBid = acceptResult.rows[0];

      // 2a. Validate and set payment method + cancellation policy
      // Fetch helper's cancellation policies
      const helperPoliciesResult = await client.query(
        `SELECT * FROM helper_cancellation_policies WHERE helper_id = $1`,
        [bid.helper_id]
      );

      let helperPolicies = helperPoliciesResult.rows[0];

      // If helper has no policies, create defaults (oxsteed_enabled = true)
      if (!helperPolicies) {
        const insertResult = await client.query(
          `INSERT INTO helper_cancellation_policies (helper_id, oxsteed_enabled, custom_enabled, custom_policy)
           VALUES ($1, TRUE, FALSE, '{}')
           RETURNING *`,
          [bid.helper_id]
        );
        helperPolicies = insertResult.rows[0];
      }

      // Validate that the selected payment method is enabled
      if (payment_method === 'oxsteed' && !helperPolicies.oxsteed_enabled) {
        throw new AppError('Helper does not accept OxSteed payments', 400, 'payment_method_not_enabled');
      }

      if (payment_method === 'off_platform' && !helperPolicies.custom_enabled) {
        throw new AppError('Helper does not accept off-platform payments', 400, 'payment_method_not_enabled');
      }

      // Build cancellation policy based on payment method
      let cancellationPolicy = {};

      if (payment_method === 'oxsteed') {
        const feeCap = Math.min(Math.round(acceptedBid.amount * 0.1), 10000); // $100 max, in cents
        cancellationPolicy = {
          type: 'oxsteed',
          fee_cap_cents: feeCap,
          timing_rules: {
            '3plus_days_before': 0,
            '24h_to_3days_before': Math.round(feeCap * 0.5),
            'less_than_24h': feeCap
          }
        };
      } else {
        // off_platform
        cancellationPolicy = {
          type: 'custom',
          custom_policy: helperPolicies.custom_policy || {}
        };
      }

      // Update bid with payment method and cancellation policy
      await client.query(
        `UPDATE bids SET
          payment_method = $1,
          cancellation_policy = $2,
          updated_at = NOW()
         WHERE id = $3`,
        [payment_method, JSON.stringify(cancellationPolicy), bid_id]
      );

      // 3. Reject all other pending bids for this job
      await client.query(
        `UPDATE bids SET status = 'rejected', updated_at = NOW()
         WHERE job_id = $1 AND id != $2 AND status = 'pending'`,
        [bid.job_id, bid_id]
      );

      // 4. Update the job: assign the helper and move to accepted status
      const jobResult = await client.query(
        `UPDATE jobs SET
           assigned_helper_id = $1,
           status = 'accepted',
           updated_at = NOW()
         WHERE id = $2 AND client_id = $3
         AND status IN ('published', 'matched', 'negotiating')
         RETURNING *`,
        [bid.helper_id, bid.job_id, req.user.id]
      );

      if (jobResult.rows.length === 0) {
        throw new AppError('Job not found or cannot be assigned', 409, 'state_conflict');
      }

      // 5. Auto-create a calendar appointment for the accepted job.
      //    Uses ON CONFLICT DO NOTHING (via idx_appointments_job_unique) so
      //    retrying assignHelper never produces duplicate calendar events.
      //
      //    Scheduled time logic:
      //      • If the job has a scheduled_date, combine it with scheduled_time
      //        (or default 09:00) to get the appointment start.
      //      • Otherwise use NOW() + 7 days at 09:00 as a placeholder; the
      //        helper can reschedule from the calendar once they discuss timing.
      //
      //    Duration: bid.eta_hours → minutes (clamped to 15–480).
      try {
        const jobRow = { ...bid, ...bidLookup.rows[0] };

        let apptStart, apptEnd;

        // Helper to clamp ETA → minutes (15…480) for appointment duration
        const etaToMinutes = (h) => {
          const n = parseFloat(h) || 1;
          return Math.min(480, Math.max(15, Math.round(n * 60)));
        };

        if (customerStart) {
          // Customer picked an exact slot via BidAcceptanceModal — use it directly.
          apptStart = customerStart;
          apptEnd   = customerEnd || new Date(customerStart.getTime() + 60 * 60_000);
        } else if (jobRow.scheduled_time) {
          // Preferred: jobs.scheduled_time is a TIMESTAMPTZ stored at UTC by
          // createJob() — pg returns it as a Date in absolute time, so we can
          // use it directly without timezone math.
          apptStart = jobRow.scheduled_time instanceof Date
            ? jobRow.scheduled_time
            : new Date(jobRow.scheduled_time);
          apptEnd = new Date(apptStart.getTime() + etaToMinutes(acceptedBid.eta_hours) * 60_000);
        } else if (jobRow.scheduled_date) {
          // Legacy: date-only column. Anchor to 09:00 UTC instead of server-local
          // time (which differs between dev and prod containers).
          const datePart =
            jobRow.scheduled_date instanceof Date
              ? jobRow.scheduled_date.toISOString().split('T')[0]
              : String(jobRow.scheduled_date).split('T')[0];
          apptStart = new Date(`${datePart}T09:00:00.000Z`);
          apptEnd = new Date(apptStart.getTime() + etaToMinutes(acceptedBid.eta_hours) * 60_000);
        } else {
          // No schedule on the job — default to a week from now at 09:00 UTC.
          apptStart = new Date();
          apptStart.setUTCDate(apptStart.getUTCDate() + 7);
          apptStart.setUTCHours(9, 0, 0, 0);
          apptEnd = new Date(apptStart.getTime() + etaToMinutes(acceptedBid.eta_hours) * 60_000);
        }

        const durationMinutes = Math.round((apptEnd - apptStart) / 60_000);

        const locationAddress =
          jobRow.location_address ||
          [jobRow.location_city, jobRow.location_state].filter(Boolean).join(', ') ||
          null;

        await client.query(
          `INSERT INTO appointments (
              customer_id, helper_id, job_id,
              service_description,
              scheduled_start_time, scheduled_end_time,
              estimated_duration_minutes,
              location_address,
              status, source, created_by_user_id
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'confirmed', 'job', $1)
           ON CONFLICT (job_id) WHERE job_id IS NOT NULL DO NOTHING`,
          [
            bid.client_id,       // customer_id / created_by
            bid.helper_id,
            bid.job_id,
            jobRow.title,
            apptStart,
            apptEnd,
            durationMinutes,
            locationAddress,
          ]
        );
      } catch (apptErr) {
        // Non-fatal: log but never let appointment creation break bid acceptance
        logger.warn('Failed to auto-create calendar appointment for accepted job', {
          jobId: bid.job_id,
          helperId: bid.helper_id,
          error: apptErr?.message,
        });
      }

      return { job: jobResult.rows[0], bid: acceptedBid };
    }, 'assign_helper');

    res.status(200).json({ message: 'Bid accepted and helper assigned', job: result.job, bid: result.bid });
  } catch (err) {
    next(err);
  }
};

// Start a job
exports.startJob = async (req, res, next) => {
  try {
    const { id } = req.params;

    // Pre-check: job must exist, have a helper assigned, be in accepted state
    const { rows: jobRows } = await pool.query(`
      SELECT id, client_id, assigned_helper_id, status, expires_at
      FROM jobs
      WHERE id = $1 AND (client_id = $2 OR assigned_helper_id = $2)
    `, [id, req.user.id]);

    if (!jobRows[0]) {
      throw new AppError('Job not found or you are not authorized', 404, 'job_not_found');
    }

    const job = jobRows[0];

    if (job.status !== 'accepted') {
      throw new AppError(
        `Job cannot be started in '${job.status}' state. Job must be in 'accepted' state.`,
        400,
        'invalid_job_state'
      );
    }

    if (!job.assigned_helper_id) {
      throw new AppError('Job cannot be started without an assigned helper', 400, 'no_helper_assigned');
    }

    if (job.expires_at && new Date(job.expires_at) < new Date()) {
      throw new AppError('Job has expired and cannot be started', 400, 'job_expired');
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
        throw new AppError('Job start failed - state changed during processing', 400, 'state_conflict');
      }

      // Keep the calendar appointment in sync: confirmed → in_progress
      await client.query(
        `UPDATE appointments
            SET status = 'in_progress', updated_at = now()
          WHERE job_id = $1
            AND status IN ('confirmed', 'requested')`,
        [id]
      );

      return rows[0];
    }, 'start_job');

    res.json({ message: 'Job started', job: result });
  } catch (err) {
    next(err);
  }
};

// Complete a job
exports.completeJob = async (req, res, next) => {
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
      throw new AppError('Job not found or cannot be completed', 404, 'job_not_found');
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
            const err = new AppError(
              'Cannot complete job while a payment dispute is open. Resolve the dispute first.',
              409,
              'dispute_open'
            );
            throw err;
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
        throw new AppError('Job state changed during completion', 409, 'state_conflict');
      }

      // Keep the calendar appointment in sync: → completed
      await client.query(
        `UPDATE appointments
            SET status = 'completed', updated_at = now()
          WHERE job_id = $1
            AND status NOT IN ('completed', 'cancelled')`,
        [id]
      );

      return rows[0];
    }, 'complete_job');

    res.json({ message: 'Job completed', job: result });
  } catch (err) {
    next(err);
  }
};

// Close a job (after completion, enables reviews)
exports.closeJob = async (req, res, next) => {
  try {
    const { id } = req.params;

    // First, verify the job exists and user has permission (outside transaction for early validation)
    const { rows: jobRows } = await pool.query(`
      SELECT id, status FROM jobs
      WHERE id = $1 AND (client_id = $2 OR assigned_helper_id = $2)
      AND status = 'completed'
    `, [id, req.user.id]);

    if (jobRows.length === 0) {
      throw new AppError('Job not found or cannot be closed', 404, 'job_not_found');
    }

    // Check for open/in_progress disputes
    const { rows: disputeRows } = await pool.query(`
      SELECT id FROM disputes
      WHERE job_id = $1 AND status IN ('open', 'in_progress')
    `, [id]);

    if (disputeRows.length > 0) {
      throw new AppError(
        'Cannot close job while a payment dispute is open. Resolve the dispute first.',
        409, 'dispute_open'
      );
    }

    // Check payment status for tier-3 jobs (must be captured/released)
    const { rows: paymentRows } = await pool.query(`
      SELECT id, status FROM payments
      WHERE job_id = $1 AND status NOT IN ('captured', 'released', 'refunded')
    `, [id]);

    if (paymentRows.length > 0) {
      throw new AppError(
        'Cannot close job with pending payments. Please ensure all payments are processed.',
        409, 'pending_payments'
      );
    }

    // Wrap state change in a transaction for atomicity
    const result = await withJobTransaction(pool, async (client) => {
      const { rows } = await client.query(`
        UPDATE jobs SET status = 'closed', updated_at = now()
        WHERE id = $1 AND status = 'completed'
        RETURNING *
      `, [id]);
      if (!rows.length) {
        throw new AppError('Job state changed during closing - job is no longer completed', 409, 'state_conflict');
      }
      return rows[0];
    }, 'close_job');

    res.json({ message: 'Job closed', job: result });
  } catch (err) {
    if (err instanceof AppError) return next(err);
    logger.error('Close job error', { jobId: req.params?.id, userId: req.user?.id, error: err.message });
    next(new AppError('Failed to close job', 500, 'close_job_failed'));
  }
};

// Get jobs posted by current user (paginated, filterable by status)
exports.getMyJobs = async (req, res, next) => {
  try {
    const { status, include_deleted } = req.query;
    const VALID_JOB_STATUSES = ['draft', 'published', 'matched', 'negotiating', 'accepted', 'in_progress', 'completed', 'cancelled', 'closed'];
    if (status && !VALID_JOB_STATUSES.includes(status)) {
      throw new AppError('Invalid job status', 400, 'validation_failed', {
        status: `status must be one of ${VALID_JOB_STATUSES.join(', ')}`,
      });
    }

    const limit  = Math.min(100, Math.max(1, parseInt(req.query.limit, 10)  || 50));
    const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);

    const params = [req.user.id];
    // By default exclude soft-deleted (cancelled-pre-acceptance) jobs from the
    // dashboard list so customers don't see ghost rows. Pass ?include_deleted=1
    // for archive views.
    let where = 'WHERE client_id = $1';
    if (!include_deleted) where += ' AND deleted_at IS NULL';
    if (status) {
      params.push(status);
      where += ` AND status = $${params.length}`;
    }
    params.push(limit, offset);

    const { rows } = await pool.query(`
      SELECT
        id, client_id, title, description,
        category_id, category_name,
        budget_type, budget_min, budget_max,
        urgency, is_urgent, status,
        site_access, job_type_label, notes,
        location_address, location_city, location_state, location_zip, location_country,
        location_approx_lat, location_approx_lng,
        requirements, media_urls, bid_count,
        assigned_helper_id, preferred_helper_id, preferred_helper_name,
        scheduled_date, scheduled_time, recurrence,
        private_notes,
        started_at, completed_at, cancelled_at, cancellation_reason,
        expires_at, created_at, updated_at
      FROM jobs
      ${where}
      ORDER BY created_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}
    `, params);

    res.json(rows);
  } catch (err) {
    next(err);
  }
};

/**
 * Cancel a job (by customer or helper) — unified handler for all cancellable states.
 * POST /api/jobs/:id/cancel
 *
 * Pre-acceptance (draft/published/matched/negotiating):
 *   - Customer only; no fee; rejects all bids; frees calendar.
 * Post-acceptance (accepted/in_progress):
 *   - Customer or helper; calculates timing-based cancellation fee for OxSteed jobs.
 */
exports.cancelJob = async (req, res, next) => {
  try {
    const { id: jobId } = req.params;   // route is /:id
    const { reason } = req.body;
    const userId = req.user.id;

    // Start transaction to ensure atomicity
    await withJobTransaction(
      pool,
      async (client) => {
        // 1. Get the job
        const jobResult = await client.query(
          `SELECT * FROM jobs WHERE id = $1`,
          [jobId]
        );

        if (jobResult.rows.length === 0) {
          throw new AppError('Job not found', 404);
        }

        const job = jobResult.rows[0];

        // 2. Check authorization (must be customer OR helper)
        const isCustomer = job.client_id === userId;
        const isHelper = job.assigned_helper_id === userId;

        if (!isCustomer && !isHelper) {
          throw new AppError('Not authorized to cancel this job', 403);
        }

        // 3a. Pre-acceptance cancellation — no fee, customer only
        if (['draft', 'published', 'matched', 'negotiating'].includes(job.status)) {
          if (!isCustomer) {
            throw new AppError('Only the customer can cancel a job before a helper is assigned', 403);
          }

          // Block if there are live escrow holds
          const { rows: payRows } = await client.query(`
            SELECT id FROM payments
            WHERE job_id = $1 AND status IN ('authorized','captured')
              AND escrow_status IN ('authorized','held','disputed')
          `, [jobId]);
          if (payRows.length > 0) {
            throw new AppError(
              'Cannot cancel job with pending payments. Refund the payment first.',
              409, 'pending_payments'
            );
          }

          const { rows: updated } = await client.query(`
            UPDATE jobs SET status = 'cancelled', deleted_at = now(), updated_at = now()
            WHERE id = $1 AND status IN ('draft','published','matched','negotiating')
            RETURNING *
          `, [jobId]);
          if (!updated.length) throw new AppError('Job state changed during cancellation', 409, 'state_conflict');

          const { rows: rejectedBids } = await client.query(`
            UPDATE bids SET status = 'rejected', updated_at = now()
            WHERE job_id = $1 AND status IN ('pending','accepted')
            RETURNING id, helper_id
          `, [jobId]);

          await client.query(`
            UPDATE appointments
               SET status = 'cancelled', cancelled_by = 'customer',
                   cancelled_at = now(), updated_at = now()
             WHERE job_id = $1 AND status NOT IN ('completed','cancelled')
          `, [jobId]);

          logger.info('Job cancelled (pre-acceptance)', {
            jobId, userId, status: job.status, rejectedBids: rejectedBids.length
          });
          return { type: 'pre_acceptance', job: updated[0], rejectedBids };
        }

        // 3b. Post-acceptance states only beyond this point
        if (!['accepted', 'in_progress'].includes(job.status)) {
          throw new AppError('Job cannot be cancelled in current state', 409);
        }

        // 4. Get the accepted bid
        const bidResult = await client.query(
          `SELECT * FROM bids WHERE job_id = $1 AND status = $2`,
          [jobId, 'accepted']
        );

        if (bidResult.rows.length === 0) {
          throw new AppError('No accepted bid found', 409);
        }

        const bid = bidResult.rows[0];
        const paymentMethod = bid.payment_method;
        const cancellationPolicy = bid.cancellation_policy || {};

        // 5. Calculate cancellation fee (only if OxSteed payment)
        // Uses timing-based tiers: 0% (3+ days), 50% (24h-3d), 100% (<24h)
        let feeToPay = 0;
        let feeToPlatform = 0;
        let feeToHelper = 0;
        let feePercentage = 0;

        if (isCustomer && paymentMethod === 'oxsteed') {
          // Calculate hours until scheduled start
          const hoursBeforeStart = job.scheduled_date
            ? (new Date(job.scheduled_date) - Date.now()) / (1000 * 60 * 60)
            : null;

          // Determine fee tier based on timing
          // Fee cap = 10% of bid amount, capped at $100
          const feeCap = Math.min(Math.round(bid.amount * 0.1), 10000);

          if (hoursBeforeStart === null || hoursBeforeStart >= 72) {
            // 3+ days before: no fee
            feePercentage = 0;
          } else if (hoursBeforeStart >= 24) {
            // 24h to 3 days before: 50% of cap
            feePercentage = 50;
          } else if (hoursBeforeStart > 0) {
            // Less than 24h before: 100% of cap
            feePercentage = 100;
          } else {
            // Already past scheduled start: 100% of cap (job already in progress or late cancellation)
            feePercentage = 100;
          }

          // Calculate actual fee from percentage
          feeToPay = Math.round((feeCap * feePercentage) / 100);

          if (feeToPay > 0) {
            // Split the fee: Platform 7.1%, Stripe ~2.2%, helper gets remainder
            feeToPlatform = Math.round(feeToPay * 0.071);
            const stripeFee = Math.round(feeToPay * 0.022);
            feeToHelper = feeToPay - feeToPlatform - stripeFee;
          }

          logger.info('Cancellation fee calculated', {
            jobId,
            hoursBeforeStart: hoursBeforeStart?.toFixed(1),
            feePercentage,
            feeCap,
            feeToPay,
            feeToHelper,
            feeToPlatform
          });
        }

        // 6. Update job status to cancelled
        await client.query(
          `UPDATE jobs SET
            status = 'cancelled',
            cancelled_at = NOW(),
            cancellation_reason = $1,
            updated_at = NOW()
           WHERE id = $2`,
          [reason || null, jobId]
        );

        // 7. Update bid with fee information
        if (paymentMethod === 'oxsteed' && feeToPay > 0) {
          await client.query(
            `UPDATE bids SET
              cancellation_fee_cents = $1,
              cancellation_fee_paid = FALSE,
              updated_at = NOW()
             WHERE id = $2`,
            [feeToPay, bid.id]
          );
        }

        // 8. Free up the calendar (mark appointment as cancelled)
        await client.query(
          `UPDATE appointments SET
            status = 'cancelled',
            cancelled_at = NOW()
           WHERE job_id = $1`,
          [jobId]
        );

        // 9. Write cancellation audit log
        const feeReason = isCustomer
          ? (feeToPay > 0 ? `customer_initiated_fee_${feePercentage}pct` : 'no_fee_advance')
          : 'helper_initiated_no_fee';

        const hoursBeforeStart = job.scheduled_date
          ? (new Date(job.scheduled_date) - Date.now()) / (1000 * 60 * 60)
          : null;

        const auditResult = await client.query(
          `INSERT INTO cancellation_audit_log (
            job_id, cancelled_by_id, cancelled_by_role, counterparty_id,
            fee_reason, fee_amount_cents, fee_status,
            hours_before_start, cancellation_reason, payment_method, created_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
          RETURNING id`,
          [
            jobId,
            userId,
            isCustomer ? 'customer' : 'helper',
            isCustomer ? job.assigned_helper_id : job.client_id,
            feeReason,
            feeToPay,
            feeToPay > 0 ? 'pending' : 'none',
            hoursBeforeStart,
            reason || null,
            paymentMethod
          ]
        );

        const auditLogId = auditResult.rows[0]?.id;

        // 10. Record cancellation fee row (customer cancellations with fee only)
        let feeRecordId = null;
        if (isCustomer && feeToPay > 0 && paymentMethod === 'oxsteed') {
          const feeRecord = await client.query(
            `INSERT INTO cancellation_fees (
              job_id, audit_log_id, payer_id, payee_id,
              gross_fee_cents, helper_gets_cents, platform_cut_cents, stripe_fee_cents,
              status, created_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending', NOW())
            RETURNING id`,
            [
              jobId,
              auditLogId,
              job.client_id,
              job.assigned_helper_id,
              feeToPay,
              feeToHelper,
              feeToPlatform,
              feeToPay - feeToHelper - feeToPlatform
            ]
          );
          feeRecordId = feeRecord.rows[0]?.id;
        }

        // Return result for socket notification
        return {
          job_id: jobId,
          cancelled_at: new Date(),
          cancelled_by: isCustomer ? 'customer' : 'helper',
          fee_charged_cents: feeToPay,
          fee_to_helper_cents: feeToHelper,
          fee_to_platform_cents: feeToPlatform,
          payment_method: paymentMethod,
          helper_id: job.assigned_helper_id,
          customer_id: job.client_id,
          audit_log_id: auditLogId,
          fee_record_id: feeRecordId
        };
      },
      'cancel_job'
    ).then((result) => {
      // Pre-acceptance: simple success response, no fee/socket machinery needed
      if (result.type === 'pre_acceptance') {
        return res.json({
          success: true,
          data: {
            job_id: result.job.id,
            cancelled_at: new Date(),
            cancelled_by: 'customer',
            fee_charged_cents: 0,
            rejected_bids: result.rejectedBids.length,
          },
          message: 'Job cancelled',
        });
      }

      // Post-acceptance: send socket notification to both parties
      try {
        const { broadcastToUser } = require('../services/socketService');
        broadcastToUser(result.customer_id, 'job:cancelled', {
          id: result.job_id,
          status: 'cancelled',
          cancelled_by: result.cancelled_by,
          fee_charged_cents: result.fee_charged_cents
        });
        broadcastToUser(result.helper_id, 'job:cancelled', {
          id: result.job_id,
          status: 'cancelled',
          cancelled_by: result.cancelled_by,
          fee_to_helper_cents: result.fee_to_helper_cents
        });
      } catch (socketErr) {
        logger.warn('Failed to send job cancellation socket notification', { jobId, error: socketErr.message });
      }

      // Fire-and-forget: collect cancellation fee via Stripe (if applicable)
      if (result.fee_record_id && result.fee_charged_cents > 0) {
        try {
          const { collectCancellationFee } = require('../services/cancellationFeeService');
          collectCancellationFee({
            feeRecordId:  result.fee_record_id,
            customerId:   result.customer_id,
            helperId:     result.helper_id,
            feeTotalCents: result.fee_charged_cents,
            feeToHelper:  result.fee_to_helper_cents,
          }).catch((err) => logger.error('Stripe cancellation fee collection failed', { feeRecordId: result.fee_record_id, error: err.message }));
        } catch (_) { /* module load safety */ }
      }

      // Fire-and-forget: update reputation score after cancellation
      try {
        const { recalculateUserReputation } = require('./reputationController');
        if (result.customer_id) recalculateUserReputation(result.customer_id).catch(() => {});
        if (result.helper_id)   recalculateUserReputation(result.helper_id).catch(() => {});
      } catch (_) { /* non-fatal */ }

      logger.info('Job cancellation recorded', {
        jobId,
        cancelledBy: result.cancelled_by,
        feeCharged: result.fee_charged_cents,
        auditLogId: result.audit_log_id,
        feeRecordId: result.fee_record_id
      });

      res.json({
        success: true,
        data: {
          job_id: result.job_id,
          cancelled_at: result.cancelled_at,
          cancelled_by: result.cancelled_by,
          fee_charged_cents: result.fee_charged_cents,
          fee_to_helper_cents: result.fee_to_helper_cents,
          fee_to_platform_cents: result.fee_to_platform_cents,
          payment_method: result.payment_method
        },
        message: 'Job cancelled successfully'
      });
    });
  } catch (err) {
    if (err instanceof AppError) {
      return next(err);
    }
    logger.error('Error cancelling job', { jobId: req.params?.id, userId: req.user?.id, error: err.message });
    next(new AppError('Failed to cancel job', 500));
  }
};

id: auditLogId,
          fee_record_id: feeRecordId
        };
      },
      'cancel_job'
    ).then((result) => {
      // Pre-acceptance: simple success response, no fee/socket machinery needed
      if (result.type === 'pre_acceptance') {
        return res.json({
          success: true,
          data: {
            job_id: result.job.id,
            cancelled_at: new Date(),
            cancelled_by: 'customer',
            fee_charged_cents: 0,
            rejected_bids: result.rejectedBids.length,
          },
          message: 'Job cancelled',
        });
      }

      // Post-acceptance: send socket notification to both parties
      try {
        const { broadcastToUser } = require('../services/socketService');
        broadcastToUser(result.customer_id, 'job:cancelled', {
          id: result.job_id,
          status: 'cancelled',
          cancelled_by: result.cancelled_by,
          fee_charged_cents: result.fee_charged_cents
        });
        broadcastToUser(result.helper_id, 'job:cancelled', {
          id: result.job_id,
          status: 'cancelled',
          cancelled_by: result.cancelled_by,
          fee_to_helper_cents: result.fee_to_helper_cents
        });
      } catch (socketErr) {
        logger.warn('Failed to send job cancellation socket notification', { jobId, error: socketErr.message });
      }

      // Fire-and-forget: collect cancellation fee via Stripe (if applicable)
      if (result.fee_record_id && result.fee_charged_cents > 0) {
        try {
          const { collectCancellationFee } = require('../services/cancellationFeeService');
          collectCancellationFee({
            feeRecordId:  result.fee_record_id,
            customerId:   result.customer_id,
            helperId:     result.helper_id,
            feeTotalCents: result.fee_charged_cents,
            feeToHelper:  result.fee_to_helper_cents,
          }).catch((err) => logger.error('Stripe cancellation fee collection failed', { feeRecordId: result.fee_record_id, error: err.message }));
        } catch (_) { /* module load safety */ }
      }

      // Fire-and-forget: update reputation score after cancellation
      try {
        const { recalculateUserReputation } = require('./reputationController');
        if (result.customer_id) recalculateUserReputation(result.customer_id).catch(() => {});
        if (result.helper_id)   recalculateUserReputation(result.helper_id).catch(() => {});
      } catch (_) { /* non-fatal */ }

      logger.info('Job cancellation recorded', {
        jobId,
        cancelledBy: result.cancelled_by,
        feeCharged: result.fee_charged_cents,
        auditLogId: result.audit_log_id,
        feeRecordId: result.fee_record_id
      });

      res.json({
        success: true,
        data: {
          job_id: result.job_id,
          cancelled_at: result.cancelled_at,
          cancelled_by: result.cancelled_by,
          fee_charged_cents: result.fee_charged_cents,
          fee_to_helper_cents: result.fee_to_helper_cents,
          fee_to_platform_cents: result.fee_to_platform_cents,
          payment_method: result.payment_method
        },
        message: 'Job cancelled successfully'
      });
    });
  } catch (err) {
    if (err instanceof AppError) {
      return next(err);
    }
    logger.error('Error cancelling job', { jobId: req.params?.id, userId: req.user?.id, error: err.message });
    next(new AppError('Failed to cancel job', 500));
  }
};
id, error: err.message });
    next(new AppError("Failed to cancel job", 500));
  }
};
};
