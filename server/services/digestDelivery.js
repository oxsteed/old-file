'use strict';

/**
 * digestDelivery.js — ONE shared delivery path for digest/summary email.
 *
 * Notifications audit, Track D (follow-up: build shared helpers over
 * one-off patches — the AI surfaces batch and Group 5 stack on this
 * branch and reuse them).
 *
 * Weekly summaries flow through sendNotification, whose email leg already
 * honors preferences, email_frequency and the digest queue; reengagement
 * nudges and discover digests used to call sendEmail directly and bypass
 * all of that. They now flow through here instead, so the preference
 * check, email-frequency honoring and digest-queue dead-letter handling
 * live in exactly one place:
 *
 *   - decideEmailDelivery: pure preference/frequency decision.
 *   - loadDigestRecipient: user + notification_preferences in one query.
 *   - deliverDigestEmail: skip (unsubscribed / email off / frequency
 *     off), queue into email_digest_queue (daily/weekly frequency), or
 *     send now (real-time). Never marks anything sent on a failed or
 *     unknown delivery; a failed queue insert falls back to realtime
 *     send (mirroring sendNotification) rather than dropping the mail.
 *
 * The digest queue's dead-letter handling (purge + attempt counting,
 * item 28) lives in this module too and is wired by emailDigestBatch.
 *
 * `queryable` is any { query } object (db, pool, or a fence db) so
 * fenced callers route writes through their fence.
 */

const { sendEmail } = require('../utils/email');
const logger = require('../utils/logger');

/**
 * Pure decision over a loaded recipient. `skipWhenPrefFalse` names extra
 * per-type preference keys that must not be false (e.g. marketing_emails
 * for reengagement mail). Absent preference rows default to allowed
 * (opt-out semantics, matching prefAllows in notificationService).
 */
function decideEmailDelivery(recipient, { skipWhenPrefFalse = [] } = {}) {
  if (!recipient || !recipient.email) return { action: 'skip', reason: 'no_recipient' };
  if (recipient.deletedAt) return { action: 'skip', reason: 'user_deleted' };
  if (recipient.isActive === false) return { action: 'skip', reason: 'user_inactive' };
  const prefs = recipient.prefs || {};
  if (prefs.unsubscribe_all === true) return { action: 'skip', reason: 'unsubscribed_all' };
  if (prefs.email_notifications === false) return { action: 'skip', reason: 'email_notifications_off' };
  for (const key of skipWhenPrefFalse) {
    if (prefs[key] === false) return { action: 'skip', reason: `pref_off:${key}` };
  }
  const frequency = String(prefs.email_frequency || 'real-time');
  if (frequency === 'off') return { action: 'skip', reason: 'frequency_off' };
  if (frequency === 'daily' || frequency === 'weekly') {
    return { action: 'queue', reason: 'frequency_digest', digestType: frequency };
  }
  return { action: 'send', reason: 'real_time' };
}

async function loadDigestRecipient(queryable, userId) {
  const { rows } = await queryable.query(
    `SELECT u.id, u.email, u.first_name, u.preferred_language,
            u.deleted_at, u.is_active,
            np.unsubscribe_all, np.email_notifications, np.email_frequency,
            np.marketing_emails
       FROM users u
       LEFT JOIN notification_preferences np ON np.user_id = u.id
      WHERE u.id = $1`,
    [userId]
  );
  if (!rows.length) return null;
  const row = rows[0];
  return {
    userId: row.id,
    email: row.email,
    firstName: row.first_name,
    preferredLanguage: row.preferred_language,
    deletedAt: row.deleted_at,
    isActive: row.is_active,
    prefs: {
      unsubscribe_all: row.unsubscribe_all,
      email_notifications: row.email_notifications,
      email_frequency: row.email_frequency,
      marketing_emails: row.marketing_emails,
    },
  };
}

/**
 * Deliver one digest/summary email through the shared path.
 * Returns { delivered, queued, reason, digestType?, error? }.
 * `recipient` may be preloaded (loadDigestRecipient) to avoid a second
 * query; otherwise it is loaded here. `deliveryKey` dedupes the digest
 * queue insert and the provider send; pass a stable per-content key.
 */
async function deliverDigestEmail(queryable, {
  userId,
  recipient: preloadedRecipient,
  type,
  subject,
  text,
  html,
  headers,
  deliveryKey,
  skipWhenPrefFalse = [],
}) {
  const recipient = preloadedRecipient || (await loadDigestRecipient(queryable, userId));
  const decision = decideEmailDelivery(recipient, { skipWhenPrefFalse });
  if (decision.action === 'skip') {
    logger.debug('[digestDelivery] email skipped by preference', { userId, type, reason: decision.reason });
    return { delivered: false, queued: false, reason: decision.reason };
  }
  if (decision.action === 'queue') {
    try {
      await queryable.query(
        `INSERT INTO email_digest_queue
           (user_id, notification_id, digest_type, notification_type, title, body, delivery_key)
         VALUES ($1, NULL, $2, $3, $4, $5, $6)
         ON CONFLICT (delivery_key) WHERE delivery_key IS NOT NULL DO NOTHING`,
        [recipient.userId, decision.digestType, type, subject || type, text || '', deliveryKey || null]
      );
      return { delivered: false, queued: true, reason: 'queued_for_digest', digestType: decision.digestType };
    } catch (queueErr) {
      // Fail open on the queue write: the user still gets the email, just
      // immediately instead of in the digest. Never drop it silently.
      logger.warn('[digestDelivery] digest queue insert failed; sending realtime', {
        userId, type, error: queueErr.message,
      });
    }
  }
  let delivery;
  try {
    delivery = await sendEmail({
      to: recipient.email,
      subject,
      ...(html ? { html } : {}),
      ...(text ? { text } : {}),
      ...(headers ? { headers } : {}),
      ...(deliveryKey ? { idempotencyKey: deliveryKey } : {}),
    });
  } catch (err) {
    logger.warn('[digestDelivery] email delivery threw', { userId, type, error: err.message });
    return { delivered: false, queued: false, reason: 'delivery_failed', error: err.message };
  }
  if (delivery?.success) return { delivered: true, queued: false, reason: 'sent' };
  logger.warn('[digestDelivery] email delivery failed', {
    userId, type, error: delivery?.error || 'provider unavailable',
  });
  return { delivered: false, queued: false, reason: 'delivery_failed', error: delivery?.error || 'provider unavailable' };
}

module.exports = {
  decideEmailDelivery,
  loadDigestRecipient,
  deliverDigestEmail,
};
