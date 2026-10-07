const express = require('express');
const path = require('path');
const { authenticate } = require('../middleware/auth');
const upload = require('../middleware/upload');
const validateFileUpload = require('../middleware/validateFileUpload');
const { uploadFile, getPublicUrl, getSignedDownloadUrl } = require('../utils/storage');
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

// Visibility model (audit P1): default-deny public.
// - PUBLIC_PURPOSES are intentionally public assets (profile photos, business
//   logos, listing imagery). They are stored under the public-uploads/ prefix,
//   which is in the storage public allowlist, and get a permanent public URL.
// - Everything else is private: stored under user-uploads/ and served through
//   a short-lived signed URL. Sensitive purposes (proofs, POP, logistics,
//   Direct, message attachments, ...) are therefore never given a public URL,
//   and an explicit visibility=public request for a non-public purpose is
//   refused instead of silently downgraded.
const PUBLIC_PURPOSES = new Set([
  'profile-photo', 'avatar', 'avatars',
  'business-logo', 'business-logos', 'logo',
  'business-cover', 'business-covers', 'cover',
  'helper-cover', 'helper-covers',
  'helper-gallery', 'gallery',
  'job-photo', 'job', 'jobs',
  'tool-photo', 'tool-rentals', 'tool',
  'business-photo', 'listing-photo',
]);

function uploadFolder(req, kind) {
  const userId = req.user?.id || 'unknown';
  const purpose = cleanPurpose(req.body?.purpose);
  if (PUBLIC_PURPOSES.has(purpose)) {
    return `public-uploads/${purpose}/${userId}/${kind}`;
  }
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

    const key = await uploadFile(
      req.file.buffer,
      uploadFolder(req, kind),
      req.file.originalname || `${kind}${path.extname(req.file.originalname || '')}`,
      req.file.mimetype
    );

    if (!key) {
      return res.status(503).json({ error: 'File storage is not configured' });
    }

    // Visibility: private uploads get a signed URL (1h expiry), public
    // uploads get a permanent public URL. Default to private for safety;
    // only allowlisted public purposes may be public.
    const visibility = String(req.body?.visibility || '').toLowerCase();
    const purpose = cleanPurpose(req.body?.purpose);
    if (visibility === 'public' && !PUBLIC_PURPOSES.has(purpose)) {
      return res.status(400).json({
        error: 'This upload purpose cannot be public',
        code: 'purpose_not_public',
      });
    }
    const isPrivate = visibility === 'private' || !PUBLIC_PURPOSES.has(purpose);

    const url = isPrivate
      ? await getSignedDownloadUrl(key, 3600)
      : getPublicUrl(key);

    return res.status(201).json({
      url,
      key,
      content_type: req.file.mimetype,
      size_bytes: req.file.size,
      visibility: isPrivate ? 'private' : 'public',
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
