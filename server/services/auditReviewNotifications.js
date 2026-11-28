'use strict';

// 745 (D-788): the notice leg for audit-review completion. Closing a
// request notifies the requester and every auditor holding an active
// grant, through the shared sendNotification path (in-app row + email
// leg when the type is in the email allow-list), AFTER the close
// commits, so a notice can never fire for a review that did not close,
// and a notice failure can never roll back the close. Failures are
// warn-logged and recorded as deduped medium incidents (the N6 shape),
// never thrown.
//
// The body stays generic (the T entry); the request title rides in
// data, never interpolated into the body.

const { sendNotification } = require('./notificationService');
const logger = require('../utils/logger');

async function recordAuditReviewNoticeIncident({ userId, type, idempotencyKey, error }) {
  try {
    await require('./incidentStore').recordIncident({
      type: 'audit_review_notice_failed',
      severity: 'medium',
      message: `Audit review notice ${type} failed for user ${userId}`,
      dedupeKey: `audit-review-notify:${type}:${idempotencyKey}`,
      details: { userId: String(userId), type, error },
    });
  } catch (incidentError) {
    logger.warn('audit review notice incident failed', { userId: String(userId), type, error: incidentError.message });
  }
}

async function notifyAuditReviewCompleted({ userId, auditRequestId, title }) {
  if (!userId) return null;
  const idempotencyKey = `audit-review-completed:${auditRequestId}:${userId}`;
  try {
    const result = await sendNotification({
      userId: String(userId),
      type: 'audit_review_completed',
      data: { auditRequestId: String(auditRequestId), title: title || null, path: '/statements/audit-requests' },
      action_url: '/statements/audit-requests',
      idempotencyKey,
    });
    if (result && result.success !== true) {
      logger.warn('audit review notice failed', { userId: String(userId), type: 'audit_review_completed', error: result.error || 'send_failed' });
      await recordAuditReviewNoticeIncident({ userId, type: 'audit_review_completed', idempotencyKey, error: result.error || 'send_failed' });
    }
    return result;
  } catch (err) {
    logger.warn('audit review notice failed', { userId: String(userId), type: 'audit_review_completed', error: err.message });
    await recordAuditReviewNoticeIncident({ userId, type: 'audit_review_completed', idempotencyKey, error: err.message });
    return null;
  }
}

module.exports = { notifyAuditReviewCompleted };
