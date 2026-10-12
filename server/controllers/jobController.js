const pool = require('../db');
const { scoreAndMatch } = require('../services/matchService');
const { uploadFile, getPublicUrl } = require('../utils/storage');
const logger = require('../utils/logger');
const { fuzzCoords } = require('../models/jobModel');
const { withTransaction, withJobTransaction } = require('../utils/transaction');
const { captureAuthorizedPaymentWithClient } = require('../services/paymentCaptureService');
const { assertNoPendingAdjustment } = require('../services/jobPaymentReauthorizationService');
const { AppError } = require('../middleware/errorHandler');
const { envFlagEnabled } = require('../middleware/featureFlags');
const { cancelJobTransaction, finalizeJobCancellation } = require('../services/jobCancellationService');
const { sendNotification, sendBulkNotification } = require('../services/notificationService');
const { applyJobEdit, listJobRevisions, lockJob } = require('../services/jobEditService');
const { serializeJob, serializeJobs, jobEtag, parseIfMatch, viewerRole } = require('../services/jobSerializer');
const jobStatusPolicy = require('../services/jobStatusPolicy');
const jobSchema = require('../validation/jobSchema');
const { enqueueJobEvent, EVENT_TYPES } = require('../services/jobEventOutbox');
const { getClientRequestId } = require('../utils/idempotency');
const paymentRails = require('../services/paymentRails');
const paymentFlags = require('../services/paymentLayerFlags');
const { normalizeCountryCode, isValidTimeZone, defaultCurrencyFor } = require('../validation/countries');
const { normalizeCurrency } = require('../validation/money');
const {
  translateRecordForRequest,
  translateRecordsForRequest,
} = require('../modules/translation/userContentTranslationService');

/**
 * Tier-3 escrow detection, deterministic edition.
 *
 * The tier is an explicit enum on the job row (jobs.transaction_mode, CHECK
 * ('direct', 'guided_protected')), set when the tier-3 protected payment
 * intent is created (paymentController.createPaymentIntent). Never infer the
 * tier from free-text labels: substring matching on job_type/job_type_label
 * misfires on user-entered text ("escrow" in a title, "tier3" in a note)
 * and silently misses real escrows whose labels were never tagged.
 */
function isTier3EscrowJob(jobRow) {
  return String(jobRow?.transaction_mode || 'direct') === 'guided_protected';
}

function platformJobPaymentsEnabled() {
  return envFlagEnabled('FEATURE_PAYMENTS_ENABLED', false);
}

// Create a new job (wizard publish)
exports.createJob = async (req, res, next) => {
  try {
    const {
      title, description,
      category_id, category_name, category,
      budget_type, budget, budget_min, budget_max, budget_min_cents, budget_max_cents, currency_code,
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

    // ── Validate with the shared job schema (validation/jobSchema.js) ───────────
    const singleBudgetInput = budget !== undefined && budget !== null && budget !== '';
    const { patch: canonicalInput } = jobSchema.normalizeJobInput({
      title, description, category_name: category_name || category,
      budget_type: budget_type || (singleBudgetInput ? 'fixed' : 'open'),
      budget, budget_min, budget_max,
      ...(budget_min_cents !== undefined ? { budget_min_cents } : {}),
      ...(budget_max_cents !== undefined ? { budget_max_cents } : {}),
      urgency: urgency || undefined, site_access: site_access || undefined,
      recurrence: recurrence || undefined, notes, private_notes,
      location_address, location_city, location_state, location_zip, location_country,
      location_lat, location_lng, scheduled_date, scheduled_time,
      requirements: parsedRequirements, required_skills: parsedRequiredSkills,
    }, { mode: 'legacy' });
    for (const key of ['title', 'description', 'location_city', 'location_country']) {
      if (!Object.prototype.hasOwnProperty.call(canonicalInput, key)) canonicalInput[key] = null;
    }
    const errs = jobSchema.validateJobFields(canonicalInput, { mode: 'create' });
    if (Object.keys(errs).length) {
      // `location` mirrors location_city for clients built before the shared schema.
      if (errs.location_city) errs.location = errs.location_city;
      throw new AppError('Validation failed', 422, 'validation_failed', errs);
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

    // ── Resolve budget: integer cents are canonical (dollars mirror them) ──
    const resolvedBudgetType = canonicalInput.budget_type || 'open';
    const budgetMinCents = resolvedBudgetType === 'open' ? null : (canonicalInput.budget_min_cents ?? null);
    const budgetMaxCents = resolvedBudgetType === 'open' ? null
      : (canonicalInput.budget_max_cents ?? (resolvedBudgetType === 'fixed' ? budgetMinCents : null));
    const resolvedBudgetMin = budgetMinCents === null ? null : budgetMinCents / 100;
    const resolvedBudgetMax = budgetMaxCents === null ? null : budgetMaxCents / 100;
    // ISO country code (always derived; additive) + job time zone and local
    // currency (payment layers; flags default off → today's behaviour).
    const locationCountryCode = normalizeCountryCode(String(req.body.location_country_code || location_country || ''));
    const jobTimeZone = paymentFlags.isEnabled('JOB_TIMEZONES')
      ? [req.body.timezone, req.user.timezone].find((zone) => isValidTimeZone(zone)) || null
      : null;
    const resolvedCurrencyCode = currency_code
      ? String(currency_code).trim().toUpperCase().slice(0, 3)
      : (paymentFlags.isEnabled('PAYMENT_RAILS') && locationCountryCode ? defaultCurrencyFor(locationCountryCode) : 'USD');
    if (currency_code && paymentFlags.isEnabled('PAYMENT_RAILS') && !normalizeCurrency(resolvedCurrencyCode)) {
      throw new AppError('Unsupported currency', 400, 'validation_failed', { currency_code: 'currency_unsupported' });
    }
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

    // ── Schedule: scheduled_start_at is canonical (legacy mirrors via trigger) ──
    const scheduledStartAt = canonicalInput.scheduled_start_at ?? null;
    const scheduledPrecision = canonicalInput.scheduled_precision ?? null;

    const rows = await withTransaction(pool, async (client) => {
    const { rows: inserted } = await client.query(
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
          scheduled_start_at, scheduled_precision, recurrence,
          preferred_helper_id, preferred_helper_name,
          private_notes,
          currency_code, budget_min_cents, budget_max_cents,
          location_country_code, timezone,
          status, expires_at
       )
       VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
          $11,$12,$13,$14,$15,$16,$17,$18,
          $19,$20,
          ${hasGeo ? `ST_SetSRID(ST_MakePoint($20::float,$19::float),4326)::geography` : 'NULL'},
          $21,$22,$23,$24,$25,
          $26,$27,$28,$29,$30,$31,$32,
          $33,$34,$35,
          $36,$37,
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
        scheduledStartAt, scheduledPrecision, recurrence || 'none',
        preferred_helper_id || null, preferred_helper_name || null,
        private_notes || null,
        resolvedCurrencyCode, budgetMinCents, budgetMaxCents,
        locationCountryCode, jobTimeZone,
      ]
    );
    if (inserted[0]?.id && ['published', 'matched'].includes(inserted[0].status)) {
      await enqueueJobEvent(client, { jobId: inserted[0].id, eventType: EVENT_TYPES.PUBLISHED, coalesce: false });
    }
    return inserted;
    }, 'create_job');

    // Exact GPS coordinates never leave the server - see services/jobSerializer.
    const safeJob = serializeJob(rows[0], { role: 'owner' });
    const createdEtag = jobEtag(rows[0]);
    if (createdEtag) res.set('ETag', createdEtag);

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

    // Saved-search alerts fan out from the job event outbox (job.published),
    // committed with the insert above - see jobs/jobEventOutbox.js.

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

// Search input → prefix tsquery ("fix sink" → "fix:* & sink:*"). Only letters
// and digits survive, so user input can never inject tsquery operators.
function buildPrefixTsQuery(q) {
  if (!q) return null;
  const words = String(q).toLowerCase().normalize('NFKC').match(/[\p{L}\p{N}]+/gu) || [];
  const unique = [...new Set(words)].slice(0, 8);
  return unique.length ? unique.map((w) => `${w.slice(0, 64)}:*`).join(' & ') : null;
}

function encodeFeedCursor(row) {
  // Microsecond precision: a millisecond-rounded cursor would skip rows.
  const createdAt = row.feed_cursor_ts
    || (row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at));
  return Buffer.from(JSON.stringify({ c: createdAt, i: String(row.id) })).toString('base64url');
}

function decodeFeedCursor(value) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(String(value), 'base64url').toString('utf8'));
    if (!parsed || Number.isNaN(Date.parse(parsed.c))) return null;
    if (!/^[0-9a-f-]{36}$/i.test(String(parsed.i))) return null;
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z$/.test(String(parsed.c))) return null;
    return { createdAt: String(parsed.c), id: String(parsed.i) };
  } catch {
    return null;
  }
}
exports._feedCursor = { encodeFeedCursor, decodeFeedCursor, buildPrefixTsQuery };

// Get all jobs with filters
exports.getJobs = async (req, res, next) => {
  try {
    const {
      category, city, state, country, status, q,
      min_budget, max_budget, sort,
      lat, lng, radius, fallback_city, fallback_state,
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
    const hasGeoFilter = Number.isFinite(userLat) && Number.isFinite(userLng)
      && Math.abs(userLat) <= 90 && Math.abs(userLng) <= 180;
    const fallbackCity = String(fallback_city || '').trim().slice(0, 100);
    const fallbackState = String(fallback_state || '').trim().slice(0, 100);

    const page  = Math.max(1, parseInt(req.query.page)  || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
    const offset = (page - 1) * limit;
    let conditions = [`u.is_active = true`, `j.deleted_at IS NULL`];
    let params = [];
    let paramIdx = 1;

    // Keep jobs without coordinates visible when their city and state match the
    // location resolved by the client. Other jobs must pass the radius check.
    if (hasGeoFilter) {
      const radiusCondition = `(j.location_point IS NOT NULL AND ST_DWithin(j.location_point, ST_SetSRID(ST_MakePoint($${paramIdx}::float, $${paramIdx + 1}::float), 4326)::geography, $${paramIdx + 2}::float))`;
      params.push(userLng, userLat, radiusM);
      paramIdx += 3;
      if (fallbackCity && fallbackState) {
        conditions.push(`(${radiusCondition} OR (j.location_point IS NULL AND LOWER(j.location_city) = LOWER($${paramIdx}) AND LOWER(j.location_state) = LOWER($${paramIdx + 1})))`);
        params.push(fallbackCity, fallbackState);
        paramIdx += 2;
      } else {
        conditions.push(radiusCondition);
      }
    }

    // Full-text search on the trigger-maintained search_document (GIN index)
    // instead of leading-wildcard ILIKE scans. Each word matches as a prefix.
    const tsQuery = buildPrefixTsQuery(q);
    if (q && !tsQuery) {
      return res.json({ jobs: [], total: 0, page: 1, limit: Math.min(100, Math.max(1, parseInt(req.query.limit) || 20)), next_cursor: null });
    }
    if (tsQuery) {
      conditions.push(`j.search_document @@ to_tsquery('simple', $${paramIdx++})`);
      params.push(tsQuery);
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
    // Audit fix: the public board only exposes public statuses. Private
    // statuses (draft, negotiating, accepted, etc.) are not filterable here.
    const VALID_JOB_STATUSES = ['draft', 'published', 'matched', 'negotiating', 'accepted', 'in_progress', 'completed', 'cancelled', 'closed'];
    const PUBLIC_JOB_STATUSES = ['published', 'matched', 'completed'];
    if (status && VALID_JOB_STATUSES.includes(status)) {
      if (!PUBLIC_JOB_STATUSES.includes(status)) {
        return res.status(400).json({ error: 'Invalid status filter for public job board.' });
      }
      conditions.push(`j.status = $${paramIdx++}`);
      params.push(status);
    } else {
      // Show both 'published' and 'matched' jobs on the public board.
      // 'matched' jobs have at least one bid but are still open for competing bids
      // until the customer explicitly accepts one via assignHelper().
      conditions.push(`j.status IN ('published', 'matched')`);
    }
    const minBudgetCents = min_budget !== undefined && min_budget !== '' && Number.isFinite(Number(min_budget))
      ? Math.round(Number(min_budget) * 100) : null;
    const maxBudgetCents = max_budget !== undefined && max_budget !== '' && Number.isFinite(Number(max_budget))
      ? Math.round(Number(max_budget) * 100) : null;
    if (minBudgetCents !== null) {
      conditions.push(`j.budget_max_cents >= $${paramIdx++}`);
      params.push(minBudgetCents);
    }
    if (maxBudgetCents !== null) {
      conditions.push(`j.budget_min_cents <= $${paramIdx++}`);
      params.push(maxBudgetCents);
    }

    // Keyset pagination for the default newest-first feed: ?cursor=<opaque>
    // avoids deep OFFSET scans. page/limit stay supported for older clients.
    const keysetEligible = !sort || sort === 'newest' || (sort === 'nearest' && !hasGeoFilter);
    const cursor = keysetEligible ? decodeFeedCursor(req.query.cursor) : null;
    if (req.query.cursor && keysetEligible && !cursor) {
      return res.status(400).json({ error: 'Invalid cursor.', code: 'invalid_cursor' });
    }
    if (cursor) {
      conditions.push(`(j.created_at, j.id) < ($${paramIdx}::timestamptz, $${paramIdx + 1}::uuid)`);
      params.push(cursor.createdAt, cursor.id);
      paramIdx += 2;
    }

    const whereClause = conditions.length
      ? `WHERE ${conditions.join(' AND ')}`
      : '';

    const VALID_SORTS = ['', 'budget_high', 'budget_low', 'urgent', 'newest', 'nearest'];
    if (sort && !VALID_SORTS.includes(sort)) {
      return res.status(400).json({ error: `Invalid sort value. Allowed: ${VALID_SORTS.filter(Boolean).join(', ')}` });
    }
    let orderBy = 'j.created_at DESC, j.id DESC';
    if (sort === 'budget_high') orderBy = 'j.budget_max_cents DESC NULLS LAST, j.id DESC';
    if (sort === 'budget_low')  orderBy = 'j.budget_min_cents ASC NULLS LAST, j.id DESC';
    if (sort === 'urgent')      orderBy = 'j.is_urgent DESC, j.created_at DESC, j.id DESC';
    // 'nearest' requires geo params; fall back to newest if coords missing
    if (sort === 'nearest' && hasGeoFilter) orderBy = 'distance_miles ASC NULLS LAST, j.created_at DESC, j.id DESC';

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
        j.budget_type, j.budget_min, j.budget_max, j.budget_min_cents, j.budget_max_cents,
        j.currency_code, j.is_urgent,
        j.location_city, j.location_state, j.location_zip, j.location_country,
        j.location_approx_lat, j.location_approx_lng,
        j.created_at, j.expires_at, j.bid_count, j.revision,
        to_char(j.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS feed_cursor_ts,
        u.first_name || ' ' || u.last_name AS client_name
        ${distanceSelect}
      FROM jobs j
      JOIN users u ON j.client_id = u.id
      ${whereClause}
      ORDER BY ${orderBy}
      LIMIT $${limitParamIdx} OFFSET $${limitParamIdx + 1}
    `, [...selectParams, limit, cursor ? 0 : offset]);

    // Exact totals are only computed for page-mode requests; cursor clients
    // page with next_cursor and skip the COUNT(*) scan.
    let total = null;
    if (!cursor && req.query.include_total !== 'false') {
      const { rows: countRows } = await pool.query(`
        SELECT COUNT(*) FROM jobs j JOIN users u ON j.client_id = u.id ${whereClause}
      `, params);
      total = parseInt(countRows[0].count);
    }
    const lastRow = rows[rows.length - 1];
    const nextCursor = keysetEligible && rows.length === limit && lastRow
      ? encodeFeedCursor(lastRow) : null;

    const translatedRows = await translateRecordsForRequest(rows, req, {
      fields: ['title', 'description', 'category_name'],
      contentType: 'job',
    });

    res.json({
      jobs: serializeJobs(translatedRows, { role: 'public' }).map(({ feed_cursor_ts: _cursorTs, ...job }) => job),
      total,
      page: cursor ? null : parseInt(page),
      limit: parseInt(limit),
      next_cursor: nextCursor,
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
        j.scheduled_start_at, j.scheduled_precision,
        j.budget_min_cents, j.budget_max_cents, j.currency_code,
        j.site_access, j.notes, j.private_notes, j.required_skills,
        j.version, j.revision, j.material_edit_count, j.last_material_edit_at,
        j.requirements, j.media_urls, j.bid_count, j.assigned_helper_id,
        j.preferred_helper_id, j.preferred_helper_name,
        j.created_at, j.updated_at, j.expires_at,
        j.started_at, j.completed_at, j.cancelled_at, j.cancellation_reason,
        j.escrow_status,
        j.payment_rail, j.settlement_currency, j.location_country_code, j.timezone,
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

    const job = rows[0];
    // Audit fix: IDOR. Full address, escrow status, private notes, and client
    // details are only for the client, the assigned helper, or an admin.
    const role = viewerRole(job, req.user);
    const result = serializeJob(job, { role });
    if (role === 'owner' || role === 'admin') {
      const etag = jobEtag(job);
      if (etag) res.set('ETag', etag);
      result.can_edit = role === 'owner'
        ? jobStatusPolicy.isOwnerEditable(job.status)
        : jobStatusPolicy.isAdminEditable(job.status);
    }

    const translatedJob = await translateRecordForRequest(result, req, {
      fields: ['title', 'description', 'category_name'],
      contentType: 'job',
    });

    res.json(translatedJob);
  } catch (err) {
    next(err);
  }
};

// Guest pages receive only fields that are safe to publish and index.
exports.getPublicJob = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { rows } = await pool.query(`
      SELECT
        j.id, j.title, j.description, j.category_name, j.status,
        j.budget_min, j.budget_max,
        j.location_city, j.location_state,
        j.scheduled_date, j.created_at, j.expires_at,
        j.media_urls
      FROM jobs j
      JOIN users u ON u.id = j.client_id
      WHERE j.id = $1
        AND j.deleted_at IS NULL
        AND u.is_active = TRUE
        AND u.deleted_at IS NULL
        AND u.email_verified = TRUE
        AND u.onboarding_completed = TRUE
        AND j.status IN ('published', 'matched')
        AND (j.expires_at IS NULL OR j.expires_at > NOW())
      LIMIT 1
    `, [id]);

    if (rows.length === 0) throw new AppError('Job not found', 404, 'job_not_found');

    let media = rows[0].media_urls;
    if (typeof media === 'string') {
      try { media = JSON.parse(media); } catch { media = []; }
    }
    media = Array.isArray(media)
      ? media.filter((item) => item && typeof item.url === 'string' && /^https?:\/\//i.test(item.url))
        .map((item) => ({ url: item.url, type: item.type || 'image' }))
        .slice(0, 10)
      : [];

    const publicJob = {
      id: rows[0].id,
      title: rows[0].title,
      description: rows[0].description,
      category_name: rows[0].category_name,
      status: rows[0].status,
      budget_min: rows[0].budget_min,
      budget_max: rows[0].budget_max,
      location_city: rows[0].location_city,
      location_state: rows[0].location_state,
      scheduled_date: rows[0].scheduled_date,
      created_at: rows[0].created_at,
      expires_at: rows[0].expires_at,
      media,
    };

    const translatedJob = await translateRecordForRequest(publicJob, req, {
      fields: ['title', 'description', 'category_name'],
      contentType: 'job',
    });
    return res.json({ job: translatedJob });
  } catch (err) {
    return next(err);
  }
};

// ── Editing ─────────────────────────────────────────────────────────────────
// PATCH /api/jobs/:id  — JSON Merge Patch (RFC 7396): null clears a field.
//   Requires If-Match (ETag from GET) or body.expected_version (428 otherwise).
// PUT   /api/jobs/:id  — legacy partial update: null/empty values are ignored.
//   Preconditions are optional for backward compatibility.
// Both share services/jobEditService (status gate, validation, revisions,
// bid reconfirmation, outbox). See docs/job-editing.md.
function readPrecondition(req) {
  const ifMatch = parseIfMatch(req.get ? req.get('If-Match') : null, req.params.id);
  if (Number.isNaN(ifMatch)) {
    throw new AppError('If-Match header is malformed', 400, 'invalid_precondition', { version: 'invalid' });
  }
  if (ifMatch !== null) return { expectedVersion: ifMatch, preconditionSource: 'if-match' };
  const bodyVersion = req.body?.expected_version;
  if (bodyVersion !== undefined && bodyVersion !== null && bodyVersion !== '') {
    const n = Number(bodyVersion);
    if (!Number.isInteger(n) || n < 1) {
      throw new AppError('expected_version must be a positive integer', 422, 'validation_failed', { expected_version: 'invalid' });
    }
    return { expectedVersion: n, preconditionSource: 'body' };
  }
  return { expectedVersion: null, preconditionSource: null };
}

function sendJobEditError(err, res, next) {
  if (err && err.etag) res.set('ETag', err.etag);
  return next(err);
}

async function handleJobEdit(req, res, next, mode) {
  try {
    const { expectedVersion, preconditionSource } = readPrecondition(req);
    if (mode === 'merge' && expectedVersion === null) {
      throw new AppError('Send If-Match or expected_version with job edits.', 428, 'precondition_required',
        { version: 'required' });
    }
    const idempotencyKey = getClientRequestId(req);
    if (idempotencyKey === false) {
      throw new AppError('Idempotency-Key must be a UUID', 422, 'validation_failed', { idempotency_key: 'invalid' });
    }
    const result = await applyJobEdit({
      jobId: req.params.id,
      actor: { id: req.user.id, role: req.user.role },
      input: req.body,
      mode,
      expectedVersion,
      preconditionSource,
      source: 'owner',
      idempotencyKey: idempotencyKey || null,
      requestId: req.id || req.get?.('X-Request-Id') || null,
    });
    const etag = jobEtag(result.job);
    if (etag) res.set('ETag', etag);
    if (result.replayed) res.set('Idempotent-Replayed', 'true');
    const body = serializeJob(result.job, { role: 'owner' });
    return res.json({
      ...body,
      job: body,
      changed_fields: Object.keys(result.changes || {}),
      material_change: Boolean(result.material),
      bids_flagged_for_reconfirm: result.bidsFlagged || 0,
    });
  } catch (err) {
    return sendJobEditError(err, res, next);
  }
}

exports.updateJob = (req, res, next) => handleJobEdit(req, res, next, 'legacy');
exports.patchJob = (req, res, next) => handleJobEdit(req, res, next, 'merge');

// GET /api/jobs/:id/revisions — owner/admin see everything; bidders see
// material changes without private fields.
exports.getJobRevisions = async (req, res, next) => {
  try {
    const result = await listJobRevisions({
      jobId: req.params.id,
      viewer: req.user,
      limit: req.query.limit,
      before: req.query.before,
    });
    return res.json({ revisions: result.revisions, next_before: result.next_before });
  } catch (err) {
    return next(err);
  }
};


// Assign a helper to a job by accepting a specific bid
exports.assignHelper = async (req, res, next) => {
  try {
    // bid_id is always required.
    // scheduled_start / scheduled_end are optional ISO strings provided by the
    // BidAcceptanceModal when the customer picks an exact time slot.
    // payment_method is required: 'oxsteed' or 'off_platform'
    const { bid_id, scheduled_start, scheduled_end } = req.body;
    // payment_rail (stripe | credit | offline) when the rail engine is on;
    // otherwise the legacy payment_method (oxsteed | off_platform).
    const { rail: requestedRail, paymentMethod: payment_method } = paymentRails.paymentMethodForRequest(req.body);
    // Optional optimistic-concurrency guard: the job version the customer saw.
    const jobPrecondition = readPrecondition({
      get: (name) => (req.get ? req.get(name) : undefined),
      params: { id: null },
      body: { expected_version: req.body?.expected_job_version },
    });
    const expectedJobVersion = jobPrecondition.expectedVersion === '*' ? null : jobPrecondition.expectedVersion;

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

    if (payment_method === 'oxsteed' && requestedRail !== 'credit' && !platformJobPaymentsEnabled()) {
      throw new AppError(
        'Protected OxSteed job payments are coming soon. Use direct customer-helper payment for now.',
        503,
        'platform_job_payments_coming_soon'
      );
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
      // 1. Lock order is always jobs → bids (same as job edits, bid creation,
      //    and reconfirmation) so concurrent edit/accept cannot deadlock and an
      //    edit can never slip in between reading and accepting the terms.
      const bidRef = await client.query('SELECT job_id FROM bids WHERE id = $1', [bid_id]);
      if (bidRef.rows.length === 0) {
        throw new AppError('Bid not found', 404, 'bid_not_found');
      }
      const lockedJob = await lockJob(client, bidRef.rows[0].job_id);
      if (!lockedJob || lockedJob.deleted_at) {
        throw new AppError('Bid not found', 404, 'bid_not_found');
      }
      const bidLookup = await client.query(
        `SELECT id, job_id, helper_id, status, eta_hours, amount, amount_cents,
                job_revision, needs_reconfirm, expires_at
           FROM bids WHERE id = $1 AND job_id = $2 FOR UPDATE`,
        [bid_id, lockedJob.id]
      );
      if (bidLookup.rows.length === 0) {
        throw new AppError('Bid not found', 404, 'bid_not_found');
      }
      const bid = {
        ...bidLookup.rows[0],
        client_id: lockedJob.client_id,
        job_status: lockedJob.status,
        title: lockedJob.title,
        scheduled_start_at: lockedJob.scheduled_start_at,
        scheduled_precision: lockedJob.scheduled_precision,
        location_address: lockedJob.location_address,
        location_city: lockedJob.location_city,
        location_state: lockedJob.location_state,
      };

      if (String(bid.client_id) !== String(req.user.id)) {
        throw new AppError('Not authorized to accept bids on this job', 403, 'forbidden');
      }

      if (expectedJobVersion !== null && Number(lockedJob.version) !== Number(expectedJobVersion)) {
        const err = new AppError('The job changed since you loaded it. Review the latest details first.',
          jobPrecondition.preconditionSource === 'if-match' ? 412 : 409,
          jobPrecondition.preconditionSource === 'if-match' ? 'precondition_failed' : 'version_conflict',
          { version: 'version_conflict' });
        err.etag = jobEtag(lockedJob);
        throw err;
      }

      if (!jobStatusPolicy.isAcceptable(bid.job_status)) {
        throw new AppError('Job is not in a state that allows bid acceptance', 409, 'invalid_job_state');
      }

      // A bid placed before a material edit must be reconfirmed by the helper
      // so the hire always matches terms the helper actually agreed to.
      if (bid.needs_reconfirm || (bid.job_revision != null && Number(bid.job_revision) < Number(lockedJob.revision))) {
        throw new AppError('This helper must reconfirm their bid after your latest changes.', 409, 'bid_needs_reconfirm');
      }
      if (bid.status === 'pending' && bid.expires_at && new Date(bid.expires_at).getTime() < Date.now()) {
        throw new AppError('This bid has expired.', 409, 'bid_expired');
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

      // If helper has no policies, create launch defaults: direct payment enabled,
      // platform-managed OxSteed payments disabled until protected payments launch.
      if (!helperPolicies) {
        const insertResult = await client.query(
          `INSERT INTO helper_cancellation_policies (helper_id, oxsteed_enabled, custom_enabled, custom_policy)
           VALUES ($1, FALSE, TRUE, $2)
           RETURNING *`,
          [
            bid.helper_id,
            JSON.stringify({
              terms: 'Customer and helper arrange payment directly. OxSteed does not collect or hold job payment yet.',
              payment_mode: 'direct',
            }),
          ]
        );
        helperPolicies = insertResult.rows[0];
      }

      // Validate that the selected payment method is enabled
      if (payment_method === 'oxsteed' && !helperPolicies.oxsteed_enabled) {
        throw new AppError('Helper does not accept OxSteed payments', 400, 'payment_method_not_enabled');
      }

      // Direct customer-helper payment is a launch-safe default, so we keep it
      // available even if older helper policy rows were created before the
      // long-term payment model was finalized.
      if (payment_method === 'off_platform' && !helperPolicies.custom_enabled) {
        helperPolicies.custom_enabled = true;
      }

      // Build cancellation policy based on payment method
      let cancellationPolicy = {};

      if (payment_method === 'oxsteed') {
        // 10% of the bid, in cents, capped at $100 (10000 cents).
        const bidCents = acceptedBid.amount_cents ?? Math.round(Number(acceptedBid.amount) * 100);
        const feeCap = Math.min(Math.round(bidCents * 0.1), 10000);
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
         AND status::text = ANY($4::text[])
         RETURNING *`,
        [bid.helper_id, bid.job_id, req.user.id, [...jobStatusPolicy.ACCEPTABLE_STATUSES]]
      );

      if (jobResult.rows.length === 0) {
        throw new AppError('Job not found or cannot be assigned', 409, 'state_conflict');
      }

      // 4a. Record (and, with the rail engine on, enforce) the payment rail.
      const railResult = await paymentRails.applyAcceptance(client, {
        job: jobResult.rows[0],
        bid: acceptedBid,
        customerId: req.user.id,
        paymentMethod: payment_method,
        requestedRail,
        body: req.body,
        isImpersonated: Boolean(req.impersonated),
      });

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
        const jobRow = bid;

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
        } else if (jobRow.scheduled_start_at) {
          // Canonical schedule (migration 760): date-only schedules are stored
          // at 09:00 UTC with precision 'date', exact times with 'datetime'.
          apptStart = jobRow.scheduled_start_at instanceof Date
            ? jobRow.scheduled_start_at
            : new Date(jobRow.scheduled_start_at);
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

        // Savepoint: a failed insert (e.g. the helper already has an
        // appointment in that slot) would otherwise abort the whole
        // transaction, and COMMIT would silently roll the hire back while the
        // API still answered 200.
        await client.query('SAVEPOINT assign_appointment');
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
        await client.query('RELEASE SAVEPOINT assign_appointment');
      } catch (apptErr) {
        // Non-fatal: log but never let appointment creation break bid acceptance
        await client.query('ROLLBACK TO SAVEPOINT assign_appointment').catch(() => {});
        logger.warn('Failed to auto-create calendar appointment for accepted job', {
          jobId: bid.job_id,
          helperId: bid.helper_id,
          error: apptErr?.message,
        });
      }

      // Set financials inside the transaction for atomicity.
      // Validate bid amount is present before accepting.
      if (payment_method === 'oxsteed') {
        if (!acceptedBid?.amount || Number(acceptedBid.amount) <= 0) {
          throw new AppError('Bid amount is required to accept', 400, 'validation_failed', {
            amount: 'Valid bid amount required'
          });
        }
        if (!railResult.skipLegacyFinancials) {
          const { setFinancials } = require('../models/jobModel');
          await setFinancials(jobResult.rows[0].id, Number(acceptedBid.amount), false, client);
        }
      }
      if (payment_method === 'oxsteed' && !railResult.skipLegacyCollateral) {

        // Phase 5 — Credit Everywhere (locked decision #2): hybrid jobs.
        // Hold the customer's Credit as escrow collateral via the shared
        // adapter (surface=jobs, mode=hold). This is collateral backing the
        // platform escrow — not a rename of the existing escrow flow.
        // Fail-closed: if the Credit hold fails, bid acceptance rolls back.
        const { spendWithCredit } = require('../services/creditSpendAdapter');
        const collateral = await spendWithCredit({
          client,
          participantRef: { type: 'helper', subjectId: String(bid.helper_id) },
          customerId: req.user.id,
          amountCents: acceptedBid.amount_cents ?? Math.round(Number(acceptedBid.amount) * 100),
          currency: railResult.currency || 'USD',
          surface: 'jobs',
          mode: 'hold',
          referenceType: 'job_escrow_collateral',
          referenceId: String(bid.job_id),
          isImpersonated: Boolean(req.impersonated),
          metadata: { bidId: String(bid_id), jobTitle: bid.title },
        });
        await client.query(
          `UPDATE jobs SET metadata = COALESCE(metadata, '{}'::jsonb) || $2::jsonb
            WHERE id = $1`,
          [bid.job_id, JSON.stringify({ creditCollateralHoldId: collateral.hold?.id || null,
            creditCollateralKey: collateral.idempotencyKey })]
        );
      }

      const { rows: finalJobRows } = await client.query('SELECT * FROM jobs WHERE id = $1', [jobResult.rows[0].id]);
      return { job: finalJobRows[0] || jobResult.rows[0], bid: acceptedBid };
    }, 'assign_helper');

    const acceptedEtag = jobEtag(result.job);
    if (acceptedEtag) res.set('ETag', acceptedEtag);
    res.status(200).json({
      message: 'Bid accepted and helper assigned',
      job: serializeJob(result.job, { role: 'owner' }),
      bid: result.bid,
    });

    // Notify the hired helper (non-blocking, after response)
    try {
      await sendNotification({
        userId: result.bid.helper_id,
        type: 'bid_accepted',
        data: {
          job_id: result.job.id,
          bid_id: result.bid.id,
          job_title: result.job.title,
          client_name: result.job.client_name,
        },
        action_url: `/jobs/${result.job.id}`,
      });
    } catch (notifErr) {
      logger.warn('Failed to send hire notification to helper', { error: notifErr.message });
    }
  } catch (err) {
    if (err?.etag && !res.headersSent) res.set('ETag', err.etag);
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

    res.json({ message: 'Job started', job: serializeJob(result, { user: req.user }) });
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
      SELECT id, client_id, assigned_helper_id, status, job_type, job_type_label, transaction_mode, metadata, payment_rail
      FROM jobs
      WHERE id = $1 AND (client_id = $2 OR assigned_helper_id = $2)
      AND status = 'in_progress'
    `, [id, req.user.id]);

    if (jobRows.length === 0) {
      throw new AppError('Job not found or cannot be completed', 404, 'job_not_found');
    }

    const job = jobRows[0];
    // An approved change order raised the price above what is authorized:
    // the customer must re-authorize before the job closes out.
    assertNoPendingAdjustment(job);

    // Wrap all state changes in a transaction for atomicity
    const result = await withJobTransaction(pool, async (client) => {
      // Tier-3 escrow: when the customer marks complete, capture authorized funds in the same transaction
      // so helpers get paid without a separate "Capture" step (and we roll back if Stripe fails).
      if (job.client_id === req.user.id && isTier3EscrowJob(job)) {
        const { rows: payRows } = await client.query(
          `SELECT id, amount, stripe_payment_intent_id, stripe_account_id, status, capture_amount_cents, pending_increase_cents,
                  charge_model, destination_account_id, currency, metadata
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

      // Credit rail: the Credit hold is the payment. The customer's
      // completion releases it to the helper (helper-marked completion is
      // released by the auto-release worker after the review window).
      await paymentRails.assertCompletable(client, job);
      if (job.client_id === req.user.id && paymentRails.railOf(job) === 'credit') {
        const dispute = await client.query(
          `SELECT id FROM disputes WHERE job_id = $1 AND status IN ('open', 'in_progress')`,
          [id],
        );
        if (dispute.rows[0]) {
          throw new AppError('Cannot complete job while a payment dispute is open. Resolve the dispute first.', 409, 'dispute_open');
        }
        const { rows: fullJob } = await client.query('SELECT * FROM jobs WHERE id = $1 FOR UPDATE', [id]);
        await paymentRails.onComplete(client, fullJob[0], { actorUserId: req.user.id });
      }

      const { rows } = await client.query(`
        UPDATE jobs SET
          status = 'completed',
          completed_at = now(),
          updated_at = now()
        WHERE id = $1 AND status = 'in_progress'
          -- A change order approved meanwhile still needs re-authorization.
          AND NOT (COALESCE(metadata, '{}'::jsonb) ?| ARRAY['paymentAdjustmentRequired', 'creditAdjustmentRequired'])
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

      // Increment helper's completed_jobs_count and refresh search_rank_boost
      // so their discovery rank reflects their track record immediately.
      if (rows[0].assigned_helper_id) {
        await client.query(`
          UPDATE helper_profiles
          SET completed_jobs_count = COALESCE(completed_jobs_count, 0) + 1,
              search_rank_boost = LEAST(2.0,
                1.0
                + GREATEST(0.0, COALESCE(avg_rating, 0) - 3.5) * 0.15
                + LEAST(0.30, LN(GREATEST(1, COALESCE(total_reviews, 0)) + 1) * 0.10)
                + LEAST(0.25, LN(GREATEST(1, COALESCE(completed_jobs_count, 0) + 1) + 1) * 0.08)
              ),
              updated_at = now()
          WHERE user_id = $1
        `, [rows[0].assigned_helper_id]);
      }

      return rows[0];
    }, 'complete_job');

    res.json({ message: 'Job completed', job: serializeJob(result, { user: req.user }) });

    // Phase 5 — Credit Everywhere: release the Credit escrow collateral hold
    // (non-blocking; the hold is collateral, not the payment).
    try {
      const { releaseJobCreditCollateral } = require('../services/jobCreditCollateral');
      releaseJobCreditCollateral(result.id).catch(() => {});
    } catch (_) { /* non-fatal */ }

    // Notify both parties to leave a review (non-blocking)
    try {
      const jobFull = result;
      const reviewUrl = `/jobs/${jobFull.id}`;
      if (jobFull.assigned_helper_id) {
        await sendNotification({
          userId: jobFull.assigned_helper_id,
          type: 'job_completed',
          title: 'Job Complete — Leave a Review',
          body: `The job "${jobFull.title || 'your job'}" has been marked complete. Share your experience!`,
          data: { job_id: jobFull.id },
          action_url: reviewUrl,
        });
      }
      if (jobFull.client_id && jobFull.client_id !== req.user.id) {
        // Only notify client if they didn't trigger the completion themselves
        await sendNotification({
          userId: jobFull.client_id,
          type: 'job_completed',
          title: 'Job Complete — Leave a Review',
          body: `"${jobFull.title || 'Your job'}" is marked complete. Rate your helper!`,
          data: { job_id: jobFull.id },
          action_url: reviewUrl,
        });
      }
    } catch (notifErr) {
      logger.warn('Failed to send job completion notifications', { error: notifErr.message });
    }

    // ── Franchise royalty collection (non-blocking) ────────────────────────
    // If the job was completed in a franchise territory, credit the franchise
    // owner's platform_ledger with their agreed royalty_bps of the job value.
    try {
      const jobForRoyalty = result;
      if (jobForRoyalty.job_value && (jobForRoyalty.location_city || jobForRoyalty.location_state)) {
        const city   = jobForRoyalty.location_city  || null;
        const region = jobForRoyalty.location_state || null;

        const { rows: franchiseRows } = await pool.query(`
          SELECT fa.owner_user_id, fa.desired_city, fa.desired_region,
                 fagr.royalty_bps
          FROM franchise_applications fa
          JOIN franchise_agreements fagr ON fagr.application_id = fa.id
          WHERE fa.status = 'launched'
            AND fagr.royalty_bps > 0
            AND (
              ($1::text IS NOT NULL AND LOWER(COALESCE(fa.desired_city,'')) = LOWER($1))
              OR ($2::text IS NOT NULL AND LOWER(COALESCE(fa.desired_region,'')) = LOWER($2))
            )
          LIMIT 1
        `, [city, region]);

        if (franchiseRows.length > 0) {
          const { owner_user_id, royalty_bps } = franchiseRows[0];
          const royaltyCents = Math.round((jobForRoyalty.job_value * 100) * (royalty_bps / 10000));
          if (royaltyCents > 0 && owner_user_id) {
            await pool.query(`
              INSERT INTO platform_ledger
                (user_id, type, amount_cents, description, metadata, source_type)
              VALUES ($1, 'franchise_royalty', $2, $3, $4, 'franchise_royalty')
            `, [
              owner_user_id,
              royaltyCents,
              `Territory royalty — job #${jobForRoyalty.id} in ${city || region}`,
              JSON.stringify({ job_id: jobForRoyalty.id, royalty_bps, job_value: jobForRoyalty.job_value }),
            ]);
            logger.info(`[franchise] Royalty ${royaltyCents}¢ credited to owner ${owner_user_id} for job ${jobForRoyalty.id}`);
          }
        }
      }
    } catch (royaltyErr) {
      logger.warn('Failed to collect franchise royalty (non-fatal)', { error: royaltyErr.message });
    }

    // ── Referral value-event: grant reward on FIRST completed job (non-blocking)
    // This fires if the customer (client_id) was referred and has now completed
    // their first job — a stronger signal than mere registration.
    try {
      const { rows: referralRows } = await pool.query(`
        SELECT u.referred_by,
               (SELECT COUNT(*) FROM jobs
                WHERE client_id = u.id AND status = 'completed') AS total_completed
        FROM users u
        WHERE u.id = $1 AND u.referred_by IS NOT NULL
      `, [result.client_id]);

      if (referralRows.length > 0 && parseInt(referralRows[0].total_completed) === 1) {
        // Exactly 1 completed job means this IS the first — grant the conversion reward
        const { grantReferralReward } = require('./referralController');
        await grantReferralReward(referralRows[0].referred_by, result.client_id);
        logger.info(`[referral] Value-event conversion: client ${result.client_id} completed first job, reward → ${referralRows[0].referred_by}`);
      }
    } catch (refErr) {
      logger.warn('Failed to process referral value-event (non-fatal)', { error: refErr.message });
    }
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

    res.json({ message: 'Job closed', job: serializeJob(result, { user: req.user }) });
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
        scheduled_start_at, scheduled_precision,
        budget_min_cents, budget_max_cents, currency_code,
        version, revision,
        private_notes,
        started_at, completed_at, cancelled_at, cancellation_reason,
        expires_at, created_at, updated_at
      FROM jobs
      ${where}
      ORDER BY created_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}
    `, params);

    const translatedRows = await translateRecordsForRequest(rows, req, {
      fields: ['title', 'description', 'category_name'],
      contentType: 'job',
    });

    res.json(translatedRows);
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
 *
 * Transaction and post-commit side effects live in
 * server/services/jobCancellationService.js, shared with the agent
 * cancellation flow (POST /api/admin/jobs/:jobId/cancel).
 */
exports.cancelJob = async (req, res, next) => {
  try {
    const { id: jobId } = req.params;   // route is /:id
    const { reason } = req.body;
    const userId = req.user.id;

    // actorKind 'auto': derive customer/helper from the job row; 403 otherwise.
    const result = await cancelJobTransaction({ jobId, actorId: userId, actorKind: 'auto', reason });

    // Post-commit side effects (socket notifications, fee collection, reputation).
    await finalizeJobCancellation(result);

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
  } catch (err) {
    if (err instanceof AppError) {
      return next(err);
    }
    logger.error('Error cancelling job', { jobId: req.params?.id, userId: req.user?.id, error: err.message });
    next(new AppError('Failed to cancel job', 500));
  }
};
