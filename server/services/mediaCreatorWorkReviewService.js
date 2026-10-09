"use strict";
const AppError = require('../utils/appError');

async function activeWorkReview(client, kind, referenceId) {
  const { rows } = await client.query(
    `SELECT * FROM media_creator_work_reviews WHERE kind = $1 AND reference_id = $2 AND status = 'open'`,
    [kind, referenceId]
  );
  return rows[0] || null;
}

// Caller locks the gig/sponsorship first. That lock serializes cancellation,
// submission, settlement, and administrative resolution for the same work.
async function openWorkReview(client, { kind, referenceId, requesterUserId, payerUserId, creatorUserId, reason }) {
  const existing = await activeWorkReview(client, kind, referenceId);
  if (existing) return existing;
  const { rows } = await client.query(
    `INSERT INTO media_creator_work_reviews
       (kind, reference_id, requester_user_id, payer_user_id, creator_user_id, reason)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [kind, referenceId, requesterUserId, payerUserId, creatorUserId, reason]
  );
  if (!rows[0]) throw new AppError('The creator work review could not be saved.', 503, 'media_creator_work_review_transition_failed');
  return rows[0];
}

async function assertNoWorkReview(client, kind, referenceId) {
  if (await activeWorkReview(client, kind, referenceId)) {
    throw new AppError('This creator work is awaiting administrator review.', 409, 'media_creator_work_review_pending');
  }
}
module.exports = { activeWorkReview, openWorkReview, assertNoWorkReview };
