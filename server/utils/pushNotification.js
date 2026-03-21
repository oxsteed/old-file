// Phase 2 — Web Push Notification utility
// OxSteed v2

const webpush = require('web-push');
const pool = require('../db');

let pushConfigured = false;
if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(
    'mailto:' + (process.env.VAPID_EMAIL || 'admin@oxsteed.com'),
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );
  pushConfigured = true;
} else {
  console.warn('VAPID keys not set. Push notification features disabled.');
}

async function sendPushToUser(userId, payload) {
    if (!pushConfigured) {
    console.warn('Push not sent - VAPID not configured');
    return [];
  }
  const { rows: subs } = await pool.query(
    'SELECT id, endpoint, p256dh_key, auth_key FROM push_subscriptions WHERE user_id = $1 AND active = true',
    [userId]
  );

  const results = [];
  for (const sub of subs) {
    const pushSub = {
      endpoint: sub.endpoint,
      keys: { p256dh: sub.p256dh_key, auth: sub.auth_key },
    };
    try {
      await webpush.sendNotification(pushSub, JSON.stringify(payload));
      await pool.query(
        'UPDATE push_subscriptions SET last_used_at = NOW() WHERE id = $1',
        [sub.id]
      );
      results.push({ id: sub.id, success: true });
    } catch (err) {
      if (err.statusCode === 410 || err.statusCode === 404) {
        await pool.query(
          'UPDATE push_subscriptions SET active = false WHERE id = $1',
          [sub.id]
        );
      }
      results.push({ id: sub.id, success: false, error: err.message });
    }
  }
  return results;
}

async function sendPushToAll(payload) {
    if (!pushConfigured) {
    console.warn('Push not sent - VAPID not configured');
    return [];
  }
  const { rows: subs } = await pool.query(
    'SELECT DISTINCT user_id FROM push_subscriptions WHERE active = true'
  );
  const results = [];
  for (const { user_id } of subs) {
    const r = await sendPushToUser(user_id, payload);
    results.push(...r);
  }
  return results;
}

module.exports = { sendPushToUser, sendPushToAll };
