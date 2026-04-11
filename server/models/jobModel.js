const crypto = require('crypto');
const db = require('../db');
const { calculateTier3Fees } = require('../utils/feeCalculator');

// --- Privacy: Fuzz coordinates by +/-2 miles ---
// Uses crypto.randomInt() (CSPRNG) instead of Math.random() to prevent
// statistical analysis of the fuzz distribution (L-39)
const FUZZ_MILES  = 2;
const MILES_TO_DEG = 1 / 69.0;

const fuzzCoords = (lat, lng) => {
  if (!lat || !lng) return { lat: null, lng: null };
  const latFuzz = ((crypto.randomInt(0, 4000) - 2000) / 1000) * FUZZ_MILES * MILES_TO_DEG;
  const lngFuzz = ((crypto.randomInt(0, 4000) - 2000) / 1000) * FUZZ_MILES * MILES_TO_DEG;
  return {
    lat: parseFloat((parseFloat(lat) + latFuzz).toFixed(6)),
    lng: parseFloat((parseFloat(lng) + lngFuzz).toFixed(6)),
  };
};

// --- Create Job ---
exports.create = async ({
  clientId,
  title,
  description,
  categoryId    = null,
  categoryName  = null,
  jobType       = 'tier1_intro',
  isUrgent      = false,
  locationAddress,
  locationCity,
  locationState,
  locationZip,
  locationLat,
  locationLng,
  marketId      = null,
  budgetMin     = null,
  budgetMax     = null,
  scheduledStartAt = null,
  scheduledEndAt   = null,
  mediaUrls     = [],
}) => {
  // Pre-compute fuzzed coordinates for public feed
  const approx = fuzzCoords(locationLat, locationLng);

  const { rows } = await db.query(
    `INSERT INTO jobs (
        client_id, title, description,
        category_id, category_name,
        job_type, is_urgent,
        location_address, location_city,
        location_state, location_zip,
        location_lat, location_lng,
        location_point,
        location_approx_lat, location_approx_lng,
        market_id,
        budget_min, budget_max,
        scheduled_start_at, scheduled_end_at,
        media_urls,
        status,
        expires_at
     )
     VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,
        $10,$11,$12,$13,
        ST_SetSRID(ST_MakePoint($13::float, $12::float), 4326),
        $14,$15,$16,$17,$18,$19,$20,$21,
        'published',
        now() + interval '30 days'
     )
     RETURNING *`,
    [
      clientId, title, description,
      categoryId, categoryName,
      jobType, isUrgent,
      locationAddress, locationCity,
      locationState, locationZip,
      locationLat, locationLng,
      approx.lat, approx.lng,
      marketId,
      budgetMin, budgetMax,
      scheduledStartAt, scheduledEndAt,
      mediaUrls,
    ]
  );
  return rows[0];
};

// --- Find by ID ---
// Returns MASKED version by default -- full address only with permission
exports.findById = async (jobId, requestingUserId = null) => {
  const { rows } = await db.query(
    `SELECT
        j.*,
        u.first_name  AS client_first_name,
        LEFT(u.last_name, 1) || '.'  AS client_last_name_masked,
        -- Full last name only if viewer is the assigned helper
        CASE WHEN $2::uuid IS NOT NULL
                  AND (j.assigned_helper_id = $2
                       OR j.client_id        = $2)
             THEN u.last_name
             ELSE LEFT(u.last_name, 1) || '.'
        END AS client_last_name,
        -- Full address only revealed if within 12h and confirmed
        CASE WHEN j.address_revealed_to = $2
                  AND j.address_revealed_at IS NOT NULL
             THEN j.location_address
             ELSE NULL
        END AS location_address_revealed,
        -- Always show approx coords in feed
        j.location_approx_lat  AS display_lat,
        j.location_approx_lng  AS display_lng,
        c.name                 AS category_name_resolved,
        -- Bid info
        (SELECT COUNT(*) FROM bids WHERE job_id = j.id
         AND status = 'pending')            AS active_bid_count,
        -- Has viewer bid on this job?
        EXISTS (
          SELECT 1 FROM bids
          WHERE job_id = j.id AND helper_id = $2
        ) AS viewer_has_bid,
        -- Viewer's bid amount if exists
        (SELECT amount FROM bids
         WHERE job_id = j.id AND helper_id = $2
         LIMIT 1) AS viewer_bid_amount
     FROM jobs j
     JOIN users u       ON u.id = j.client_id
     LEFT JOIN categories c ON c.id = j.category_id
     WHERE j.id = $1
       AND j.deleted_at IS NULL`,
    [jobId, requestingUserId]
  );
  return rows[0] ?? null;
};

// --- Reveal Full Address to Helper ---
// Called only when:
// 1. Helper has confirmed attendance
// 2. Job starts within 12 hours
exports.revealAddress = async (jobId, helperId) => {
  const { rows: jobRows } = await db.query(
    `SELECT * FROM jobs WHERE id = $1 AND deleted_at IS NULL`,
    [jobId]
  );
  if (!jobRows.length) throw new Error('Job not found.');
  const job = jobRows[0];

  // Verify helper is assigned to this job
  if (job.assigned_helper_id !== helperId) {
    throw new Error('You are not assigned to this job.');
  }
  // Verify attendance confirmed
  if (!job.attendance_confirmed_at) {
    throw new Error('Attendance must be confirmed before address is revealed.');
  }
  // Verify within 12 hours of scheduled start
  if (job.scheduled_start_at) {
    const hoursUntilStart = (
      new Date(job.scheduled_start_at) - new Date()
    ) / (1000 * 60 * 60);
    if (hoursUntilStart > 12) {
      throw new Error(
        `Address will be available ${Math.floor(hoursUntilStart - 12)} ` +
        `hours from now (12 hours before job start).`
      );
    }
  }
  // Already revealed -- return existing data
  if (job.address_revealed_to === helperId) {
    return {
      address: job.location_address,
      city:    job.location_city,
      state:   job.location_state,
      zip:     job.location_zip,
      lat:     job.location_lat,
      lng:     job.location_lng,
      already_revealed: true,
    };
  }
  // Reveal now
  await db.query(
    `UPDATE jobs
     SET address_revealed_at = now(),
         address_revealed_to = $1,
         updated_at           = now()
     WHERE id = $2`,
    [helperId, jobId]
  );
  return {
    address: job.location_address,
    city:    job.location_city,
    state:   job.location_state,
    zip:     job.location_zip,
    lat:     job.location_lat,
    lng:     job.location_lng,
    already_revealed: false,
  };
};

// --- Confirm Attendance ---
exports.confirmAttendance = async (jobId, helperId) => {
  const { rows } = await db.query(
    `UPDATE jobs
     SET attendance_confirmed_at = now(),
         updated_at              = now()
     WHERE id = $1
       AND assigned_helper_id = $2
       AND status IN ('accepted','in_progress')
       AND attendance_confirmed_at IS NULL
     RETURNING *`,
    [jobId, helperId]
  );
  if (!rows.length) {
    throw new Error('Cannot confirm attendance for this job.');
  }
  return rows[0];
};

// --- Set Financial Breakdown ---
// Called when a bid is accepted -- locks in all fee amounts
exports.setFinancials = async (jobId, agreedAmountDollars, isBrokerMediated) => {
  const breakdown = calculateTier3Fees(
    Math.round(agreedAmountDollars * 100), // Convert to cents
    isBrokerMediated
  );
  await db.query(
    `UPDATE jobs
     SET job_value          = $1,
         customer_total     = $2,
         platform_fee       = $3,
         protection_fee     = $4,
         broker_fee         = $5,
         helper_payout      = $6,
         is_broker_mediated = $7,
         updated_at         = now()
     WHERE id = $8`,
    [
      breakdown.job_value_cents      / 100,
      breakdown.customer_total_cents / 100,
      breakdown.platform_fee_cents   / 100,
      breakdown.protection_fee_cents / 100,
      breakdown.broker_fee_cents     / 100,
      breakdown.helper_payout_cents  / 100,
      isBrokerMediated,
      jobId,
    ]
  );
  return breakdown;
};

// --- Transition Status ---
// Enforces valid state machine transitions
const VALID_TRANSITIONS = {
  draft:        ['published', 'cancelled'],
  published:    ['matched', 'cancelled'],
  matched:      ['negotiating', 'published', 'cancelled'],
  negotiating:  ['accepted', 'matched', 'cancelled'],
  accepted:     ['in_progress', 'cancelled'],
  in_progress:  ['completed', 'cancelled'],
  completed:    ['closed'],
  cancelled:    [],
  closed:       [],
};

exports.transitionStatus = async (jobId, newStatus, userId) => {
  const job = await exports.findById(jobId, userId);
  if (!job) throw new Error('Job not found.');

  const allowed = VALID_TRANSITIONS[job.status] ?? [];
  if (!allowed.includes(newStatus)) {
    throw new Error(
      `Cannot transition job from '${job.status}' to '${newStatus}'. ` +
      `Allowed: ${allowed.join(', ') || 'none'}`
    );
  }

  const { rows } = await db.query(
    `UPDATE jobs
     SET status     = $1,
         updated_at = now()
     WHERE id = $2
     RETURNING *`,
    [newStatus, jobId]
  );
  return rows[0];
};

// --- Public Feed Query (masked) ---
exports.getPublicFeed = async ({
  marketId    = null,
  categoryId  = null,
  isUrgent    = null,
  jobType     = null,
  radiusMiles = 25,
  lat         = null,
  lng         = null,
  page        = 1,
  limit       = 20,
}) => {
  // Cap inputs to prevent oversized queries and excessive map API calls (L-37, L-38)
  limit       = Math.min(parseInt(limit) || 20, 100);
  radiusMiles = Math.min(parseFloat(radiusMiles) || 25, 100);
  const params     = [];
  const conditions = [`j.status = 'published'`, `j.deleted_at IS NULL`];

  if (marketId) {
    params.push(marketId);
    conditions.push(`j.market_id = $${params.length}`);
  }
  if (categoryId) {
    params.push(categoryId);
    conditions.push(`j.category_id = $${params.length}`);
  }
  if (isUrgent !== null) {
    params.push(isUrgent);
    conditions.push(`j.is_urgent = $${params.length}`);
  }
  if (jobType) {
    params.push(jobType);
    conditions.push(`j.job_type = $${params.length}`);
  }
  if (lat && lng) {
    params.push(lng, lat, radiusMiles * 1609.34); // Convert miles to meters
    conditions.push(
      `ST_DWithin(
          j.location_point,
          ST_SetSRID(ST_MakePoint($${params.length - 2}::float,
                                   $${params.length - 1}::float), 4326)::geography,
          $${params.length}
       )`
    );
  }

  const where  = conditions.join(' AND ');
  const offset = (page - 1) * limit;

  // Push distance params BEFORE limit/offset so they are safe parameterised
  let distLngIdx = null;
  let distLatIdx = null;
  if (lat && lng) {
    params.push(lng, lat);  // lng first for ST_MakePoint(x,y)
    distLngIdx = params.length - 1;
    distLatIdx = params.length;
  }

  params.push(limit, offset);
  const limitIdx  = params.length - 1;
  const offsetIdx = params.length;

  // Build distance SQL fragment safely
  const distanceFragment = (lat && lng)
    ? `CASE WHEN TRUE
            THEN ROUND(
              ST_Distance(
                j.location_point,
                ST_SetSRID(
                  ST_MakePoint($${distLngIdx}::float, $${distLatIdx}::float),
                  4326
                )::geography
              ) / 1609.34, 1
            )
            ELSE NULL
       END`
    : 'NULL';

  const { rows } = await db.query(
    `SELECT
        j.id,
        j.title,
        j.description,
        j.category_name,
        j.job_type,
        j.is_urgent,
        j.status,
        -- MASKED: show only last initial and approx location
        LEFT(u.last_name, 1) || '.'  AS client_last_name,
        j.location_city,
        j.location_state,
        j.location_approx_lat        AS display_lat,
        j.location_approx_lng        AS display_lng,
        j.budget_min,
        j.budget_max,
        j.bid_count,
        j.scheduled_start_at,
        j.media_urls,
        j.created_at,
        -- Distance in miles if lat/lng provided
        ${distanceFragment}          AS distance_miles
     FROM jobs j
     JOIN users u ON u.id = j.client_id
     WHERE ${where}
     ORDER BY j.is_urgent DESC, j.created_at DESC
     LIMIT  $${limitIdx}
     OFFSET $${offsetIdx}`,
    params
  );

  const { rows: countRows } = await db.query(
    `SELECT COUNT(*) FROM jobs j
     JOIN users u ON u.id = j.client_id
     WHERE ${where}`,
    params.slice(0, -(lat && lng ? 4 : 2))
  );

  return {
    jobs:  rows,
    total: parseInt(countRows[0].count),
    page:  parseInt(page),
    limit: parseInt(limit),
    pages: Math.ceil(parseInt(countRows[0].count) / limit),
  };
};
