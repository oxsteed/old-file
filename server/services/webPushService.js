/**
 * Web Push service — self-hosted via the W3C Push API + VAPID.
 *
 * Decoupled from Expo (mobile native) and Socket.IO (in-app).
 * Sends to every active subscription a user has registered through
 * a browser, deactivating dead endpoints (HTTP 404 / 410) so the
 * subscriptions table stays clean.
 */
const webpush = require('web-push');
const db      = require('../db');
const logger  = require('../utils/logger');

const VAPID_PUBLIC_KEY  = process.env.VAPID_PUBLIC_KEY  || '';
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || '';
const VAPID_SUBJECT     = process.env.VAPID_SUBJECT     || 'mailto:ops@oxsteed.com';

let configured = false;
if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  try {
    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
    configured = true;
  } catch (err) {
    logger.error('[WebPush] Invalid VAPID keys', { error: err.message });
  }
} else {
  logger.warn('[WebPush] VAPID keys not configured — web push disabled');
}

exports.isConfigured = () => configured;
exports.getPublicKey = () => VAPID_PUBLIC_KEY;

// Hard caps — protects pool when fanning out to many devices.
const MAX_FANOUT = 50;

/**
 * Send a payload to every active subscription belonging to a user.
 * Returns { sent, failed, deactivated }.
 */
exports.sendToUser = async (userId, payload) => {
  if (!configured) return { sent: 0, failed: 0, deactivated: 0, skipped: true };

  const { rows: subs } = await db.query(
    `SELECT id, endpoint, p256dh, auth
       FROM push_subscriptions
      WHERE user_id = $1
        AND active = TRUE
        AND p256dh <> 'legacy'
      ORDER BY last_used_at DESC NULLS LAST
      LIMIT $2`,
    [userId, MAX_FANOUT]
  );

  if (!subs.length) return { sent: 0, failed: 0, deactivated: 0 };

  const body = JSON.stringify(payload);
  let sent = 0, failed = 0, deactivated = 0;

  await Promise.all(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          body,
          { TTL: 60 * 60 * 24 } // 24h — drop if the device is offline that long
        );
        sent++;
        // Touch last_used_at without blocking the response.
        db.query(
          `UPDATE push_subscriptions
              SET last_used_at = now(), failure_count = 0
            WHERE id = $1`,
          [sub.id]
        ).catch(() => {});
      } catch (err) {
        failed++;
        const status = err.statusCode || 0;
        // 404 / 410 = subscription expired or unsubscribed. Hard-disable.
        if (status === 404 || status === 410) {
          deactivated++;
          await db.query(
            `UPDATE push_subscriptions
                SET active = FALSE,
                    failure_count = failure_count + 1,
                    last_failure_at = now()
              WHERE id = $1`,
            [sub.id]
          ).catch(() => {});
        } else {
          await db.query(
            `UPDATE push_subscriptions
                SET failure_count = failure_count + 1,
                    last_failure_at = now()
              WHERE id = $1`,
            [sub.id]
          ).catch(() => {});
          logger.warn('[WebPush] Send failed', {
            userId, endpoint: sub.endpoint.slice(0, 60), status, error: err.message
          });
        }
      }
    })
  );

  return { sent, failed, deactivated };
};

/**
 * Send to a single subscription record (used by the test endpoint).
 */
exports.sendToSubscription = async ({ endpoint, p256dh, auth }, payload) => {
  if (!configured) throw new Error('Web push not configured');
  await webpush.sendNotification(
    { endpoint, keys: { p256dh, auth } },
    JSON.stringify(payload),
    { TTL: 60 }
  );
};
