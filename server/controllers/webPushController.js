const db          = require('../db');
const logger      = require('../utils/logger');
const webPush     = require('../services/webPushService');

// ─── GET /api/notifications/webpush/public-key ───────────────
// Public endpoint - the browser needs this BEFORE it can call
// pushManager.subscribe(). No auth required, no PII exposed.
exports.getPublicKey = (_req, res) => {
  return res.json({
    publicKey: webPush.getPublicKey() || null,
    enabled:   webPush.isConfigured(),
  });
};

// ─── POST /api/notifications/webpush/subscribe ───────────────
// Body: { endpoint, keys: { p256dh, auth }, expirationTime?, deviceLabel? }
// One row per (user_id, endpoint). Re-subscribing a known endpoint
// just refreshes its keys + reactivates it.
exports.subscribe = async (req, res) => {
  try {
    const userId = req.user.id;
    const { endpoint, keys = {}, expirationTime = null, deviceLabel = null } = req.body || {};
    const { p256dh, auth } = keys;

    if (!endpoint || !p256dh || !auth) {
      return res.status(400).json({ error: 'endpoint, keys.p256dh, and keys.auth are required.' });
    }
    if (typeof endpoint !== 'string' || endpoint.length > 2048) {
      return res.status(400).json({ error: 'invalid endpoint.' });
    }

    const userAgent = (req.headers['user-agent'] || '').slice(0, 500);
    const label     = (typeof deviceLabel === 'string' ? deviceLabel : '').slice(0, 120) || null;

    const { rows } = await db.query(
      `INSERT INTO push_subscriptions
         (user_id, endpoint, p256dh, auth, user_agent, expiration_time, device_label, active, last_used_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE, now())
       ON CONFLICT (endpoint) DO UPDATE
          SET user_id        = EXCLUDED.user_id,
              p256dh         = EXCLUDED.p256dh,
              auth           = EXCLUDED.auth,
              user_agent     = EXCLUDED.user_agent,
              expiration_time= EXCLUDED.expiration_time,
              device_label   = COALESCE(EXCLUDED.device_label, push_subscriptions.device_label),
              active         = TRUE,
              failure_count  = 0,
              last_failure_at= NULL,
              last_used_at   = now()
       RETURNING id, created_at`,
      [userId, endpoint, p256dh, auth, userAgent, expirationTime, label]
    );

    return res.status(201).json({ subscription: rows[0] });
  } catch (err) {
    logger.error('[WebPush] subscribe failed', { userId: req.user?.id, error: err.message });
    return res.status(500).json({ error: 'Failed to register push subscription.' });
  }
};

// ─── POST /api/notifications/webpush/rotate ──────────────────
// Body: { oldEndpoint, endpoint, keys: { p256dh, auth }, expirationTime }
// Moves an active subscription to the browser's rotated endpoint. Only an
// existing active row can be rotated and it keeps its owner, so this can
// never attach a subscription to a different account.
exports.rotate = async (req, res) => {
  try {
    const { oldEndpoint, endpoint, keys = {}, expirationTime = null } = req.body || {};
    const { p256dh, auth } = keys;
    const valid = (v) => typeof v === 'string' && v.length > 0 && v.length <= 2048;
    if (!valid(oldEndpoint) || !valid(endpoint) || !valid(p256dh) || !valid(auth)) {
      return res.status(400).json({ error: 'oldEndpoint, endpoint, keys.p256dh, and keys.auth are required.' });
    }
    if (!/^https:\/\//.test(endpoint)) {
      return res.status(400).json({ error: 'invalid endpoint.' });
    }
    if (oldEndpoint === endpoint) {
      const { rowCount } = await db.query(
        `UPDATE push_subscriptions SET p256dh = $2, auth = $3, expiration_time = $4,
                failure_count = 0, last_failure_at = NULL, last_used_at = now()
          WHERE endpoint = $1 AND active = TRUE`,
        [endpoint, p256dh, auth, expirationTime]
      );
      return rowCount ? res.json({ rotated: true }) : res.status(404).json({ error: 'Subscription not found.' });
    }
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const { rows: [old] } = await client.query(
        `SELECT user_id, device_label, user_agent FROM push_subscriptions
          WHERE endpoint = $1 AND active = TRUE FOR UPDATE`,
        [oldEndpoint]
      );
      if (!old) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Subscription not found.' });
      }
      await client.query(
        `INSERT INTO push_subscriptions
           (user_id, endpoint, p256dh, auth, user_agent, expiration_time, device_label, active, last_used_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE, now())
         ON CONFLICT (endpoint) DO UPDATE
            SET user_id = EXCLUDED.user_id, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth,
                expiration_time = EXCLUDED.expiration_time, active = TRUE,
                failure_count = 0, last_failure_at = NULL, last_used_at = now()`,
        [old.user_id, endpoint, p256dh, auth, old.user_agent, expirationTime, old.device_label]
      );
      await client.query(`UPDATE push_subscriptions SET active = FALSE WHERE endpoint = $1`, [oldEndpoint]);
      await client.query('COMMIT');
      return res.json({ rotated: true });
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    logger.error('[WebPush] rotate failed', { error: err.message });
    return res.status(500).json({ error: 'Failed to rotate push subscription.' });
  }
};

// ─── DELETE /api/notifications/webpush/subscribe ─────────────
// Body: { endpoint }
// Soft-disables - keeps the row for audit, drops it from fan-out.
exports.unsubscribe = async (req, res) => {
  try {
    const userId   = req.user.id;
    const endpoint = req.body?.endpoint;
    if (!endpoint) return res.status(400).json({ error: 'endpoint required.' });

    await db.query(
      `UPDATE push_subscriptions
          SET active = FALSE
        WHERE user_id = $1 AND endpoint = $2`,
      [userId, endpoint]
    );
    return res.json({ success: true });
  } catch (err) {
    logger.error('[WebPush] unsubscribe failed', { userId: req.user?.id, error: err.message });
    return res.status(500).json({ error: 'Failed to unsubscribe.' });
  }
};

// ─── GET /api/notifications/webpush/devices ──────────────────
// List the user's active devices (for the settings panel).
exports.listDevices = async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT id, endpoint, device_label, user_agent, created_at, last_used_at
         FROM push_subscriptions
        WHERE user_id = $1 AND active = TRUE
        ORDER BY last_used_at DESC NULLS LAST`,
      [req.user.id]
    );
    // Don't leak full endpoints - they're effectively bearer tokens.
    return res.json({
      devices: rows.map(d => ({
        id:           d.id,
        device_label: d.device_label,
        user_agent:   d.user_agent,
        created_at:   d.created_at,
        last_used_at: d.last_used_at,
        endpoint_tail:d.endpoint ? d.endpoint.slice(-24) : null,
      })),
    });
  } catch (err) {
    logger.error('[WebPush] listDevices failed', { userId: req.user?.id, error: err.message });
    return res.status(500).json({ error: 'Failed to list devices.' });
  }
};

// ─── POST /api/notifications/webpush/test ────────────────────
// Sends a test push to all of the caller's active subscriptions -
// useful for the settings UI ("Send a test notification" button).
exports.sendTest = async (req, res) => {
  try {
    if (!webPush.isConfigured()) {
      return res.status(503).json({ error: 'Web push is not configured on this server.' });
    }
    const result = await webPush.sendToUser(req.user.id, {
      title: 'OxSteed test notification',
      body:  'If you can see this, browser push notifications are working.',
      action_url: '/settings/notifications',
      type: 'webpush_test',
    });
    return res.json(result);
  } catch (err) {
    logger.error('[WebPush] sendTest failed', { userId: req.user?.id, error: err.message });
    return res.status(500).json({ error: 'Failed to send test notification.' });
  }
};
