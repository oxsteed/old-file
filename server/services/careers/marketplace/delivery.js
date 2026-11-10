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

async function sendPush(userId, { title, body, actionUrl }) {
  try {
    // eslint-disable-next-line global-require
    const { sendPushToUser } = require('../../../utils/pushNotification');
    await sendPushToUser(userId, { title, body, url: actionUrl, tag: 'careers' });
  } catch (err) {
    logger.warn('careers push failed', { error: err.message });
  }
  try {
    // eslint-disable-next-line global-require
    const mobile = require('../../mobilePushService');
    if (mobile.isConfigured()) await mobile.sendToUser(userId, { title, body, action_url: actionUrl, data: { careers: '1' } });
  } catch (err) {
    logger.warn('careers mobile push failed', { error: err.message });
  }
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
  if (set.has('push') && text) {
    push = true;
    sendPush(userId, { title: text.title, body: text.body, actionUrl }).catch(() => {});
  }
  if (set.has('sms') && text && await smsAllowed(db, userId)) {
    sms = true;
    const link = actionUrl ? ` ${APP_URL()}${actionUrl}` : '';
    sendSms(userId, `${text.title}${link}`).catch(() => {});
  }
  return { ...result, push, sms };
}

module.exports = { deliver, smsAllowed };
