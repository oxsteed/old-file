'use strict';

// Item photos: customer-uploaded pictures of the item being delivered.
// This is NOT the proof-photo path: proof uploads (POST
// /delivery/jobs/:id/proof-upload) require an in_transit job with a
// photo/signature proof preference and are consumed by proof verification.
// Item photos are taken after posting and before pickup, stay attached to
// the job, and are visible to the customer and the assigned driver only.
// Storage, scan policy, and the multer + validateFileUpload pattern are
// reused from the proof path; the table mirrors delivery_proof_uploads.
const crypto = require('crypto');
const pool = require('../db');
const AppError = require('../utils/appError');
const scanner = require('../services/fileScanService');
const { uploadFile, getSignedDownloadUrl, deleteFile } = require('../utils/storage');
const logger = require('../utils/logger');

const ITEM_PHOTO_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_BYTES = 10485760;

// The customer who posted the job, while it is still waiting for pickup.
exports.uploadGuard = async (req, res, next) => {
  try {
    if (scanner.malwareScanRequired() && !scanner.isConfigured()) {
      throw new AppError('Item photos are temporarily unavailable. Try again later.', 503, 'delivery_proof_scanner_unavailable');
    }
    const { rows } = await pool.query(
      "SELECT id FROM delivery_jobs WHERE id = $1 AND status IN ('posted', 'assigned') AND customer_user_id = $2",
      [req.params.id, req.user.id],
    );
    if (!rows[0]) throw new AppError('Delivery not found or no longer awaiting pickup', 404, 'delivery_not_found');
    next();
  } catch (error) { next(error); }
};

exports.upload = async (req, res, next) => {
  let client;
  let objectKey = null;
  try {
    if (!req.file || !ITEM_PHOTO_TYPES.has(req.file.mimetype) || req.file.size <= 0 || req.file.size > MAX_BYTES) {
      throw new AppError('Select an image under 10 MB', 400, 'delivery_item_photo_invalid');
    }
    client = await pool.connect();
    await client.query('BEGIN');
    const { rows } = await client.query(
      "SELECT * FROM delivery_jobs WHERE id = $1 AND status IN ('posted', 'assigned') AND customer_user_id = $2 FOR UPDATE",
      [req.params.id, req.user.id],
    );
    const job = rows[0];
    if (!job) throw new AppError('Delivery not found or no longer awaiting pickup', 404, 'delivery_not_found');
    objectKey = await uploadFile(req.file.buffer, `delivery-private/${job.id}/${req.user.id}`, req.file.originalname, req.file.mimetype);
    if (!objectKey) throw new AppError('Storage unavailable', 503, 'storage_unavailable');
    const result = await client.query(
      'INSERT INTO delivery_job_item_photos(delivery_job_id, owner_user_id, object_key, content_type, size_bytes, sha256, scan_status) VALUES($1, $2, $3, $4, $5, $6, \'clean\') RETURNING id, content_type, size_bytes, created_at',
      [job.id, req.user.id, objectKey, req.file.mimetype, req.file.size, crypto.createHash('sha256').update(req.file.buffer).digest('hex')],
    );
    await client.query('COMMIT');
    res.status(201).json({ success: true, photo: result.rows[0] });
  } catch (error) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    if (objectKey) {
      await deleteFile(objectKey).catch((cleanupError) => logger.warn('Failed to remove orphaned delivery item photo', {
        objectKey,
        error: cleanupError.message,
      }));
    }
    next(error);
  } finally { client?.release(); }
};

// Participants only: customer, assigned helper, or assigned internal driver.
exports.list = async (req, res, next) => {
  try {
    const { rows: jobs } = await pool.query(
      `SELECT id FROM delivery_jobs
        WHERE id = $1 AND (customer_user_id = $2 OR helper_user_id = $2 OR internal_driver_user_id = $2)`,
      [req.params.id, req.user.id],
    );
    if (!jobs[0]) throw new AppError('Delivery job not found', 404, 'delivery_not_found');
    const { rows } = await pool.query(
      'SELECT id, object_key, content_type, size_bytes, created_at FROM delivery_job_item_photos WHERE delivery_job_id = $1 ORDER BY created_at DESC',
      [req.params.id],
    );
    const photos = await Promise.all(rows.map(async (photo) => ({
      id: photo.id,
      contentType: photo.content_type,
      sizeBytes: photo.size_bytes,
      createdAt: photo.created_at,
      url: await getSignedDownloadUrl(photo.object_key, 3600).catch(() => null),
    })));
    res.set('Cache-Control', 'no-store');
    res.json({ success: true, photos });
  } catch (error) { next(error); }
};
