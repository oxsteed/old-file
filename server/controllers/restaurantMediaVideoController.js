'use strict';

/**
 * controllers/restaurantMediaVideoController.js
 *
 * Restaurant Media device-upload pipeline (migration 665): direct video file
 * uploads with a quarantine-first pipeline.
 *
 * IRON RULE: every uploaded video starts in processing_status='quarantine' and
 * is NEVER publicly visible until ALL gates pass: (1) the CSAM check passes,
 * (2) the transcode completes. No gate may be skipped by configuration — when
 * the worker is disabled or ffmpeg is missing, videos simply stay quarantined.
 *
 * Routes (server/routes/restaurants.js, mounted at /api/restaurants):
 *   POST /:restaurantId/media/video-uploads   auth, 3/day per user, 202 on accept
 *   POST /:restaurantId/media/:mediaId/retry  auth, poster | owner | moderator
 *
 * Admin (server/routes/adminRestaurantMedia.js):
 *   the flag-review endpoint routes {action:'remove', takedownReason:'dmca'}
 *   here for the DMCA takedown flow.
 *
 * Upload flow (fail closed at every step; temp file cleaned up in all paths):
 *   1. multer disk storage (never buffers a 200MB upload in memory),
 *      200MB cap (VIDEO_UPLOAD_MAX_BYTES override, default 200MB).
 *   2. Magic-bytes validation with file-type: allow mp4/webm/quicktime ONLY.
 *      Rejects spoofs: unknown type, disallowed type, or a mismatch between
 *      the client-reported mimetype and the detected bytes. This mirrors
 *      server/middleware/validateFileUpload.js, which is buffer-oriented;
 *      here the same two checks run against the temp file because multer
 *      uses disk storage.
 *   3. fileScanService.scanBuffer fail-closed: reject unless the result is
 *      clean AND from a real scanner (skipped/unavailable => reject, never
 *      store). Requires CLAMAV_HOST/CLAMAV_PORT for a real verdict.
 *   4. Store the original via the storage layer (storage.uploadFile), then in
 *      one transaction: INSERT the media row (media_type='video_upload',
 *      provider='upload', video_url=NULL, processing_status='quarantine',
 *      quarantined_at=NOW(), csam_status='pending') + dish snapshots +
 *      enqueue 'csam_check' and 'transcode' jobs.
 *   5. Return 202 {id, media_type, processing_status:'quarantine'}.
 */

const crypto = require('crypto');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const multer = require('multer');
const rateLimit = require('express-rate-limit');
const { fileTypeFromBuffer } = require('file-type');
const pool = require('../db');
const AppError = require('../utils/appError');
const storage = require('../utils/storage');
const fileScanService = require('../services/fileScanService');
const auditService = require('../services/auditService');
const logger = require('../utils/logger');
const { dualWriteToMedia } = require('./restaurantMediaController');

const VIDEO_UPLOAD_MAX_BYTES = (() => {
  const n = Number.parseInt(process.env.VIDEO_UPLOAD_MAX_BYTES, 10);
  return Number.isFinite(n) && n > 0 ? n : 200 * 1024 * 1024;
})();

// video/mp4, video/webm, video/quicktime ONLY.
const ALLOWED_VIDEO_MIMES = new Set(['video/mp4', 'video/webm', 'video/quicktime']);
const CAPTION_MAX_LEN = 280;
const DISH_TAG_MAX = 10;

const UPLOAD_TMP_DIR = path.join(os.tmpdir(), 'oxsteed-video-uploads');

async function ensureTmpDir() {
  await fs.mkdir(UPLOAD_TMP_DIR, { recursive: true });
  return UPLOAD_TMP_DIR;
}

function safeExt(originalName) {
  const ext = path.extname(String(originalName || '')).toLowerCase();
  return ['.mp4', '.webm', '.mov', '.m4v'].includes(ext) ? ext : '.mp4';
}

const videoUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      ensureTmpDir().then((dir) => cb(null, dir)).catch(cb);
    },
    filename: (req, file, cb) => {
      cb(null, `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${safeExt(file.originalname)}`);
    },
  }),
  limits: { fileSize: VIDEO_UPLOAD_MAX_BYTES, files: 1 },
});

// Translate multer errors into machine error codes before the handler runs.
function videoUploadHandler(req, res, next) {
  videoUpload.single('file')(req, res, (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return next(new AppError(
          'Video is too large (max 200MB).', 413, 'media_file_too_large'
        ));
      }
      if (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE') {
        return next(new AppError(
          'Attach exactly one video file in the "file" field.', 400, 'media_file_field'
        ));
      }
      return next(new AppError('Upload failed.', 400, 'media_upload_failed'));
    }
    next();
  });
}

// ── Rate limiter: 3 video uploads per 24h per account ─────────────────────────
// Same Redis-store pattern as restaurantMediaController (falls back to
// in-memory when Redis is unavailable).

const redisClient = require('../utils/redis');
let RedisStore = null;
if (redisClient) {
  try {
    RedisStore = require('rate-limit-redis').default;
  } catch { /* in-memory fallback */ }
}
function createVideoStoreOption(prefix) {
  if (redisClient && RedisStore) {
    return { store: new RedisStore({ sendCommand: (...args) => redisClient.call(...args), prefix }) };
  }
  return {};
}

const videoUploadLimiter = rateLimit({
  ...createVideoStoreOption('rl:restaurant_media_video_upload:'),
  windowMs: 24 * 60 * 60 * 1000,
  max: 3,
  keyGenerator: (req) => (req.user ? `u:${req.user.id}` : req.ip),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many video uploads. Please try again tomorrow.', code: 'media_video_rate_limited' },
});

// ── Shared helpers ───────────────────────────────────────────────────────────
// (getPublicRestaurant / owner + moderate_content checks mirror
// restaurantMediaController.js; duplicated here because that file is owned by
// a parallel workstream and must not be edited.)

function parsePositiveInt(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

async function getPublicRestaurant(restaurantId) {
  const { rows } = await pool.query(
    `SELECT fr.id, fr.business_id, fr.owner_user_id
       FROM food_restaurants fr
       JOIN businesses b ON b.id = fr.business_id
      WHERE fr.id = $1
        AND fr.status IN ('active', 'paused')
        AND fr.discovery_status = 'visible'
        AND COALESCE(fr.is_hidden_by_admin, FALSE) = FALSE
        AND b.is_active = TRUE
        AND b.is_listed = TRUE
        AND COALESCE(b.setup_status, 'active') IN ('active', 'paused')
        AND COALESCE(b.business_kind, 'restaurant') = 'restaurant'
        AND b.deleted_at IS NULL`,
    [restaurantId]
  );
  return rows[0] || null;
}

async function isRestaurantOwner(userId, restaurantId) {
  const { rows } = await pool.query(
    `SELECT 1
       FROM food_restaurants fr
       JOIN businesses b ON b.id = fr.business_id
      WHERE fr.id = $1 AND (fr.owner_user_id = $2 OR b.user_id = $2)`,
    [restaurantId, userId]
  );
  return rows.length > 0;
}

// moderate_content grant check for routes under the regular customer
// `authenticate` middleware. Super-admins always pass.
async function userCanModerateContent(userId) {
  const { rows } = await pool.query(
    `SELECT 1
       FROM admin_permission_grants
      WHERE grantee_id = $1
        AND permissions ? 'moderate_content'
        AND expires_at > NOW()
        AND revoked_at IS NULL
        AND region_id IS NULL
      UNION
      SELECT 1
        FROM delegation_grants d
        JOIN users grantor ON grantor.id = d.grantor_admin_id
        LEFT JOIN admin_permission_grants grantor_grant
          ON grantor_grant.grantee_id = d.grantor_admin_id
         AND grantor_grant.permissions ? 'moderate_content'
         AND grantor_grant.expires_at > NOW()
         AND grantor_grant.revoked_at IS NULL
         AND grantor_grant.region_id IS NULL
       WHERE d.grantee_admin_id = $1
         AND d.scopes @> ARRAY['moderate_content']::text[]
         AND d.status = 'active'
         AND d.expires_at > NOW()
         AND (grantor.role = 'super_admin' OR grantor_grant.id IS NOT NULL)
      LIMIT 1`,
    [userId]
  );
  return rows.length > 0;
}

// Poster, restaurant owner, or a moderator (super-admin / moderate_content).
async function viewerCanManageMedia(userId, mediaUserId, restaurantId, req) {
  if (String(mediaUserId) === String(userId)) return true;
  if (await isRestaurantOwner(userId, restaurantId)) return true;
  if (req.isSuperAdmin) return true;
  if (req.isAdmin) return userCanModerateContent(userId);
  return false;
}

function parseCaption(body) {
  let caption = null;
  const raw = body?.caption;
  if (raw !== undefined && raw !== null && raw !== '') {
    if (typeof raw !== 'string') {
      throw new AppError('Caption must be a string.', 400, 'media_invalid_caption');
    }
    caption = raw.trim();
    if (caption.length > CAPTION_MAX_LEN) {
      throw new AppError('Caption is too long (max 280 characters).', 400, 'media_caption_too_long');
    }
    if (!caption) caption = null;
  }
  return caption;
}

// dish_ids arrives as multipart text: a JSON array string, a single value, or
// repeated fields. Same validation/snapshots as link posts, cap 10.
function parseDishIds(body) {
  let raw = body?.dish_ids ?? body?.dishIds ?? [];
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return [];
    try {
      raw = JSON.parse(trimmed);
    } catch {
      raw = [trimmed];
    }
  }
  if (!Array.isArray(raw)) {
    throw new AppError('dish_ids must be an array.', 400, 'media_invalid_dish_ids');
  }
  const dishIds = [...new Set(raw.map(parsePositiveInt).filter(Boolean))];
  if (dishIds.length > DISH_TAG_MAX) {
    throw new AppError('Too many tagged dishes (max 10).', 400, 'media_too_many_dishes');
  }
  return dishIds;
}

async function cleanupTempFile(tempPath) {
  if (!tempPath) return;
  try {
    await fs.unlink(tempPath);
  } catch { /* best effort */ }
}

// ── POST /api/restaurants/:restaurantId/media/video-uploads ──────────────────

async function postVideoUpload(req, res, next) {
  const tempPath = req.file?.path || null;
  let storedKey = null;
  try {
    if (!req.file || !tempPath) {
      throw new AppError('Attach a video file in the "file" field.', 400, 'media_file_required');
    }

    const restaurantId = parsePositiveInt(req.params.restaurantId);
    if (!restaurantId) {
      throw new AppError('Restaurant not found', 404, 'restaurant_not_found');
    }
    const restaurant = await getPublicRestaurant(restaurantId);
    if (!restaurant) {
      throw new AppError('Restaurant not found', 404, 'restaurant_not_found');
    }

    const caption = parseCaption(req.body);
    const dishIds = parseDishIds(req.body);

    // 1) Magic-bytes validation: mp4/webm/quicktime ONLY, reject spoofs.
    // The full buffer is read once here: multer used disk storage (never
    // buffers the upload in memory); this transient read feeds the malware
    // scan (fileScanService.scanBuffer takes a buffer) and the storage write.
    const fileBuffer = await fs.readFile(tempPath);
    const detected = await fileTypeFromBuffer(fileBuffer.subarray(0, 65536));
    if (!detected) {
      throw new AppError(
        'Could not determine the video file type.', 400, 'media_file_type_unknown'
      );
    }
    if (!ALLOWED_VIDEO_MIMES.has(detected.mime)) {
      logger.warn('Video upload rejected: disallowed type', {
        filename: req.file.originalname, detected: detected.mime,
      });
      throw new AppError('Only MP4, WebM, or QuickTime videos are allowed.', 400, 'media_file_type_not_allowed');
    }
    const reported = String(req.file.mimetype || '').split(';', 1)[0].trim().toLowerCase();
    if (reported && reported !== detected.mime) {
      logger.error('Video upload MIME mismatch (spoofing attempt?)', {
        filename: req.file.originalname, reported, detected: detected.mime,
      });
      throw new AppError(
        'Security check failed: file content does not match the reported type.',
        400, 'media_file_spoofed'
      );
    }

    // 2) Malware scan, fail closed: reject unless clean AND from a real
    //    scanner (skipped/unavailable => reject, never store).
    let scan;
    try {
      scan = await fileScanService.scanBuffer(fileBuffer);
    } catch (err) {
      logger.error('Video upload rejected: scanner unavailable', { message: err.message });
      throw new AppError(
        'File security scanning is temporarily unavailable. Please try again.',
        503, 'media_scan_unavailable'
      );
    }
    const realScannerVerdict = scan && scan.clean === true && scan.skipped !== true
      && scan.provider && scan.provider !== 'static';
    if (!realScannerVerdict) {
      logger.warn('Video upload rejected by file scan', {
        filename: req.file.originalname,
        provider: scan && scan.provider,
        skipped: scan && scan.skipped,
      });
      throw new AppError(
        'Security check failed: the uploaded file was rejected.', 400, 'media_scan_rejected'
      );
    }

    // Every tagged dish must belong to this restaurant. Snapshot name/price.
    let dishRows = [];
    if (dishIds.length) {
      const { rows } = await pool.query(
        `SELECT id, name, price_cents, currency_code
           FROM food_menu_items
          WHERE restaurant_id = $1 AND id = ANY($2)`,
        [restaurantId, dishIds]
      );
      dishRows = rows;
      if (dishRows.length !== dishIds.length) {
        throw new AppError(
          'One or more dishes do not belong to this restaurant.', 400, 'media_dish_not_found'
        );
      }
    }

    // 3) Store the original, then insert + enqueue atomically. The row starts
    //    quarantined and is invisible to the public feed until both gates pass.
    storedKey = await storage.uploadFile(
      fileBuffer, 'restaurant-media/videos',
      `original${safeExt(req.file.originalname)}`, detected.mime
    );

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows: [media] } = await client.query(
        `INSERT INTO restaurant_media
           (restaurant_id, user_id, media_type, provider, video_url,
            storage_key, caption, processing_status, quarantined_at, csam_status)
         VALUES ($1, $2, 'video_upload', 'upload', NULL,
                 $3, $4, 'quarantine', NOW(), 'pending')
         RETURNING id, media_type, processing_status, csam_status, created_at`,
        [restaurantId, req.user.id, storedKey, caption]
      );
      for (const d of dishRows) {
        await client.query(
          `INSERT INTO restaurant_media_items
             (media_id, menu_item_id, item_name_snapshot, item_price_snapshot_cents, currency_code)
           VALUES ($1, $2, $3, $4, $5)`,
          [media.id, d.id, d.name, d.price_cents, d.currency_code]
        );
      }
      // Enqueue both gates; the partial unique index keeps one active job per
      // (media, job_type). The transcode worker verifies csam_status='pass'
      // before doing anything.
      await client.query(
        `INSERT INTO restaurant_media_processing_jobs (media_id, job_type)
         VALUES ($1, 'csam_check'), ($1, 'transcode')
         ON CONFLICT DO NOTHING`,
        [media.id]
      );
      await dualWriteToMedia(client, {
        restaurantId, userId: req.user.id, caption,
        dishRows, restaurantName: null,
        sourceRestaurantMediaId: media.id,
        asset: { assetType: 'video', provider: 'upload', storageKey: storedKey },
      });
      await client.query('COMMIT');
      return res.status(202).json({
        id: media.id,
        media_type: media.media_type,
        processing_status: media.processing_status,
      });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    // Never leave an orphan object when the DB write failed after storage.
    if (storedKey) {
      try { await storage.deleteFile(storedKey); } catch { /* best effort */ }
      storedKey = null;
    }
    next(err instanceof AppError ? err : new AppError(err.message, 500, 'media_upload_failed'));
  } finally {
    await cleanupTempFile(tempPath);
  }
}

// ── POST /api/restaurants/:restaurantId/media/:mediaId/retry ─────────────────
// Poster or restaurant owner/moderator only. If processing_status='failed':
// reset to 'quarantine', set csam_status='pending' when the CSAM step failed,
// re-queue the failed job type(s), clear processing_error. Idempotent: a
// non-failed video returns its current state; a quarantined video whose CSAM
// check came back 'unavailable' (no active csam job) gets the check re-queued.

async function retryVideoProcessing(req, res, next) {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    if (!restaurantId) {
      return next(new AppError('Restaurant not found', 404, 'restaurant_not_found'));
    }
    const mediaId = String(req.params.mediaId || '');
    const { rows: [media] } = await pool.query(
      `SELECT id, user_id, media_type, processing_status, csam_status, processing_error
         FROM restaurant_media
        WHERE id = $1 AND restaurant_id = $2`,
      [mediaId, restaurantId]
    );
    if (!media) {
      return next(new AppError('Media not found', 404, 'media_not_found'));
    }
    if (media.media_type !== 'video_upload') {
      return next(new AppError('Only uploaded videos can be retried.', 400, 'media_retry_not_supported'));
    }
    const allowed = await viewerCanManageMedia(req.user.id, media.user_id, restaurantId, req);
    if (!allowed) {
      return next(new AppError('You do not have permission to retry this video.', 403, 'media_forbidden'));
    }
    // A vendor-flagged video is blocked, not failed: retry never un-flags it.
    if (media.csam_status === 'flagged') {
      return next(new AppError(
        'This video was blocked by a safety check and cannot be retried.', 409, 'media_csam_blocked'
      ));
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows: [locked] } = await client.query(
        `SELECT id, processing_status, csam_status
           FROM restaurant_media
          WHERE id = $1 FOR UPDATE`,
        [media.id]
      );
      const { rows: failedJobs } = await client.query(
        `SELECT job_type FROM restaurant_media_processing_jobs
          WHERE media_id = $1 AND status = 'failed'`,
        [media.id]
      );
      const failedTypes = failedJobs.map((j) => j.job_type);

      let retried = false;
      let csamStatus = locked.csam_status;
      if (locked.processing_status === 'failed') {
        if (failedTypes.includes('csam_check')) csamStatus = 'pending';
        await client.query(
          `UPDATE restaurant_media
              SET processing_status = 'quarantine',
                  quarantined_at = NOW(),
                  csam_status = $2,
                  processing_error = NULL
            WHERE id = $1`,
          [media.id, csamStatus]
        );
        // Re-queue each failed job type; if none are recorded (worker died
        // mid-claim), re-queue the gate that has not passed.
        const toQueue = failedTypes.length
          ? failedTypes
          : (csamStatus === 'pass' ? ['transcode'] : ['csam_check']);
        for (const jobType of [...new Set(toQueue)]) {
          await client.query(
            `INSERT INTO restaurant_media_processing_jobs (media_id, job_type)
             VALUES ($1, $2)
             ON CONFLICT DO NOTHING`,
            [media.id, jobType]
          );
        }
        retried = true;
      } else if (locked.processing_status === 'quarantine' && locked.csam_status === 'pending') {
        // CSAM 'unavailable' (no vendor keys): no active csam job — re-queue it.
        const { rows: active } = await client.query(
          `SELECT 1 FROM restaurant_media_processing_jobs
            WHERE media_id = $1 AND job_type = 'csam_check' AND status IN ('queued', 'running')`,
          [media.id]
        );
        if (!active.length) {
          await client.query(
            `INSERT INTO restaurant_media_processing_jobs (media_id, job_type)
             VALUES ($1, 'csam_check')
             ON CONFLICT DO NOTHING`,
            [media.id]
          );
          retried = true;
        }
      }
      await client.query('COMMIT');
      return res.json({
        id: media.id,
        media_type: media.media_type,
        processing_status: locked.processing_status === 'failed' ? 'quarantine' : locked.processing_status,
        csam_status: csamStatus,
        retried,
      });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    next(err);
  }
}

// ── DMCA takedown (wired from server/routes/adminRestaurantMedia.js) ─────────
// The flag-review endpoint routes {action:'remove', takedownReason:'dmca'}
// here. Sets media status='hidden', records 'DMCA takedown' on the reviewed
// flag and in the audit entry, resolves every open flag on the media, and
// writes the same admin_audit_log entry shape as other removals. No new tables.

async function adminDmcaTakedownReview(req, res, next) {
  try {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `SELECT id, media_id, status FROM restaurant_media_flags WHERE id = $1 FOR UPDATE`,
        [req.params.flagId]
      );
      const flag = rows[0];
      if (!flag) {
        await client.query('ROLLBACK');
        return next(new AppError('Flag not found.', 404, 'media_flag_not_found'));
      }
      if (flag.status !== 'open') {
        await client.query('ROLLBACK');
        return next(new AppError('Flag was already decided.', 409, 'media_flag_already_decided'));
      }
      const { rows: [media] } = await client.query(
        `SELECT id, status, media_type FROM restaurant_media WHERE id = $1 FOR UPDATE`,
        [flag.media_id]
      );
      const beforeStatus = media ? media.status : null;

      await client.query(
        `UPDATE restaurant_media SET status = 'hidden' WHERE id = $1`,
        [flag.media_id]
      );
      await client.query(
        `UPDATE media_posts SET visibility = 'removed', deleted_at = COALESCE(deleted_at, NOW())
          WHERE source_restaurant_media_id = $1`, [flag.media_id]
      );
      // Record 'DMCA takedown' as the review note on the decided flag, and
      // resolve every open flag on the media.
      await client.query(
        `UPDATE restaurant_media_flags
            SET status = 'resolved', decided_at = NOW(), decided_by = $1,
                note = 'DMCA takedown'
          WHERE id = $2`,
        [req.user.id, flag.id]
      );
      await client.query(
        `UPDATE restaurant_media_flags
            SET status = 'resolved', decided_at = NOW(), decided_by = $1
          WHERE media_id = $2 AND status = 'open' AND id <> $3`,
        [req.user.id, flag.media_id, flag.id]
      );
      await auditService.logAdminAction({
        adminId: req.user.id,
        action: 'restaurant_media_remove',
        targetType: 'restaurant_media',
        targetId: flag.media_id,
        description: 'DMCA takedown of restaurant media.',
        before: { status: beforeStatus, takedown_reason: null },
        after: { status: 'hidden', takedown_reason: 'dmca' },
        req,
        client,
        throwOnError: true,
      });
      await client.query('COMMIT');
      return res.json({ success: true, takedown: 'dmca' });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    next(err);
  }
}

module.exports = {
  videoUpload,
  videoUploadHandler,
  videoUploadLimiter,
  VIDEO_UPLOAD_MAX_BYTES,
  postVideoUpload,
  retryVideoProcessing,
  adminDmcaTakedownReview,
};
