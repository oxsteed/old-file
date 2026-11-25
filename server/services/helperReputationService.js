'use strict';
// Group 4 rest (items 192, 195): the helper's own reviews and a quality
// feedback summary. Reads are scoped to the caller as reviewee / assigned
// helper and require effective helper.offer_services access; a persona
// label grants nothing.
const pool = require('../db');
const access = require('./access/accessService');
const AppError = require('../utils/appError');

async function requireHelper(db, userId) {
  const decision = await access.can(userId, 'helper.offer_services', undefined, db);
  if (!decision.allowed) throw new AppError('Effective helper access required', 403, 'access_required');
}

const avg = (value) => (value == null ? null : Math.round(Number(value) * 100) / 100);

// 192: reviews the helper received on jobs, newest first, with their own
// response. Hidden/removed reviews are excluded (moderation already
// decided they are not part of the record).
async function myReviews(userId) {
  await requireHelper(pool, userId);
  const { rows } = await pool.query(
    `SELECT r.id, r.job_id, r.rating, r.comment, r.response, r.response_at, r.created_at,
            j.title AS job_title,
            NULLIF(BTRIM(u.first_name), '') AS reviewer_first_name
       FROM reviews r
       JOIN jobs j ON j.id = r.job_id
       LEFT JOIN users u ON u.id = r.reviewer_id
      WHERE r.reviewee_id = $1
        AND COALESCE(r.is_hidden, false) = false
        AND COALESCE(r.removed, false) = false
      ORDER BY r.created_at DESC, r.id DESC
      LIMIT 100`,
    [userId],
  );
  return rows.map((row) => ({
    id: row.id,
    jobId: row.job_id,
    jobTitle: row.job_title || null,
    reviewerFirstName: row.reviewer_first_name || null,
    rating: row.rating,
    comment: row.comment || '',
    response: row.response || null,
    respondedAt: row.response_at || null,
    createdAt: row.created_at,
  }));
}

// 195: quality feedback summary computed from the record, never stored.
async function qualitySummary(userId) {
  await requireHelper(pool, userId);
  const [{ rows: [r] }, { rows: dist }, { rows: [j] }] = await Promise.all([
    pool.query(
      `SELECT COUNT(*)::int AS total,
              AVG(rating) AS average,
              AVG(rating) FILTER (WHERE created_at >= NOW() - INTERVAL '90 days') AS recent_average,
              COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '90 days')::int AS recent_count,
              AVG(rating) FILTER (WHERE created_at < NOW() - INTERVAL '90 days'
                                    AND created_at >= NOW() - INTERVAL '180 days') AS prior_average,
              COUNT(*) FILTER (WHERE response IS NOT NULL)::int AS responded,
              COUNT(*) FILTER (WHERE rating <= 3 AND response IS NULL)::int AS low_unanswered
         FROM reviews
        WHERE reviewee_id = $1
          AND COALESCE(is_hidden, false) = false
          AND COALESCE(removed, false) = false`,
      [userId],
    ),
    pool.query(
      `SELECT rating, COUNT(*)::int AS count
         FROM reviews
        WHERE reviewee_id = $1
          AND COALESCE(is_hidden, false) = false
          AND COALESCE(removed, false) = false
        GROUP BY rating`,
      [userId],
    ),
    pool.query(
      `SELECT COUNT(*) FILTER (WHERE status IN ('completed','closed'))::int AS completed,
              COUNT(*) FILTER (WHERE change_requested_at IS NOT NULL)::int AS changes_requested,
              COUNT(*) FILTER (WHERE status = 'no_show' AND no_show_by IS DISTINCT FROM $1)::int AS no_show_reported
         FROM jobs
        WHERE assigned_helper_id = $1 AND deleted_at IS NULL`,
      [userId],
    ),
  ]);
  const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  for (const row of dist) distribution[row.rating] = row.count;
  const recent = avg(r.recent_average);
  const prior = avg(r.prior_average);
  let trend = 'not_enough_data';
  if (recent != null && prior != null) {
    trend = recent - prior >= 0.2 ? 'up' : prior - recent >= 0.2 ? 'down' : 'steady';
  }
  return {
    reviews: {
      total: r.total,
      average: avg(r.average),
      distribution,
      recentAverage: recent,
      recentCount: r.recent_count,
      priorAverage: prior,
      trend,
      responseRate: r.total ? Math.round((r.responded / r.total) * 100) : null,
      lowRatingsAwaitingResponse: r.low_unanswered,
    },
    jobs: {
      completed: j.completed,
      changesRequested: j.changes_requested,
      noShowsReported: j.no_show_reported,
    },
  };
}

module.exports = { myReviews, qualitySummary, requireHelper };
