'use strict';

// OxSteed Media asset uploads.
// Photo: sync ready. Video: quarantine + CSAM/transcode jobs.
// Gates (Emile locked #12): Didit identity required for video upload;
// public video blocked until CSAM vendor certified.

const pool = require('../db');
const logger = require('../utils/logger');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const multer = require('multer');
const sharp = require('sharp');
const { fileTypeFromBuffer } = require('file-type');
const fileScanService = require('../services/fileScanService');
const { uploadFile, getSignedDownloadUrl, deleteFile } = require('../utils/storage');
const { stripExif } = require('../utils/stripExif');

// TODO: set true when production CSAM vendor contract is certified.
const CSAM_VENDOR_CERTIFIED = process.env.MEDIA_CSAM_CERTIFIED === 'true';
const PHOTO_MAX_BYTES = 10 * 1024 * 1024;
const PHOTO_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const PHOTO_EXTENSIONS = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const VIDEO_MAX_BYTES = 200 * 1024 * 1024;
const VIDEO_MIMES = new Set(['video/mp4', 'video/webm', 'video/quicktime']);
const mediaPhotoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: PHOTO_MAX_BYTES, files: 1 },
}).single('file');
const mediaVideoUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, os.tmpdir()),
    filename: (_req, file, cb) => cb(null, `oxsteed-media-${Date.now()}-${Math.random().toString(16).slice(2)}${path.extname(file.originalname || '')}`),
  }),
  limits: { fileSize: VIDEO_MAX_BYTES, files: 1 },
}).single('file');

async function checkDidit(userId) {
  const { rows } = await pool.query(
    `SELECT identity_verified FROM users WHERE id = $1`,
    [userId]
  );
  return !!rows[0]?.identity_verified;
}

async function assertPostOwner(postId, userId) {
  const { rows } = await pool.query(
    `SELECT p.id
       FROM media_posts p
       JOIN media_actors a ON a.id = p.actor_id
      WHERE p.id = $1 AND a.owner_user_id = $2 AND p.deleted_at IS NULL`,
    [postId, userId]
  );
  return !!rows[0];
}

async function uploadPhoto(req, res) {
  try {
    const file = req.file;
    if (!file?.buffer?.length) return res.status(400).json({ error: 'A photo file is required', code: 'media_photo_required' });
    const postId = req.body?.post_id;
    if (!postId) return res.status(400).json({ error: 'post_id is required' });
    if (!await assertPostOwner(postId, req.user.id)) {
      return res.status(403).json({ error: 'You can only attach media to your own post', code: 'media_post_forbidden' });
    }

    const detected = await fileTypeFromBuffer(file.buffer);
    if (!detected || !PHOTO_MIMES.has(detected.mime)) {
      return res.status(400).json({ error: 'Only JPEG, PNG, or WebP photos are accepted', code: 'media_photo_invalid_type' });
    }
    if (file.mimetype && file.mimetype !== detected.mime) {
      return res.status(400).json({ error: 'The photo content does not match its reported type', code: 'media_photo_mime_mismatch' });
    }

    let scan;
    try { scan = await fileScanService.scanBuffer(file.buffer); } catch {
      return res.status(503).json({ error: 'Photo security scanning is temporarily unavailable', code: 'media_scan_unavailable' });
    }
    if (!scan || scan.clean !== true) {
      return res.status(400).json({ error: 'The photo was rejected by the security scan', code: 'media_scan_rejected' });
    }
    if (scan.skipped || scan.provider === 'static') {
      return res.status(503).json({ error: 'Photo security scanning is temporarily unavailable', code: 'media_scan_unavailable' });
    }

    const cleanBuffer = await stripExif(file.buffer);
    const thumbnail = await sharp(cleanBuffer)
      .resize({ width: 480, withoutEnlargement: true })
      .jpeg({ quality: 82 })
      .toBuffer({ resolveWithObject: true });
    const ext = PHOTO_EXTENSIONS[detected.mime];
    const storedKeys = [];
    try {
      const storageKey = await uploadFile(cleanBuffer, 'media/photos', `photo.${ext}`, detected.mime);
      const thumbnailKey = await uploadFile(thumbnail.data, 'media/photos', `thumb.${ext}`, 'image/jpeg');
      storedKeys.push(storageKey, thumbnailKey);
      const { rows } = await pool.query(
        `INSERT INTO media_post_assets
           (post_id, asset_type, provider, storage_key, thumbnail_key, width, height)
         VALUES ($1, 'image', 'upload', $2, $3, $4, $5)
         RETURNING *`,
        [postId, storageKey, thumbnailKey, thumbnail.info.width, thumbnail.info.height]
      );
      const asset = rows[0];
      asset.url = await getSignedDownloadUrl(asset.storage_key);
      asset.thumbnail_url = await getSignedDownloadUrl(asset.thumbnail_key);
      return res.status(201).json({ asset });
    } catch (err) {
      await Promise.allSettled(storedKeys.filter(Boolean).map((key) => deleteFile(key)));
      throw err;
    }
  } catch (err) {
    logger.error('media.uploadPhoto error', { message: err.message });
    return res.status(500).json({ error: 'Failed to attach photo' });
  }
}

async function photoUpload(req, res) {
  try {
    // Expects { post_id, storage_key, width, height } after client uploads
    // via the generic /api/upload endpoint.
    const { post_id, storage_key, width, height } = req.body;
    if (!post_id || !storage_key) {
      return res.status(400).json({ error: 'post_id and storage_key required' });
    }
    if (!await assertPostOwner(post_id, req.user.id)) {
      return res.status(403).json({ error: 'You can only attach media to your own post', code: 'media_post_forbidden' });
    }
    const { rows } = await pool.query(
      `INSERT INTO media_post_assets
         (post_id, asset_type, provider, storage_key, width, height)
       VALUES ($1, 'image', 'upload', $2, $3, $4)
       RETURNING *`,
      [post_id, storage_key, width || null, height || null]
    );
    res.status(201).json({ asset: rows[0] });
  } catch (err) {
    logger.error('media.photoUpload error', { message: err.message });
    res.status(500).json({ error: 'Failed to attach photo' });
  }
}

async function videoUpload(req, res) {
  const tempPath = req.file?.path || null;
  let storedKey = null;
  try {
    const userId = req.user.id;

    // Gate 1: Didit identity required to upload video.
    const hasDidit = await checkDidit(userId);
    if (!hasDidit) {
      return res.status(403).json({
        error: 'Identity verification required to upload video.',
        code: 'media_video_didit_required',
      });
    }

    const { post_id, duration_ms, width, height } = req.body || {};
    if (!post_id) return res.status(400).json({ error: 'post_id is required' });
    if (!await assertPostOwner(post_id, userId)) {
      return res.status(403).json({ error: 'You can only attach media to your own post', code: 'media_post_forbidden' });
    }

    if (!req.file || !tempPath) {
      return res.status(400).json({ error: 'A video file is required', code: 'media_video_required' });
    }
    const fileBuffer = await fs.readFile(tempPath);
    const detected = await fileTypeFromBuffer(fileBuffer.subarray(0, 65536));
    const reported = String(req.file.mimetype || '').split(';', 1)[0].trim().toLowerCase();
    if (!detected || !VIDEO_MIMES.has(detected.mime)) {
      return res.status(400).json({ error: 'Only MP4, WebM, or QuickTime videos are accepted', code: 'media_video_invalid_type' });
    }
    if (reported && reported !== detected.mime) {
      return res.status(400).json({ error: 'The video content does not match its reported type', code: 'media_video_mime_mismatch' });
    }
    let scan;
    try { scan = await fileScanService.scanBuffer(fileBuffer); } catch {
      return res.status(503).json({ error: 'Video security scanning is temporarily unavailable', code: 'media_scan_unavailable' });
    }
    if (!scan || scan.clean !== true) {
      return res.status(400).json({ error: 'The video was rejected by the security scan', code: 'media_scan_rejected' });
    }
    if (scan.skipped || scan.provider === 'static') {
      return res.status(503).json({ error: 'Video security scanning is temporarily unavailable', code: 'media_scan_unavailable' });
    }

    storedKey = await uploadFile(fileBuffer, 'media/videos', `original${path.extname(req.file.originalname || '') || '.bin'}`, detected.mime);
    const client = await pool.connect();
    let asset;
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `INSERT INTO media_post_assets
           (post_id, asset_type, provider, storage_key, duration_ms, width, height, processing_status, csam_status)
         VALUES ($1, 'video', 'upload', $2, $3, $4, $5, 'quarantine', 'pending')
         RETURNING *`,
        [post_id, storedKey, duration_ms || null, width || null, height || null]
      );
      asset = rows[0];
      await client.query(
        `UPDATE media_posts SET processing_status = 'quarantine', csam_status = 'pending'
          WHERE id = $1`, [post_id]
      );
      await client.query(
        `INSERT INTO media_processing_jobs (post_id, asset_id, job_type)
         VALUES ($1, $2, 'csam_check'), ($1, $2, 'transcode')`, [post_id, asset.id]
      );
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
    asset.url = await getSignedDownloadUrl(asset.storage_key);
    return res.status(202).json({
      asset,
      status: 'quarantine',
      public_video_available: CSAM_VENDOR_CERTIFIED,
      message: 'Video queued for safety check and transcoding.',
    });
  } catch (err) {
    if (storedKey) await Promise.allSettled([deleteFile(storedKey)]);
    logger.error('media.videoUpload error', { message: err.message });
    res.status(500).json({ error: 'Failed to upload video' });
  } finally {
    if (tempPath) await fs.rm(tempPath, { force: true }).catch(() => {});
  }
}

async function linkAsset(req, res) {
  try {
    const { post_id, external_url } = req.body;
    if (!post_id || !external_url) {
      return res.status(400).json({ error: 'post_id and external_url required' });
    }
    if (!await assertPostOwner(post_id, req.user.id)) {
      return res.status(403).json({ error: 'You can only attach media to your own post', code: 'media_post_forbidden' });
    }
    // Validate YouTube/Vimeo.
    const yt = external_url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]+)/);
    const vimeo = external_url.match(/vimeo\.com\/(\d+)/);
    let provider = null, videoId = null;
    if (yt) { provider = 'youtube'; videoId = yt[1]; }
    else if (vimeo) { provider = 'vimeo'; videoId = vimeo[1]; }
    else return res.status(400).json({ error: 'Only YouTube/Vimeo links supported' });

    const { rows } = await pool.query(
      `INSERT INTO media_post_assets
         (post_id, asset_type, provider, external_url, external_video_id)
       VALUES ($1, 'video_link', $2, $3, $4)
       RETURNING *`,
      [post_id, provider, external_url, videoId]
    );
    res.status(201).json({ asset: rows[0] });
  } catch (err) {
    logger.error('media.linkAsset error', { message: err.message });
    res.status(500).json({ error: 'Failed to attach video link' });
  }
}

module.exports = { photoUpload, uploadPhoto, mediaPhotoUpload, videoUpload, mediaVideoUpload, linkAsset };
