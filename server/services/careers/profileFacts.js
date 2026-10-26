'use strict';

// Verified work profile facts (careers spec §9). Facts are computed only
// from OxSteed's own records, each with its source and sample size, and
// are never typed in by the worker. Thresholds keep small samples from
// turning one bad day into a "fact".

const pool = require('../../db');
const { isDiditVerificationFresh } = require('../../utils/diditGate');

const MIN_REVIEWS_FOR_RATING = 5;
const MIN_SHIFTS_FOR_ON_TIME = 5;
const MIN_RESPONSE_SAMPLE = 10;
const JOB_ON_TIME_GRACE_MINUTES = 15;
// Bayesian smoothing toward the platform prior for display (§9.1).
const RATING_PRIOR_MEAN = 4.5;
const RATING_PRIOR_WEIGHT = 5;
const FACT_TTL_DAYS = 7;

function strictlyVerified(user) {
  return Boolean(user && user.didit_status === 'verified' && isDiditVerificationFresh(user.didit_verified_at));
}

/**
 * Recompute every stored fact for one worker inside the caller's
 * transaction. Returns the list of facts written.
 */
async function computeFacts(db, userId, { graceMinutes = 7 } = {}) {
  const facts = [];
  const add = (fact_type, value, sample_size, source, source_ref = {}, category = null) =>
    facts.push({ fact_type, value, sample_size, source, source_ref, category });

  const { rows: [jobs] } = await db.query(
    `SELECT COUNT(*)::int AS n
       FROM jobs
      WHERE assigned_helper_id = $1 AND status = 'completed' AND deleted_at IS NULL
        AND (dispute_status IS NULL OR dispute_status IN ('none','resolved_helper','withdrawn'))`,
    [userId]
  );
  if (jobs.n > 0) add('completed_jobs', { count: jobs.n }, jobs.n, 'jobs');

  const { rows: [rating] } = await db.query(
    `SELECT COUNT(*)::int AS n, COALESCE(SUM(rating), 0)::numeric AS total
       FROM reviews
      WHERE reviewee_id = $1 AND is_public = TRUE
        AND COALESCE(removed, FALSE) = FALSE AND COALESCE(is_hidden, FALSE) = FALSE`,
    [userId]
  );
  if (rating.n >= MIN_REVIEWS_FOR_RATING) {
    const raw = Number(rating.total) / rating.n;
    const smoothed = (RATING_PRIOR_MEAN * RATING_PRIOR_WEIGHT + Number(rating.total)) / (RATING_PRIOR_WEIGHT + rating.n);
    add('avg_rating', { average: Math.round(smoothed * 100) / 100, raw_average: Math.round(raw * 100) / 100, count: rating.n }, rating.n, 'reviews');
  }

  // On time = clocked in no later than the published shift start + grace,
  // judged in the store's own time zone.
  const { rows: [onTime] } = await db.query(
    `WITH matched AS (
       SELECT s.id,
              MIN(t.clock_in_at) AS clock_in_at,
              (s.shift_date + s.start_time) AT TIME ZONE COALESCE(l.timezone, 'UTC') AS starts_at
         FROM business_staff_shifts s
         LEFT JOIN restaurant_locations l ON l.id = s.location_id
         JOIN business_time_entries t
           ON t.user_id = s.user_id AND t.business_id = s.business_id
          AND t.voided_at IS NULL AND t.clock_in_at IS NOT NULL
          AND t.clock_in_at BETWEEN ((s.shift_date + s.start_time) AT TIME ZONE COALESCE(l.timezone, 'UTC')) - INTERVAL '3 hours'
                                AND ((s.shift_date + s.start_time) AT TIME ZONE COALESCE(l.timezone, 'UTC')) + INTERVAL '3 hours'
        WHERE s.user_id = $1 AND s.published_at IS NOT NULL AND s.shift_date >= CURRENT_DATE - 365
        GROUP BY s.id, s.shift_date, s.start_time, l.timezone
     )
     SELECT COUNT(*)::int AS n,
            COUNT(*) FILTER (WHERE clock_in_at <= starts_at + make_interval(mins => $2::int))::int AS on_time
       FROM matched`,
    [userId, graceMinutes]
  );
  // Jobs: started no more than 15 minutes after the scheduled start. Jobs
  // without a scheduled start, or rescheduled after assignment, don't count.
  const { rows: [jobsOnTime] } = await db.query(
    `SELECT COUNT(*)::int AS n,
            COUNT(*) FILTER (WHERE started_at <= scheduled_start_at + make_interval(mins => $2::int))::int AS on_time
       FROM jobs
      WHERE assigned_helper_id = $1 AND deleted_at IS NULL
        AND scheduled_start_at IS NOT NULL AND started_at IS NOT NULL
        AND (assigned_at IS NULL OR last_material_edit_at IS NULL OR last_material_edit_at <= assigned_at)`,
    [userId, JOB_ON_TIME_GRACE_MINUTES]
  );
  const onTimeTotal = onTime.n + jobsOnTime.n;
  if (onTimeTotal >= MIN_SHIFTS_FOR_ON_TIME) {
    const onTimeCount = onTime.on_time + jobsOnTime.on_time;
    add('on_time_rate', {
      rate: Math.round((onTimeCount / onTimeTotal) * 100) / 100,
      on_time: onTimeCount,
      shifts: onTime.n,
      jobs: jobsOnTime.n,
    }, onTimeTotal, 'time_entries+jobs', { shift_grace_minutes: graceMinutes, job_grace_minutes: JOB_ON_TIME_GRACE_MINUTES });
  }

  // response_rate is the existing denormalized percentage; its sample is the
  // number of job requests the helper received (bids placed or declined).
  const { rows: [helper] } = await db.query(
    `SELECT hp.response_rate,
            (SELECT COUNT(*)::int FROM bids b WHERE b.helper_id = hp.user_id) AS sample
       FROM helper_profiles hp WHERE hp.user_id = $1`,
    [userId]
  );
  if (helper && helper.response_rate != null && helper.sample >= MIN_RESPONSE_SAMPLE) {
    add('response_rate', { rate: Number(helper.response_rate) / 100 }, helper.sample, 'helper_profiles');
  }

  const { rows: training } = await db.query(
    `SELECT m.id AS module_id, m.title, m.category, MAX(c.completed_at) AS completed_at, MAX(c.expires_at) AS expires_at
       FROM restaurant_training_assignments a
       JOIN restaurant_training_completions c ON c.assignment_id = a.id AND c.passed = TRUE
       JOIN restaurant_training_modules m ON m.id = a.module_id
      WHERE a.user_id = $1 AND (c.expires_at IS NULL OR c.expires_at > NOW())
      GROUP BY m.id, m.title, m.category
      ORDER BY MAX(c.completed_at) DESC
      LIMIT 50`,
    [userId]
  );
  for (const t of training) {
    add('training_completed', { title: t.title, completed_at: t.completed_at, expires_at: t.expires_at }, 1, 'training', { module_id: Number(t.module_id) }, t.category || null);
  }

  const { rows: docs } = await db.query(
    `SELECT id, doc_type, title, expires_on, verified_at
       FROM restaurant_staff_documents
      WHERE user_id = $1 AND deleted_at IS NULL AND verification_status = 'verified'
        AND (expires_on IS NULL OR expires_on >= CURRENT_DATE)
      ORDER BY verified_at DESC NULLS LAST
      LIMIT 50`,
    [userId]
  );
  // Only the credential type and dates; never the file or its number.
  for (const d of docs) {
    add('certificate', { doc_type: d.doc_type, title: d.title, expires_on: d.expires_on }, 1, 'staff_documents', { document_id: Number(d.id) }, d.doc_type);
  }

  const { rows: [shifts] } = await db.query(
    `SELECT COUNT(*)::int AS n FROM business_time_entries
      WHERE user_id = $1 AND voided_at IS NULL AND clock_out_at IS NOT NULL`,
    [userId]
  );
  if (shifts.n > 0) add('shifts_worked', { count: shifts.n }, shifts.n, 'time_entries');

  const { rows: [tenure] } = await db.query(
    `SELECT COALESCE(SUM(EXTRACT(EPOCH FROM (COALESCE(o.removed_at, NOW()) - bm.created_at)) / 2629800), 0)::int AS months,
            COUNT(*)::int AS n
       FROM business_members bm
       LEFT JOIN staff_offboarding_records o ON o.membership_id = bm.id
      WHERE bm.member_id = $1 AND bm.role IS NOT NULL AND (bm.status = 'active' OR o.id IS NOT NULL)`,
    [userId]
  );
  if (tenure.months > 0) add('tenure', { months: tenure.months, employers: tenure.n }, tenure.n, 'business_members');

  const { rows: [user] } = await db.query('SELECT didit_status, didit_verified_at FROM users WHERE id = $1', [userId]);
  if (strictlyVerified(user)) add('id_verified', { verified: true, verified_at: user.didit_verified_at }, 1, 'didit');

  await db.query('DELETE FROM career_profile_facts WHERE user_id = $1', [userId]);
  for (const f of facts) {
    await db.query(
      `INSERT INTO career_profile_facts (user_id, fact_type, category, value, sample_size, source, source_ref, valid_until)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW() + make_interval(days => $8::int))`,
      [userId, f.fact_type, f.category, JSON.stringify(f.value), f.sample_size, f.source, JSON.stringify(f.source_ref), FACT_TTL_DAYS]
    );
  }
  return facts;
}

/**
 * Facts as one employer may see them: hidden types and facts under open
 * dispute (with hide_while_reviewing) are dropped; rehire eligibility and
 * that employer's own background check are added per employer (§9.1).
 */
async function factsForViewer(db, userId, { businessId = null, includeHidden = false } = {}) {
  const runner = db || pool;
  const { rows: [profile] } = await runner.query('SELECT hidden_fact_types FROM career_profiles WHERE user_id = $1', [userId]);
  const hidden = new Set(includeHidden ? [] : (profile?.hidden_fact_types || []));
  const { rows: disputes } = await runner.query(
    `SELECT fact_type, fact_id FROM career_fact_disputes
      WHERE user_id = $1 AND status = 'open' AND hide_while_reviewing = TRUE`,
    [userId]
  );
  const disputedTypes = new Set(disputes.filter((d) => !d.fact_id).map((d) => d.fact_type));
  const disputedIds = new Set(disputes.filter((d) => d.fact_id).map((d) => Number(d.fact_id)));
  const { rows } = await runner.query(
    `SELECT id, fact_type, category, value, sample_size, source, computed_at
       FROM career_profile_facts WHERE user_id = $1 ORDER BY fact_type, computed_at DESC`,
    [userId]
  );
  const facts = rows.filter((f) => includeHidden || (!hidden.has(f.fact_type) && !disputedTypes.has(f.fact_type) && !disputedIds.has(Number(f.id))));

  const employerFacts = [];
  if (businessId) {
    const { rows: [left] } = await runner.query(
      `SELECT removed_at, rehired_at, rehire_eligible FROM staff_offboarding_records
        WHERE business_id = $1 AND user_id = $2 ORDER BY removed_at DESC LIMIT 1`,
      [businessId, userId]
    );
    if (left) employerFacts.push({ fact_type: 'rehire_eligible', value: { worked_here: true, eligible: left.rehire_eligible !== false, left_at: left.removed_at, rehired: Boolean(left.rehired_at) }, source: 'offboarding' });
    const { rows: [check] } = await runner.query(
      `SELECT status, completed_at FROM career_background_checks
        WHERE business_id = $1 AND user_id = $2 AND status <> 'cancelled'
        ORDER BY created_at DESC LIMIT 1`,
      [businessId, userId]
    );
    if (check) employerFacts.push({ fact_type: 'background_check', value: { status: check.status, completed_at: check.completed_at }, source: 'checkr' });
  }
  return { facts, employerFacts, hiddenTypes: [...hidden] };
}

module.exports = {
  MIN_REVIEWS_FOR_RATING,
  MIN_RESPONSE_SAMPLE,
  MIN_SHIFTS_FOR_ON_TIME,
  strictlyVerified,
  computeFacts,
  factsForViewer,
};
