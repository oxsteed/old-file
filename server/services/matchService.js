/**
 * matchService.js
 * Synchronous match scoring: called inside POST /api/jobs immediately after
 * job creation. Finds eligible helpers within 50 miles, scores each (0-100),
 * writes top 50 to job_matches, and returns the count for the API response.
 *
 * Requirements enforcement: SOFT-GATE only.
 * Helpers who lack a required credential are still included but lose points
 * and receive a warning flag on their job feed card. Hard rejection is done
 * at bid-submission time by the bid controller (flag only, not block).
 */

const db = require('../db');

const MAX_RADIUS_MILES   = 50;
const MAX_RADIUS_METERS  = MAX_RADIUS_MILES * 1609.34;
const TOP_N_STORED       = 50;   // write this many to job_matches
const TOP_N_NOTIFY       = 20;   // notify this many via push (future)

/**
 * scoreAndMatch(job)
 * @param {Object} job - full job row from DB (must include location_point, requirements, category_id, urgency)
 * @returns {number} count of matches generated
 */
async function scoreAndMatch(job) {
  if (!job.location_point && !job.location_lat) {
    // No location — cannot geo-match; skip silently
    return 0;
  }

  // ── 1. Fetch eligible helper pool within radius ─────────────────────────
  // We deliberately do NOT hard-filter on credential columns here —
  // soft-gate means we score them lower but still include them.
  const { rows: helpers } = await db.query(
    `SELECT
        hp.user_id,
        hp.tier,
        hp.avg_rating,
        hp.completed_jobs_count,
        hp.response_time_hours,
        hp.is_available_now,
        hp.is_licensed,
        hp.is_insured,
        hp.is_background_checked,
        hp.service_lat,
        hp.service_lng,
        hp.service_radius_miles,
        -- Distance in miles from job location
        ROUND(
          ST_Distance(
            ST_SetSRID(
              ST_MakePoint(hp.service_lng::float, hp.service_lat::float),
              4326
            )::geography,
            $1::geography
          ) / 1609.34, 2
        ) AS distance_miles,
        -- Does helper have a skill in this category?
        EXISTS (
          SELECT 1 FROM helper_skills hs
           WHERE hs.user_id = hp.user_id
             AND hs.category_id = $2
        ) AS has_category_skill
     FROM helper_profiles hp
     JOIN users u ON u.id = hp.user_id
     WHERE u.deleted_at IS NULL
       AND u.role IN ('helper_free','helper_pro','helper')
       -- Within our search radius
       AND hp.service_lat IS NOT NULL
       AND hp.service_lng IS NOT NULL
       AND ST_DWithin(
             ST_SetSRID(
               ST_MakePoint(hp.service_lng::float, hp.service_lat::float),
               4326
             )::geography,
             $1::geography,
             $3
           )`,
    [
      job.location_point
        || `SRID=4326;POINT(${job.location_lng} ${job.location_lat})`,
      job.category_id || null,
      MAX_RADIUS_METERS,
    ]
  );

  if (!helpers.length) return 0;

  // Parse requirements array to know which credentials are required
  const reqs = Array.isArray(job.requirements) ? job.requirements
    : (typeof job.requirements === 'string' ? JSON.parse(job.requirements) : []);

  const requiresLicense     = reqs.some(r => r.type === 'license'          && r.required);
  const requiresInsurance   = reqs.some(r => r.type === 'insurance'        && r.required);
  const requiresBgCheck     = reqs.some(r => r.type === 'background_check' && r.required);
  const isAsap              = job.urgency === 'asap';

  // ── 2. Score each helper ──────────────────────────────────────────────────
  const scored = helpers.map(h => {
    const breakdown = {};

    // Distance (30 pts)
    const dist = parseFloat(h.distance_miles) || MAX_RADIUS_MILES;
    let distScore = 0;
    if      (dist <  5) distScore = 30;
    else if (dist < 10) distScore = 20;
    else if (dist < 25) distScore = 10;
    breakdown.distance = distScore;

    // Category skill match (20 pts)
    const skillScore = h.has_category_skill ? 20 : 0;
    breakdown.skill = skillScore;

    // Rating (15 pts)
    const rating     = parseFloat(h.avg_rating) || 0;
    const ratingScore = Math.round((rating / 5.0) * 15);
    breakdown.rating = ratingScore;

    // Tier (10 pts)
    const tierScore = h.tier === 'pro' ? 10 : 5;
    breakdown.tier = tierScore;

    // Completed jobs — log scale, max 10 pts
    const jobs       = parseInt(h.completed_jobs_count) || 0;
    const jobScore   = Math.min(10, Math.round(Math.log1p(jobs) * 2.5));
    breakdown.completed_jobs = jobScore;

    // Response time (10 pts)
    const rt          = parseFloat(h.response_time_hours) || 99;
    let rtScore       = 2;
    if      (rt < 1)  rtScore = 10;
    else if (rt < 4)  rtScore = 6;
    breakdown.response_time = rtScore;

    // Urgency match (5 pts)
    const urgencyScore = (isAsap && h.is_available_now) ? 5 : 0;
    breakdown.urgency = urgencyScore;

    // Credential penalty (soft-gate): deduct points for missing required creds
    // Does NOT exclude helper — just lowers score and sets warning flags
    let credPenalty = 0;
    const warnings  = [];
    if (requiresLicense   && !h.is_licensed)          { credPenalty += 15; warnings.push('license'); }
    if (requiresInsurance && !h.is_insured)            { credPenalty += 10; warnings.push('insurance'); }
    if (requiresBgCheck   && !h.is_background_checked) { credPenalty += 8;  warnings.push('background_check'); }
    breakdown.cred_penalty = -credPenalty;

    const total = Math.max(0,
      distScore + skillScore + ratingScore + tierScore +
      jobScore  + rtScore   + urgencyScore - credPenalty
    );

    return {
      helper_id:       h.user_id,
      match_score:     total,
      score_breakdown: { ...breakdown, warnings },
    };
  });

  // ── 3. Sort descending and take top N ─────────────────────────────────────
  scored.sort((a, b) => b.match_score - a.match_score);
  const top = scored.slice(0, TOP_N_STORED);

  // ── 4. Bulk-insert into job_matches ──────────────────────────────────────
  if (!top.length) return 0;

  const values = top.map((m, i) => {
    const base = i * 3;
    return `($${base + 1}, $${base + 2}, $${base + 3})`;
  }).join(', ');

  const params = top.flatMap(m => [
    job.id,
    m.helper_id,
    // Store score + breakdown as a JSONB object so one column carries both
    JSON.stringify({ score: m.match_score, breakdown: m.score_breakdown }),
  ]);

  // Re-shape: job_matches has (job_id, helper_id, match_score, score_breakdown)
  const insertValues = top.map((m, i) => {
    const base = i * 4;
    return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4})`;
  }).join(', ');

  const insertParams = top.flatMap(m => [
    job.id,
    m.helper_id,
    m.match_score,
    JSON.stringify(m.score_breakdown),
  ]);

  await db.query(
    `INSERT INTO job_matches (job_id, helper_id, match_score, score_breakdown)
     VALUES ${insertValues}
     ON CONFLICT (job_id, helper_id) DO UPDATE
       SET match_score     = EXCLUDED.match_score,
           score_breakdown = EXCLUDED.score_breakdown`,
    insertParams
  );

  // ── 5. Mark top NOTIFY helpers for push (future hook) ─────────────────────
  // In a full implementation this would enqueue push notifications.
  // We return the notify count so the API response can surface it.
  const notifyCount = Math.min(top.length, TOP_N_NOTIFY);

  return { total: top.length, notified: notifyCount };
}

module.exports = { scoreAndMatch };
