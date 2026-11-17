/**
 * Web Push service - self-hosted via the W3C Push API + VAPID.
 *
 * Decoupled from Expo (mobile native) and Socket.IO (in-app).
 * Sends to every active subscription a user has registered through
 * a browser, deactivating dead endpoints so the subscriptions table
 * stays clean.
 *
 * Failure semantics (M5):
 * - failure_count is CONSECUTIVE: a successful send resets it to 0
 *   (here and in webPushController subscribe/rotate), so reaching
 *   MAX_CONSECUTIVE_FAILURES means the endpoint is dead, not flaky.
 * - 400/404/410/413 prove the subscription itself is invalid, so the
 *   row is deactivated at once instead of waiting out that budget.
 * - 429 is a provider-side throttle, not a dead endpoint: it does not
 *   increment failure_count and never deactivates, but it aborts the
 *   rest of this notification's fan-out (see below). The subscriptions
 *   skipped by the abort (never attempted, plus the ones that received
 *   the 429) are recorded and re-attempted exactly once after a short
 *   backoff, in the same call; if the retry pass is throttled again it
 *   aborts too and the still-unattempted subscriptions are reported as
 *   dropped for this notification instead of being retried again.
 * - Fan-out runs at most FANOUT_CONCURRENCY provider requests at once,
 *   in chunks; MAX_FANOUT bounds how many subscriptions one
 *   notification touches, FANOUT_CONCURRENCY bounds how many of those
 *   are attempted concurrently.
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
  logger.warn('[WebPush] VAPID keys not configured - web push disabled');
}

exports.isConfigured = () => configured;
exports.getPublicKey = () => VAPID_PUBLIC_KEY;

// Hard caps - protects pool when fanning out to many devices.
const MAX_FANOUT = 50;
// Consecutive failures after which an endpoint is treated as dead. The
// count resets to 0 on any successful send, so this is five failures in a
// row with no success in between, not five failures over the row's life.
const MAX_CONSECUTIVE_FAILURES = 5;
// At most this many push-provider requests in flight at once.
const FANOUT_CONCURRENCY = 5;
// Single bounded retry after a 429 abort: how long to wait before the one
// retry pass (ms), and the cap applied to a provider Retry-After header.
// One pass only, never a queue: a second 429 ends the retry, and the
// still-unattempted subscriptions are reported as dropped rather than
// retried again. WEBPUSH_429_RETRY_BACKOFF_MS overrides the default.
const RATE_LIMIT_RETRY_BACKOFF_MS = 2000;
const RATE_LIMIT_RETRY_MAX_BACKOFF_MS = 10000;
// Statuses that prove the subscription itself is invalid, not the network:
// deactivate at once instead of waiting out the consecutive-failure budget.
const IMMEDIATE_DEACTIVATE_STATUSES = new Set([400, 404, 410, 413]);

exports.MAX_FANOUT = MAX_FANOUT;
exports.MAX_CONSECUTIVE_FAILURES = MAX_CONSECUTIVE_FAILURES;
exports.FANOUT_CONCURRENCY = FANOUT_CONCURRENCY;
exports.RATE_LIMIT_RETRY_BACKOFF_MS = RATE_LIMIT_RETRY_BACKOFF_MS;
exports.RATE_LIMIT_RETRY_MAX_BACKOFF_MS = RATE_LIMIT_RETRY_MAX_BACKOFF_MS;

// Backoff (ms) before the single retry pass after a 429 abort: an explicit
// WEBPUSH_429_RETRY_BACKOFF_MS wins, then the provider's Retry-After header
// on the first 429 (capped), then the default. Read at call time so tests
// and operators can override it without a restart.
function retryBackoffMs(retryAfterMs) {
  const override = Number(process.env.WEBPUSH_429_RETRY_BACKOFF_MS);
  if (Number.isFinite(override) && override >= 0) return override;
  if (retryAfterMs !== null && retryAfterMs !== undefined) return retryAfterMs;
  return RATE_LIMIT_RETRY_BACKOFF_MS;
}

// Milliseconds to wait per the provider's Retry-After header (seconds) on a
// 429, capped so a large header cannot stall the caller; null when the
// error carries no usable header.
function retryAfterMsFromError(err) {
  const headers = (err && err.headers) || {};
  const raw = headers['retry-after'] || headers['Retry-After'];
  const seconds = Number(raw);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  return Math.min(Math.floor(seconds * 1000), RATE_LIMIT_RETRY_MAX_BACKOFF_MS);
}

// Push TTL (seconds) by notification type. A stale alert is worse than a
// missed one for anything time-sensitive: a "food ready", order, job,
// booking, or message update delivered a day late misleads more than it
// helps, so those get 1 hour. Offers stay relevant until the campaign
// expires, but a day-old offer tap usually lands on dead inventory, so
// they get 6 hours. Everything else (account, admin, compliance alerts)
// keeps the 24h default: a day-late account alert is still worth reading.
const TTL_DEFAULT_SECONDS = 60 * 60 * 24;
const TTL_TIME_SENSITIVE_SECONDS = 60 * 60;
const TTL_OFFER_SECONDS = 6 * 60 * 60;
const TIME_SENSITIVE_TYPE_PREFIXES = [
  'food_', 'job_', 'order_', 'delivery_', 'booking_', 'appointment_',
  'bid_', 'message_', 'new_message', 'cart_', 'draft_', 'payment_',
];
function ttlForNotificationType(type) {
  const t = String(type || '');
  if (t === 'growth_offer' || t.startsWith('offer_')) return TTL_OFFER_SECONDS;
  if (TIME_SENSITIVE_TYPE_PREFIXES.some((prefix) => t.startsWith(prefix))) {
    return TTL_TIME_SENSITIVE_SECONDS;
  }
  return TTL_DEFAULT_SECONDS;
}
exports.ttlForNotificationType = ttlForNotificationType;

/**
 * Send a payload to every active subscription belonging to a user.
 * Returns { sent, failed, deactivated, rateLimited, retried, dropped }.
 *
 * 429 semantics: the push provider is throttling us. The remaining
 * subscriptions in this fan-out are NOT attempted immediately: retrying
 * them now would deepen the throttle and burn quota. The skipped
 * subscriptions (never attempted, plus the ones that received the 429)
 * are recorded and re-attempted exactly ONCE, for this notification,
 * after a short backoff (RATE_LIMIT_RETRY_BACKOFF_MS, or the provider's
 * Retry-After header when present, capped at
 * RATE_LIMIT_RETRY_MAX_BACKOFF_MS). If the retry pass is throttled
 * again it aborts too: no further passes, no queue, and the
 * subscriptions still unattempted are reported as `dropped` for this
 * notification. They stay active and are re-attempted by a later
 * notification as before. Only sends already attempted count as
 * sent/failed. Sends already in flight when the 429 lands run to
 * completion; the abort takes effect between chunks.
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

  if (!subs.length) return { sent: 0, failed: 0, deactivated: 0, retried: 0, dropped: 0 };

  const body = JSON.stringify(payload);
  let sent = 0, failed = 0, deactivated = 0;
  let rateLimited = false;
  // Subscriptions the 429 abort skipped: never attempted in the main pass,
  // plus the ones that received the 429 itself. Recorded here so the single
  // retry pass below re-attempts this notification for them instead of
  // leaving them to a later, unrelated notification.
  const attempted = new Set();
  const throttled = [];
  let retryAfterMs = null;

  // One chunked pass over `list`. Returns { passRateLimited, attempted }.
  // A 429 inside the pass aborts only that pass, between chunks.
  async function attempt(list) {
    let passRateLimited = false;
    let attemptedInPass = 0;
    for (let i = 0; i < list.length && !passRateLimited; i += FANOUT_CONCURRENCY) {
      const chunk = list.slice(i, i + FANOUT_CONCURRENCY);
      await Promise.all(
        chunk.map(async (sub) => {
          attempted.add(sub.id);
          attemptedInPass += 1;
          try {
            await webpush.sendNotification(
              { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
              body,
              { TTL: ttlForNotificationType(payload?.type) }
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
            if (status === 429) {
              // Provider throttle, not a dead endpoint: do not count it
              // against the subscription and never deactivate on it.
              passRateLimited = true;
              rateLimited = true;
              throttled.push(sub);
              if (retryAfterMs === null) retryAfterMs = retryAfterMsFromError(err);
              logger.warn('[WebPush] Provider throttled fan-out; aborting remaining sends', {
                userId, endpoint: sub.endpoint.slice(0, 60), status, error: err.message
              });
              return;
            }
            if (IMMEDIATE_DEACTIVATE_STATUSES.has(status)) {
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
              // Deactivate once the consecutive-failure budget is spent.
              const { rowCount } = await db.query(
                `UPDATE push_subscriptions
                    SET active = FALSE
                  WHERE id = $1 AND failure_count >= $2`,
                [sub.id, MAX_CONSECUTIVE_FAILURES]
              ).catch(() => ({ rowCount: 0 }));
              if (rowCount > 0) deactivated++;
              logger.warn('[WebPush] Send failed', {
                userId, endpoint: sub.endpoint.slice(0, 60), status, error: err.message
              });
            }
          }
        })
      );
    }
    return { passRateLimited, attempted: attemptedInPass };
  }

  await attempt(subs);

  // Single bounded retry pass for the subscriptions the 429 abort skipped.
  // Not a queue: this runs once, in this call, after a short backoff. If
  // the retry pass is throttled again it aborts and the still-unattempted
  // subscriptions are reported as dropped (they stay active; a later
  // notification re-attempts them). Nothing here survives a process crash
  // during the backoff window; see the residual note in the receipt.
  let retried = 0;
  let dropped = 0;
  if (rateLimited) {
    const pending = subs.filter((s) => !attempted.has(s.id)).concat(throttled);
    if (pending.length) {
      const backoffMs = retryBackoffMs(retryAfterMs);
      logger.warn('[WebPush] Retrying 429-skipped subscriptions once after backoff', {
        userId, pending: pending.length, backoffMs
      });
      await new Promise((resolve) => setTimeout(resolve, backoffMs));
      const retryResult = await attempt(pending);
      retried = retryResult.attempted;
      dropped = pending.length - retried;
      logger.warn('[WebPush] 429 retry pass finished', {
        userId, retried, dropped, sent, failed
      });
    }
  }

  return { sent, failed, deactivated, rateLimited, retried, dropped };
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
