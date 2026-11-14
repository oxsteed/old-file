'use strict';

// Multi-channel delivery for Careers marketplace notices: in-app + Resend
// email through careers/notify (idempotent by delivery key), then optional
// web/mobile push and SMS. SMS is off unless CAREERS_SMS_ENABLED=true, the
// worker opted in on their careers profile, and the existing
// smsNotificationService preconditions pass (verified phone, SMS master
// toggle, sms_careers preference). Logs never carry message text or phone.

const crypto = require('crypto');
const logger = require('../../../utils/logger');
const { notifyUser, render, emailHtml } = require('../notify');
const { smsConfig } = require('../providers/config');

const APP_URL = () => String(process.env.CLIENT_URL || process.env.APP_URL || 'https://oxsteed.com').replace(/\/+$/, '');

// Domain 8 #23: the send reports its actual outcome. The old code
// swallowed every failure and the caller set push=true before the send
// even ran, so a failed push/SMS came back reported as delivered.
// Returns true only when at least one channel actually delivered: a
// web-push result with a success, or a mobile send that resolved with
// at least one sent token. A throw, an empty subscription set, or an
// unconfigured channel counts as not delivered.
async function sendPush(userId, { title, body, actionUrl, tag }) {
  let sent = false;
  try {
    // eslint-disable-next-line global-require
    const { sendPushToUser } = require('../../../utils/pushNotification');
    const results = await sendPushToUser(userId, { title, body, url: actionUrl, tag });
    if (Array.isArray(results) && results.some((r) => r && r.success)) sent = true;
  } catch (err) {
    logger.warn('careers push failed', { error: err.message });
  }
  try {
    // eslint-disable-next-line global-require
    const mobile = require('../../mobilePushService');
    if (mobile.isConfigured()) {
      const result = await mobile.sendToUser(userId, {
        title, body, action_url: actionUrl, data: { careers: '1', tag },
      });
      if (!result || result.sent == null || Number(result.sent) > 0) sent = true;
    }
  } catch (err) {
    logger.warn('careers mobile push failed', { error: err.message });
  }
  return sent;
}

async function smsAllowed(db, userId) {
  if (!smsConfig().enabled) return false;
  const { rows: [p] } = await db.query('SELECT sms_opt_in FROM career_profiles WHERE user_id = $1', [userId]);
  return Boolean(p?.sms_opt_in);
}

async function sendSms(userId, text) {
  try {
    // eslint-disable-next-line global-require
    const { sendSMSIfOptedIn } = require('../../smsNotificationService');
    return await sendSMSIfOptedIn(userId, text.slice(0, 300), 'careers');
  } catch (err) {
    logger.warn('careers sms failed', { error: err.message });
    return false;
  }
}

/**
 * channels: subset of ['in_app','email','push','sms']. In-app is always
 * written (it is the idempotency record); email/push/SMS follow it only on
 * a fresh insert, so retries never double-send.
 */
async function deliver(db, { userId, type, params = {}, actionUrl = null, deliveryKey, channels = ['in_app', 'email'], attachments }) {
  const set = new Set(channels);
  const result = await notifyUser(db, { userId, type, params, actionUrl, deliveryKey, email: set.has('email'), attachments });
  if (!result.inserted) return { ...result, push: false, sms: false };
  let push = false;
  let sms = false;
  const needsText = set.has('push') || set.has('sms');
  let text = null;
  if (needsText) {
    const { rows: [u] } = await db.query('SELECT preferred_language FROM users WHERE id = $1', [userId]);
    text = render(type, u?.preferred_language, params);
  }
  // Domain 8 #23: await the sends and report their actual outcomes
  // (true only when the send resolved successfully). The per-event tag
  // is the delivery key, so distinct alerts no longer collapse into
  // one 'careers' notification (Nov 11 mobile-audit M3 pattern).
  const tag = `careers:${deliveryKey || type}`;
  if (set.has('push') && text) {
    push = await sendPush(userId, { title: text.title, body: text.body, actionUrl, tag });
  }
  if (set.has('sms') && text && await smsAllowed(db, userId)) {
    const link = actionUrl ? ` ${APP_URL()}${actionUrl}` : '';
    sms = Boolean(await sendSms(userId, `${text.title}${link}`));
  }
  return { ...result, push, sms };
}

const EMAIL_BATCH_SIZE = 100;
const OUTBOX_MAX_ATTEMPTS = 5;
const MAX_DRAIN_PER_CALL = 500;

/**
 * Batched delivery for fan-out sends (follower notifications): one
 * multi-row INSERT for the in-app rows (idempotent by delivery key), one
 * multi-row INSERT into the durable email outbox for the fresh rows, and
 * fire-and-forget push for the fresh rows only. No email is sent inline:
 * the outbox drain sends in bounded sendEmailBatch calls (≤100 per
 * provider call), so a tick never fires one Resend call per follower.
 * SMS is not supported here; callers that need it use deliver().
 *
 * recipients: [{ userId, email, preferredLanguage }]
 * keyFor: (userId) => deliveryKey for that recipient
 * Returns { inserted: [userId...], queued: n }.
 */
async function deliverBatch(db, { type, params = {}, actionUrl = null, keyFor, channels = ['in_app', 'email'], recipients = [] }) {
  if (!recipients.length) return { inserted: [], queued: 0 };
  const set = new Set(channels);
  const data = JSON.stringify({ params, careers: true });
  const rendered = recipients.map((r) => {
    const text = render(type, r.preferredLanguage, params);
    return { ...r, title: text.title.slice(0, 255), body: text.body, language: text.language };
  });
  const { rows: fresh } = await db.query(
    `INSERT INTO notifications (user_id, type, title, body, data, action_url, delivery_key)
     SELECT x.user_id, $1, x.title, x.body, $2, $3, x.delivery_key
       FROM unnest($4::uuid[], $5::text[], $6::text[], $7::text[]) AS x(user_id, title, body, delivery_key)
      ON CONFLICT (delivery_key) WHERE delivery_key IS NOT NULL DO NOTHING
      RETURNING user_id, id, delivery_key`,
    [type, data, actionUrl,
     rendered.map((r) => r.userId), rendered.map((r) => r.title),
     rendered.map((r) => r.body), rendered.map((r) => keyFor(r.userId))]
  );
  const byId = new Map(rendered.map((r) => [String(r.userId), r]));
  let queued = 0;
  if (set.has('email')) {
    const emailable = fresh.filter((f) => byId.get(String(f.user_id))?.email);
    if (emailable.length) {
      const { rowCount } = await db.query(
        `INSERT INTO career_email_outbox (delivery_key, notification_id, user_id, email, language, type, params, action_url)
         SELECT x.delivery_key, x.notification_id, x.user_id, x.email, x.language, $1, $2, $3
           FROM unnest($4::text[], $5::bigint[], $6::uuid[], $7::text[], $8::text[])
                AS x(delivery_key, notification_id, user_id, email, language)
          ON CONFLICT (delivery_key) DO NOTHING`,
        [type, JSON.stringify(params), actionUrl,
         emailable.map((f) => f.delivery_key), emailable.map((f) => Number(f.id)),
         emailable.map((f) => f.user_id), emailable.map((f) => byId.get(String(f.user_id)).email),
         emailable.map((f) => byId.get(String(f.user_id)).language)]
      );
      queued = rowCount;
    }
  }
  if (set.has('push')) {
    for (const f of fresh) {
      const r = byId.get(String(f.user_id));
      if (r) sendPush(f.user_id, { title: r.title, body: r.body, actionUrl }).catch(() => {});
    }
  }
  return { inserted: fresh.map((f) => f.user_id), queued };
}

/**
 * Drain pending fan-out emails in bounded batches. Claims rows with
 * FOR UPDATE SKIP LOCKED so concurrent ticks never send the same row
 * twice; a failed batch stays pending (attempts + 1) for the next drain
 * and is marked failed after OUTBOX_MAX_ATTEMPTS. Returns
 * { sent, failed, skipped } — skipped when no batch sender is available
 * (e.g. email unconfigured in tests), in which case rows stay pending.
 */
async function drainCareerEmailOutbox(db, { limit = MAX_DRAIN_PER_CALL } = {}) {
  let sendEmailBatch;
  try {
    ({ sendEmailBatch } = require('../../../utils/email'));
  } catch {
    return { sent: 0, failed: 0, skipped: true };
  }
  if (typeof sendEmailBatch !== 'function') return { sent: 0, failed: 0, skipped: true };
  const { rows: claimed } = await db.query(
    `UPDATE career_email_outbox SET status = 'sending', attempts = attempts + 1
      WHERE id IN (
        SELECT id FROM career_email_outbox
         WHERE status = 'pending' AND attempts < $2
         ORDER BY created_at ASC LIMIT $1
         FOR UPDATE SKIP LOCKED
      )
      RETURNING *`,
    [Math.min(Number(limit) || MAX_DRAIN_PER_CALL, MAX_DRAIN_PER_CALL), OUTBOX_MAX_ATTEMPTS]
  );
  if (!claimed.length) return { sent: 0, failed: 0 };
  let sent = 0;
  let failed = 0;
  for (let i = 0; i < claimed.length; i += EMAIL_BATCH_SIZE) {
    const chunk = claimed.slice(i, i + EMAIL_BATCH_SIZE);
    const messages = chunk.map((row) => {
      const { title, body } = render(row.type, row.language, row.params || {});
      const url = row.action_url ? `${APP_URL()}${row.action_url.startsWith('/') ? '' : '/'}${row.action_url}` : null;
      return {
        to: row.email,
        subject: title,
        text: url ? `${body}\n\n${url}` : body,
        html: emailHtml({ title, body, url, lang: row.language }),
      };
    });
    const idempotencyKey = `career-outbox:${crypto.createHash('sha256').update(JSON.stringify(chunk.map((r) => r.delivery_key))).digest('hex')}`;
    try {
      await sendEmailBatch(messages, { idempotencyKey });
      await db.query(
        "UPDATE career_email_outbox SET status = 'sent', sent_at = NOW() WHERE id = ANY($1::bigint[])",
        [chunk.map((r) => Number(r.id))]
      );
      sent += chunk.length;
    } catch (err) {
      failed += chunk.length;
      await db.query(
        `UPDATE career_email_outbox
            SET status = CASE WHEN attempts >= $2 THEN 'failed' ELSE 'pending' END, last_error = $3
          WHERE id = ANY($1::bigint[])`,
        [chunk.map((r) => Number(r.id)), OUTBOX_MAX_ATTEMPTS, String(err?.message || err).slice(0, 500)]
      );
      logger.warn('careers email outbox batch failed', { count: chunk.length, error: err.message });
    }
  }
  return { sent, failed };
}

module.exports = { deliver, deliverBatch, drainCareerEmailOutbox, smsAllowed };
