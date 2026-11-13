'use strict';

// Money-flows W3: the erasure lifecycle sent no notification at any step,
// so a requested erasure could sit undecided indefinitely with no manager
// ever told, and the subject was never told their request was approved,
// rejected, or completed.
//
// Every helper here is best-effort and never throws: a notification
// failure must never fail (or roll back) the erasure step it reports on.
// Each send carries an idempotency key, so a retried step notifies once.

const { sendNotification } = require('./notificationService');
const logger = require('../utils/logger');

async function listErasureManagers(db, businessId) {
  const { rows } = await db.query(
    `SELECT member_id AS user_id FROM business_members
        WHERE business_id = $1 AND status = 'active' AND role IN ('owner', 'manager')
       UNION
       SELECT user_id FROM businesses WHERE id = $1`,
    [businessId]
  );
  return rows.map((r) => r.user_id).filter(Boolean);
}

async function subjectDisplayName(db, userId) {
  try {
    const { rows: [row] } = await db.query(
      `SELECT COALESCE(display_name_preference, first_name || ' ' || last_name) AS name
         FROM users WHERE id = $1`,
      [userId]
    );
    return (row?.name || '').trim() || 'A team member';
  } catch {
    return 'A team member';
  }
}

// Notify every active owner/manager that an erasure was requested, so the
// request surfaces instead of sitting undecided.
async function notifyErasureManagers(db, { businessId, restaurantId, requestId, subjectUserId }) {
  try {
    const managers = await listErasureManagers(db, businessId);
    const name = await subjectDisplayName(db, subjectUserId);
    for (const managerId of managers) {
      await sendNotification({
        userId: managerId,
        type: 'restaurant_erasure_requested',
        title: 'A data erasure request needs review',
        body: `${name} requested erasure of their personal data. Review the request and approve or reject it.`,
        data: {
          business_id: Number(businessId),
          restaurant_id: restaurantId == null ? null : Number(restaurantId),
          erasure_request_id: Number(requestId),
          user_id: subjectUserId,
        },
        action_url: '/restaurants/merchant?tab=operations',
        idempotencyKey: `erasure-requested:${requestId}:${managerId}`,
      });
    }
    return { notified: managers.length };
  } catch (err) {
    logger.warn('Erasure notification to managers failed', { requestId, error: err.message });
    return { notified: 0, error: err.message };
  }
}

// Notify the subject of a decision (approved/rejected) or a completion.
// The subject is the request's user_id, which may differ from the person
// who filed the request (a manager can file for someone else).
async function notifyErasureSubject(db, { userId, businessId, restaurantId, requestId, status, decision = null }) {
  try {
    const isCompletion = status === 'completed';
    const title = isCompletion
      ? 'Your data erasure is complete'
      : decision === 'approved'
        ? 'Your data erasure request was approved'
        : 'Your data erasure request was rejected';
    const body = isCompletion
      ? 'Your personal data has been erased from the restaurant records. Wage-and-hour history is retained without personal content, as required by law.'
      : decision === 'approved'
        ? 'Your data erasure request was approved. It will be completed once the retention period for your records has expired.'
        : 'Your data erasure request was rejected. Contact a manager if you believe this is a mistake.';
    await sendNotification({
      userId,
      type: isCompletion ? 'restaurant_erasure_completed' : 'restaurant_erasure_decided',
      title,
      body,
      data: {
        business_id: Number(businessId),
        restaurant_id: restaurantId == null ? null : Number(restaurantId),
        erasure_request_id: Number(requestId),
        ...(decision ? { decision } : {}),
      },
      idempotencyKey: isCompletion
        ? `erasure-completed:${requestId}`
        : `erasure-decided:${requestId}`,
    });
    return { notified: 1 };
  } catch (err) {
    logger.warn('Erasure notification to requester failed', { requestId, error: err.message });
    return { notified: 0, error: err.message };
  }
}

module.exports = { notifyErasureManagers, notifyErasureSubject };
