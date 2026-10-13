'use strict';

/**
 * services/refundNotification.js
 *
 * Review P3-3-F07: Stripe/credit/POS refunds notified nobody. This shared
 * helper tells the money recipient that a refund was issued, through the
 * normal notification fan-out (in-app + socket + push + email). The 'refund'
 * type is already registered in MONEY_CRITICAL_EMAIL_TYPES, so the email
 * reaches the recipient even with marketing mail off, and carries the
 * generic translated refund copy (no new locale keys needed).
 *
 * Always best-effort: it never throws, so a notification outage can never
 * block or roll back a settled refund.
 */

const { sendNotification } = require('./notificationService');
const logger = require('../utils/logger');

async function notifyRefundIssued({
  userId,
  idempotencyKey,
  amountCents = null,
  currency = null,
  surface = null,
  referenceId = null,
  refundId = null,
  actionUrl = null,
}) {
  if (!userId) return { notified: false, reason: 'no_recipient' };
  try {
    await sendNotification({
      userId,
      type: 'refund',
      data: {
        amount_cents: amountCents != null ? Number(amountCents) : null,
        currency: currency || 'USD',
        surface,
        reference_id: referenceId != null ? String(referenceId) : null,
        refund_id: refundId != null ? String(refundId) : null,
      },
      action_url: actionUrl,
      idempotencyKey: idempotencyKey || `refund-issued:${surface || 'unknown'}:${referenceId || 'unknown'}`,
    });
    return { notified: true };
  } catch (err) {
    logger.warn('[refundNotification] refund notification failed', {
      surface,
      referenceId,
      error: err.message,
    });
    return { notified: false, reason: 'send_failed' };
  }
}

module.exports = { notifyRefundIssued };
