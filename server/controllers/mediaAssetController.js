'use strict';

// OxSteed Media asset uploads.
// Photo: sync ready. Video: quarantine + CSAM/transcode jobs.
// Gates (Emile locked #12): Didit identity required for video upload;
// Cloudflare interim policy; vendor screening is deferred until adoption.

const pool = require('../db');
const { createHash } = require('crypto');
const attachments = require('../services/mediaDraftAttachments');
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
const AppError = require('../utils/appError');
const mediaSafety = require('../services/mediaSafetyPolicy');

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

function mapUploadError(err, mediaType) {
  if (!err) return null;
  if (err.code === 'LIMIT_FILE_SIZE') {
    return new AppError(
      `${mediaType === 'video' ? 'Video' : 'Photo'} is too large (max ${mediaType === 'video' ? '200MB' : '10MB'}).`,
      413,
      'media_file_too_large',
    );
  }
  if (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE') {
    return new AppError('Attach exactly one media file in the "file" field.', 400, 'media_file_field');
  }
  return new AppError('Upload failed.', 400, 'media_upload_failed');
}

function mediaPhotoUploadHandler(req, res, next) {
  mediaPhotoUpload(req, res, (err) => {
    if (err) return next(mapUploadError(err, 'photo'));
    return next();
  });
}

function mediaVideoUploadHandler(req, res, next) {
  mediaVideoUpload(req, res, (err) => {
    if (err) return next(mapUploadError(err, 'video'));
    return next();
  });
}

async function checkDidit(userId) {
  const { rows } = await pool.query(
    `SELECT is_verified FROM users WHERE id = $1`,
    [userId]
  );
  return !!rows[0]?.is_verified;
}

async function requireVideoIdentity(req, res, next) {
  try {
    if (!await checkDidit(req.user.id)) {
      return res.status(403).json({
        error: 'Identity verification required to upload video.',
        code: 'media_video_didit_required',
      });
    }
    return next();
  } catch (err) {
    logger.error('media.requireVideoIdentity error', { message: err.message });
    return next(new AppError('Could not verify identity for video upload.', 503, 'media_identity_unavailable'));
  }
}

function uploadFailure(res, error, message) {
  return res.status(error.status || 500).json({ error: error.isOperational ? error.message : message,
    code: error.code || 'media_upload_failed' });
}

async function cleanup(keys) {
  const results = await Promise.allSettled([...new Set(keys)].filter(Boolean).map((key) => deleteFile(key)));
  if (results.some((result) => result.status === 'rejected')) {
    logger.warn('media upload storage cleanup incomplete');
  }
}

async function cleanupUncommitted(keys) {
  // COMMIT can succeed before the connection drops. Preserve any durable
  // references, and defer cleanup altogether if the DB cannot confirm them.
  try {
    const { rows } = await pool.query(`SELECT storage_key, thumbnail_key FROM media_post_assets
      WHERE storage_key = ANY($1::text[]) OR thumbnail_key = ANY($1::text[])`, [keys]);
    const referenced = new Set(rows.flatMap((asset) => [asset.storage_key, asset.thumbnail_key]));
    await cleanup(keys.filter((key) => !referenced.has(key)));
  } catch {
    logger.warn('media upload cleanup deferred until persistence can be checked');
  }
}

function replaceRequested(req) { return req.body?.replace_assets === true || req.body?.replace_assets === 'true'; }
function digest(buffer) { return createHash('sha256').update(buffer).digest('hex'); }

async function uploadPhoto(req, res) {
  try {
    const file = req.file;
    if (!file?.buffer?.length) return res.status(400).json({ error: 'A photo file is required', code: 'media_photo_required' });
    const postId = req.body?.post_id;
    if (!postId) return res.status(400).json({ error: 'post_id is required' });
    await attachments.requireDraft(pool, postId, req.user.id);

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
    let committed = false;
    try {
      const storageKey = await uploadFile(cleanBuffer, 'media/photos', `photo.${ext}`, detected.mime);
      storedKeys.push(storageKey);
      const thumbnailKey = await uploadFile(thumbnail.data, 'media/photos', 'thumb.jpg', 'image/jpeg');
      storedKeys.push(thumbnailKey);
      const result = await attachments.attach({ postId, userId: req.user.id, replace: replaceRequested(req),
        asset: { asset_type: 'image', provider: 'upload', storage_key: storageKey, thumbnail_key: thumbnailKey,
          width: thumbnail.info.width, height: thumbnail.info.height, content_sha256: digest(file.buffer) } });
      committed = true;
      await cleanup(result.existing ? storedKeys : result.removedKeys);
      const asset = result.asset;
      asset.url = await getSignedDownloadUrl(asset.storage_key);
      asset.thumbnail_url = await getSignedDownloadUrl(asset.thumbnail_key);
      return res.status(result.existing ? 200 : 201).json({ asset, existing: result.existing });
    } catch (err) {
      // Signing is a response step, not part of persistence. A lost response
      // must never delete an attachment that the database already committed.
      if (!committed) await cleanupUncommitted(storedKeys);
      throw err;
    }
  } catch (err) {
    logger.error('media.uploadPhoto error', { message: err.message });
    return uploadFailure(res, err, 'Failed to attach photo');
  }
}

async function videoUpload(req, res) {
  const tempPath = req.file?.path || null;
  let storedKey = null;
  let committed = false;
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

    const { post_id } = req.body || {};
    if (!post_id) return res.status(400).json({ error: 'post_id is required' });
    await attachments.requireDraft(pool, post_id, userId);

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
    const result = await attachments.attach({ postId: post_id, userId, replace: replaceRequested(req),
      asset: { asset_type: 'video', provider: 'upload', storage_key: storedKey,
        processing_status: 'quarantine', csam_status: 'pending', content_sha256: digest(fileBuffer) } });
    committed = true;
    await cleanup(result.existing ? [storedKey] : result.removedKeys);
    const asset = result.asset;
    asset.url = await getSignedDownloadUrl(asset.storage_key);
    return res.status(202).json({
      asset,
      existing: result.existing,
      status: asset.processing_status,
      public_video_available: mediaSafety.videoAllowed(),
      safety_mode: mediaSafety.mode(),
      message: 'Video queued for safety check and transcoding.',
    });
  } catch (err) {
    if (storedKey && !committed) await cleanupUncommitted([storedKey]);
    logger.error('media.videoUpload error', { message: err.message });
    return uploadFailure(res, err, 'Failed to upload video');
  } finally {
    if (tempPath) await fs.rm(tempPath, { force: true }).catch(() => {});
  }
}

async function linkAsset(req, res) {
  try {
    const { post_id, external_url } = req.body || {};
    if (!post_id || !external_url) return res.status(400).json({ error: 'post_id and external_url required' });
    const video = attachments.externalVideo(external_url);
    const result = await attachments.attach({ postId: post_id, userId: req.user.id, replace: replaceRequested(req),
      asset: { asset_type: 'video_link', ...video, content_sha256: digest(Buffer.from(video.external_url)) } });
    await cleanup(result.removedKeys);
    return res.status(result.existing ? 200 : 201).json({ asset: result.asset, existing: result.existing });
  } catch (err) {
    logger.error('media.linkAsset error', { message: err.message });
    return uploadFailure(res, err, 'Failed to attach video link');
  }
}

module.exports = {
  uploadPhoto,
  mediaPhotoUpload,
  mediaPhotoUploadHandler,
  videoUpload,
  mediaVideoUpload,
  mediaVideoUploadHandler,
  requireVideoIdentity,
  linkAsset,
};
