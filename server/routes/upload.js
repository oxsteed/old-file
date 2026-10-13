const express = require('express');
const path = require('path');
const pool = require('../db');
const { authenticate } = require('../middleware/auth');
const upload = require('../middleware/upload');
const validateFileUpload = require('../middleware/validateFileUpload');
const { uploadFile, getPublicUrl, getSignedDownloadUrl } = require('../utils/storage');
const { enqueueStorageDeletion } = require('../services/storageCleanupService');
const logger = require('../utils/logger');
const AppError = require('../utils/appError');
const { authenticatedLimiter } = require('../middleware/rateLimiter');

const router = express.Router();

router.use(authenticate);
router.use(authenticatedLimiter);

function cleanPurpose(value) {
  const raw = String(value || 'general').toLowerCase();
  return raw.replace(/[^a-z0-9_-]/g, '-').replace(/-+/g, '-').slice(0, 48) || 'general';
}

// Visibility model (audit P1, hardened review P3-6-F06): the generic upload
// surface is private-only. The `purpose` body field is caller-controlled, so
// it must never decide public visibility: a self-selected purpose is not a
// trust signal. Every generic upload lands under user-uploads/ and is served
// through a short-lived signed URL, and an explicit visibility=public request
// is refused instead of silently downgraded. Permanent public URLs are minted
// only by dedicated routes below that pin the purpose server-side.
function uploadFolder(req, kind) {
  const userId = req.user?.id || 'unknown';
  const purpose = cleanPurpose(req.body?.purpose);
  return `user-uploads/${userId}/${kind}/${purpose}`;
}

function kindForFile(file) {
  const mime = String(file?.mimetype || '').toLowerCase();
  if (mime.startsWith('image/')) return 'images';
  if (mime.startsWith('video/')) return 'videos';
  if (mime === 'application/pdf' || mime.startsWith('text/')) return 'documents';
  return 'files';
}

async function handleUpload(req, res, next, kind) {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'file is required' });
    }

    // Generic uploads are always private: the caller-controlled purpose can
    // never mint a permanent public URL (review P3-6-F06). Fail closed on an
    // explicit visibility=public request before anything is stored, so a
    // refused request cannot orphan an object.
    const visibility = String(req.body?.visibility || '').toLowerCase();
    if (visibility === 'public') {
      return res.status(400).json({
        error: 'This upload purpose cannot be public',
        code: 'purpose_not_public',
      });
    }

    const key = await uploadFile(
      req.file.buffer,
      uploadFolder(req, kind),
      req.file.originalname || `${kind}${path.extname(req.file.originalname || '')}`,
      req.file.mimetype
    );

    if (!key) {
      return res.status(503).json({ error: 'File storage is not configured' });
    }

    const url = await getSignedDownloadUrl(key, 3600);

    return res.status(201).json({
      url,
      key,
      content_type: req.file.mimetype,
      size_bytes: req.file.size,
      visibility: 'private',
    });
  } catch (error) {
    logger.error('upload route failed', { kind, error: error.message });
    next(new AppError(
      'File storage is temporarily unavailable',
      503,
      'storage_unavailable'
    ));
  }
}

// Review P3-6-F06: the only public URL the generic upload surface mints.
// The purpose is pinned server-side ('profile-photo'); the caller cannot
// choose it. Uploading replaces the user's live profile photo immediately
// (delete-on-replace for the previous object), so a minted public URL is
// always the user's actual profile photo: there is no way to stockpile
// permanent public URLs for arbitrary files.
router.post('/profile-photo', upload.single('file'), validateFileUpload, async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'file is required' });
    }
    const mime = String(req.file.mimetype || '').toLowerCase();
    if (!mime.startsWith('image/')) {
      return res.status(400).json({ error: 'Only image files can be used as a profile photo' });
    }

    const userId = req.user?.id || 'unknown';
    const key = await uploadFile(
      req.file.buffer,
      `public-uploads/profile-photo/${userId}/images`,
      req.file.originalname || `profile-photo${path.extname(req.file.originalname || '')}`,
      req.file.mimetype
    );

    if (!key) {
      return res.status(503).json({ error: 'File storage is not configured' });
    }

    const url = getPublicUrl(key);

    // Replace the live profile photo and queue the previous object for
    // deletion. A failed queue entry never fails the upload itself.
    let previousUrl = null;
    try {
      const { rows } = await pool.query(
        'SELECT profile_photo_url FROM users WHERE id = $1',
        [req.user.id]
      );
      previousUrl = rows[0]?.profile_photo_url || null;
      await pool.query(
        'UPDATE users SET profile_photo_url = $1 WHERE id = $2',
        [url, req.user.id]
      );
    } catch (dbError) {
      logger.error('profile photo persist failed', { userId, error: dbError.message });
      return next(new AppError('Could not save the profile photo', 500, 'profile_photo_save_failed'));
    }
    if (previousUrl && previousUrl !== url) {
      await enqueueStorageDeletion(previousUrl, 'profile_photo_replaced');
    }

    return res.status(201).json({
      url,
      key,
      content_type: req.file.mimetype,
      size_bytes: req.file.size,
      visibility: 'public',
    });
  } catch (error) {
    logger.error('profile photo upload failed', { error: error.message });
    next(new AppError(
      'File storage is temporarily unavailable',
      503,
      'storage_unavailable'
    ));
  }
});

router.post('/image', upload.single('image'), validateFileUpload, (req, res, next) => {
  handleUpload(req, res, next, 'images');
});

router.post('/document', upload.single('document'), validateFileUpload, (req, res, next) => {
  handleUpload(req, res, next, 'documents');
});

router.post('/', upload.single('file'), validateFileUpload, (req, res, next) => {
  handleUpload(req, res, next, kindForFile(req.file));
});

module.exports = router;
