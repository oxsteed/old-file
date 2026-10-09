"use strict";
const pool = require('../db');
const AppError = require('../utils/appError');
const auditService = require('../services/auditService');
const { queueCreatorNotification, deliverCreatorNotification } = require('../services/mediaCreatorNotificationService');
const { getActiveReservation, releaseReservation } = require('../services/oxsteedCreditReservationService');

async function listWorkReviews(req, res, next) {
  try {
    const status = req.query.status || 'open';
    if (!['open','released','resumed'].includes(status)) throw new AppError('Work review status is invalid.', 400, 'media_creator_work_review_status_invalid');
    const { rows } = await pool.query(
      `SELECT r.*, CONCAT_WS(' ', payer.first_name, payer.last_name) AS payer_name, CONCAT_WS(' ', creator.first_name, creator.last_name) AS creator_name
         FROM media_creator_work_reviews r JOIN users payer ON payer.id = r.payer_user_id
         JOIN users creator ON creator.id = r.creator_user_id
        WHERE r.status = $1 ORDER BY r.created_at, r.id LIMIT 100`, [status]
    );
    res.json({ workReviews: rows });
  } catch (err) { next(err); }
}

async function resolveWorkReview(req, res, next) {
  const decision = req.body?.decision;
  const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
  if (!['release','resume'].includes(decision) || reason.length < 3 || reason.length > 4000) {
    return next(new AppError('A release or resume decision and reason are required.', 400, 'media_creator_work_review_decision_invalid'));
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: pointers } = await client.query(`SELECT kind, reference_id FROM media_creator_work_reviews WHERE id = $1`, [req.params.reviewId]);
    if (!pointers[0]) throw new AppError('Creator work review not found.', 404, 'media_creator_work_review_not_found');
    const { kind, reference_id: referenceId } = pointers[0];
    const table = kind === 'gig' ? 'media_creator_gigs' : 'media_creator_sponsorships';
    // Lock work before its review, matching publishing/cancellation order.
    const { rows: works } = await client.query(`SELECT * FROM ${table} WHERE id = $1 FOR UPDATE`, [referenceId]);
    const { rows: reviews } = await client.query(`SELECT * FROM media_creator_work_reviews WHERE id = $1 FOR UPDATE`, [req.params.reviewId]);
    const review = reviews[0]; const work = works[0];
    if (!review || !work) throw new AppError('Creator work review not found.', 404, 'media_creator_work_review_not_found');
    const targetStatus = decision === 'release' ? 'released' : 'resumed';
    if (review.status !== 'open') {
      if (review.status !== targetStatus || review.decision_reason !== reason) throw new AppError('This review was resolved with a different decision.', 409, 'media_creator_work_review_conflict');
      await client.query('COMMIT'); return res.json({ workReview: review, replayed: true });
    }
    if (work.credit_transaction_id || ['completed','cancelled'].includes(work.status)) throw new AppError('Creator work no longer has an unresolved reservation.', 409, 'media_creator_work_review_state_invalid');
    if (decision === 'release') {
      const reservation = await getActiveReservation(client, { referenceType: `media_creator_${kind}`, referenceId });
      const amount = kind === 'gig' ? work.award_amount_cents : work.amount_cents;
      if (!reservation || String(reservation.id) !== String(work.credit_reservation_id) || Number(reservation.amountCents) !== Number(amount)) throw new AppError('Credit reservation does not match the work under review.', 409, 'media_creator_reservation_mismatch');
      const released = await releaseReservation(client, { reservationId: reservation.id, reason: `Admin work review: ${reason}` });
      if (!released.released) throw new AppError('The reserved Credit could not be released.', 409, 'media_creator_reservation_mismatch');
      await client.query(`UPDATE ${table} SET status = 'cancelled', updated_at = NOW() WHERE id = $1`, [referenceId]);
      if (kind === 'gig') await client.query(`UPDATE media_creator_applications SET status = 'rejected', updated_at = NOW() WHERE gig_id = $1 AND status IN ('awarded','delivered')`, [referenceId]);
    } else if (kind === 'gig') {
      await client.query(`UPDATE media_creator_deliverables SET status = 'changes_requested', reviewed_at = NOW() WHERE application_id IN (SELECT id FROM media_creator_applications WHERE gig_id = $1 AND status IN ('awarded','delivered')) AND status IN ('submitted','rejected')`, [referenceId]);
      await client.query(`UPDATE media_creator_applications SET status = 'awarded', updated_at = NOW() WHERE gig_id = $1 AND status = 'delivered'`, [referenceId]);
    } else {
      await client.query(`UPDATE media_creator_sponsorships SET status = 'accepted', review_note = $2, updated_at = NOW() WHERE id = $1`, [referenceId, reason]);
    }
    const { rows: updated } = await client.query(
      `UPDATE media_creator_work_reviews SET status = $2, decision_reason = $3, resolved_by = $4, resolved_at = NOW()
        WHERE id = $1 AND status = 'open' RETURNING *`, [review.id, targetStatus, reason, req.user.id]
    );
    if (!updated[0]) throw new AppError('Work review resolution could not be saved.', 503, 'media_creator_work_review_transition_failed');
    await auditService.logAdminAction({ adminId: req.user.id, action: `media_creator_work_${targetStatus}`, targetType: 'media_creator_work_review', targetId: review.id, description: reason, before: review, after: updated[0], req, client, throwOnError: true });
    const notifications = await Promise.all([review.payer_user_id, review.creator_user_id].map(userId => queueCreatorNotification(client, { userId, event: `work_${targetStatus}`, referenceId: review.id })));
    await client.query('COMMIT');
    await Promise.all(notifications.map(deliverCreatorNotification));
    res.json({ workReview: updated[0] });
  } catch (err) { await client.query('ROLLBACK').catch(() => {}); next(err); }
  finally { client.release(); }
}
module.exports = { listWorkReviews, resolveWorkReview };
