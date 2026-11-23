'use strict';
// Group 4 rest, item 184 follow-up (Emile approved 2026-11-23): hand-backs
// are recorded privately for Trust & Safety. This is the only reader of
// job_handbacks outside the hand-back write path. It is admin-only
// (manage_users), never shown publicly, and never feeds ratings,
// reputation or ranking.
const pool = require('../db');
const AppError = require('../utils/appError');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function forHelper(helperId) {
  if (!UUID.test(helperId || '')) throw new AppError('Invalid user', 400, 'validation_failed');
  const { rows: [counts] } = await pool.query(
    `SELECT COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE created_at > NOW() - interval '30 days')::int AS last30,
            COUNT(*) FILTER (WHERE created_at > NOW() - interval '90 days')::int AS last90
       FROM job_handbacks WHERE helper_id = $1`, [helperId]);
  const { rows } = await pool.query(
    `SELECT h.id, h.job_id, j.title AS job_title, h.reason_code, h.note, h.reopened_bid_count, h.created_at
       FROM job_handbacks h LEFT JOIN jobs j ON j.id = h.job_id
      WHERE h.helper_id = $1 ORDER BY h.created_at DESC LIMIT 50`, [helperId]);
  return {
    helperId,
    counts,
    handbacks: rows.map((r) => ({ id: r.id, jobId: r.job_id, jobTitle: r.job_title, reasonCode: r.reason_code,
      note: r.note, reopenedBidCount: r.reopened_bid_count, createdAt: r.created_at })),
  };
}

module.exports = { forHelper };
