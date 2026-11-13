'use strict';

// Multi-channel delivery for Careers marketplace notices: in-app + Resend
// email through careers/notify (idempotent by delivery key), then optional
// web/mobile push and SMS. SMS is off unless CAREERS_SMS_ENABLED=true, the
// worker opted in on their careers profile, and the existing
// smsNotificationService preconditions pass (verified phone, SMS master
// toggle, sms_careers preference). Logs never carry message text or phone.

const logger = require('../../../utils/logger');
const { notifyUser, render } = require('../notify');
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

module.exports = { deliver, smsAllowed };
