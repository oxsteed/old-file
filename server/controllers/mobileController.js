const pool = require('../db');
const AppError = require('../utils/AppError');

const VALID_PROVIDERS = new Set(['apns', 'fcm']);
const VALID_PLATFORMS = new Set(['ios', 'android', 'web']);

function normalizeString(value, maxLength) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, maxLength);
}

exports.registerPushToken = async (req, res, next) => {
  try {
    const token = normalizeString(req.body.token, 4096);
    const provider = normalizeString(req.body.provider, 20);
    const platform = normalizeString(req.body.platform, 20);
    const deviceId = normalizeString(req.body.device_id, 512);
    const appVersion = normalizeString(req.body.app_version, 64);
    const device = req.body.device && typeof req.body.device === 'object' ? req.body.device : {};

    if (!token) {
      throw new AppError('Push token is required', 400, 'validation_failed', {
        token: 'Required',
      });
    }
    if (!VALID_PROVIDERS.has(provider)) {
      throw new AppError('Provider must be apns or fcm', 400, 'validation_failed', {
        provider: 'Must be apns or fcm',
      });
    }
    if (platform && !VALID_PLATFORMS.has(platform)) {
      throw new AppError('Platform must be ios, android, or web', 400, 'validation_failed', {
        platform: 'Must be ios, android, or web',
      });
    }

    const { rows } = await pool.query(
      `INSERT INTO mobile_push_tokens (
         user_id, token, provider, platform, device_id, app_version, device,
         enabled, disabled_at, updated_at, last_seen_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, TRUE, NULL, NOW(), NOW())
       ON CONFLICT (token)
       DO UPDATE SET
         user_id = EXCLUDED.user_id,
         provider = EXCLUDED.provider,
         platform = EXCLUDED.platform,
         device_id = EXCLUDED.device_id,
         app_version = EXCLUDED.app_version,
         device = EXCLUDED.device,
         enabled = TRUE,
         disabled_at = NULL,
         updated_at = NOW(),
         last_seen_at = NOW()
       RETURNING id, provider, platform, enabled, last_seen_at`,
      [
        req.user.id,
        token,
        provider,
        platform,
        deviceId,
        appVersion,
        JSON.stringify(device),
      ]
    );

    res.json({ success: true, data: rows[0] });
  } catch (err) {
    next(err);
  }
};

exports.unregisterPushToken = async (req, res, next) => {
  try {
    const token = normalizeString(req.body.token, 4096);
    if (!token) {
      throw new AppError('Push token is required', 400, 'validation_failed', {
        token: 'Required',
      });
    }

    await pool.query(
      `UPDATE mobile_push_tokens
       SET enabled = FALSE, disabled_at = NOW(), updated_at = NOW()
       WHERE user_id = $1 AND token = $2`,
      [req.user.id, token]
    );

    res.json({ success: true });
  } catch (err) {
    next(err);
  }
};
