'use strict';

/**
 * middleware/uploadQuota.js
 *
 * Per-user/per-day upload byte quota (review P3-6-F13). The request rate
 * limiters bound request counts, but nothing bounded total bytes: the
 * generic /api/upload surface allowed 500 req/15min/user x 10MB.
 *
 * This middleware atomically reserves the incoming files' bytes against the
 * caller's daily quota (migration 822) and rejects with 429 when the quota
 * would be exceeded. Quota key is the authenticated user id, falling back
 * to the client IP for unauthenticated upload surfaces (public intakes).
 *
 * Failure policy: if the quota store is unreachable, the upload is allowed
 * through (fail open) and the incident is logged. The quota is a cost/abuse
 * bound, not a security boundary: a quota-store outage must not become a
 * total upload outage. The malware scanner in validateFileUpload still
 * fails closed independently.
 */

const pool = require('../db');
const logger = require('../utils/logger');

const DEFAULT_DAILY_QUOTA_BYTES = 1024 * 1024 * 1024; // 1 GiB

function dailyQuotaBytes() {
  const raw = Number.parseInt(process.env.UPLOAD_DAILY_QUOTA_BYTES, 10);
  if (Number.isFinite(raw) && raw > 0) return raw;
  return DEFAULT_DAILY_QUOTA_BYTES;
}

function quotaKeyFor(req) {
  const userId = req.user?.id;
  if (userId !== undefined && userId !== null && String(userId) !== '') {
    return `user:${String(userId)}`;
  }
  const ip = String(req.ip || req.connection?.remoteAddress || 'unknown').slice(0, 64);
  return `ip:${ip}`;
}

function filesFor(req) {
  const files = [];
  if (req.file) files.push(req.file);
  if (req.files) {
    if (Array.isArray(req.files)) files.push(...req.files);
    else Object.values(req.files).forEach((f) => files.push(...(Array.isArray(f) ? f : [f])));
  }
  return files;
}

// Atomically reserve `bytes` against today's quota. Resolves true when the
// reservation fits inside the quota, false when it would exceed it.
async function reserveQuota(userKey, bytes, quotaBytes) {
  const { rows } = await pool.query(
    `INSERT INTO upload_daily_quotas (user_key, day, bytes_used, updated_at)
     VALUES ($1, CURRENT_DATE, $2, NOW())
     ON CONFLICT (user_key, day)
     DO UPDATE SET bytes_used = upload_daily_quotas.bytes_used + EXCLUDED.bytes_used,
                   updated_at = NOW()
     RETURNING bytes_used`,
    [userKey, bytes]
  );
  const used = Number(rows[0]?.bytes_used || 0);
  return used <= quotaBytes;
}

function fileBytes(file) {
  if (!file) return 0;
  // Memory storage: measure the actual (possibly EXIF-stripped) buffer.
  if (Buffer.isBuffer(file.buffer)) return file.buffer.length;
  // Disk storage (e.g. media video uploads): multer still reports the size.
  const size = Number(file.size);
  return Number.isFinite(size) && size > 0 ? Math.floor(size) : 0;
}

async function enforceUploadQuota(req, res, next) {
  const files = filesFor(req);
  if (!files.length) return next();

  const bytes = files.reduce((sum, f) => sum + fileBytes(f), 0);
  if (bytes <= 0) return next();
  const quotaBytes = dailyQuotaBytes();
  const userKey = quotaKeyFor(req);

  try {
    const allowed = await reserveQuota(userKey, bytes, quotaBytes);
    if (!allowed) {
      logger.warn('Upload daily quota exceeded', { userKey, bytes, quotaBytes });
      return res.status(429).json({
        error: 'Daily upload limit reached. Please try again tomorrow.',
        code: 'upload_quota_exceeded',
      });
    }
    return next();
  } catch (err) {
    // Fail open (see module docstring): quota is a cost bound, not security.
    logger.warn('Upload quota check unavailable; allowing upload', { userKey, error: err.message });
    return next();
  }
}

module.exports = enforceUploadQuota;
module.exports.enforceUploadQuota = enforceUploadQuota;
module.exports.dailyQuotaBytes = dailyQuotaBytes;
module.exports.quotaKeyFor = quotaKeyFor;
module.exports.reserveQuota = reserveQuota;
module.exports.fileBytes = fileBytes;
