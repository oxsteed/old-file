const express = require('express');
const path = require('path');
const { authenticate } = require('../middleware/auth');
const upload = require('../middleware/upload');
const validateFileUpload = require('../middleware/validateFileUpload');
const { uploadFile, getPublicUrl } = require('../utils/storage');
const logger = require('../utils/logger');
const AppError = require('../utils/appError');

const router = express.Router();

router.use(authenticate);

function cleanPurpose(value) {
  const raw = String(value || 'general').toLowerCase();
  return raw.replace(/[^a-z0-9_-]/g, '-').replace(/-+/g, '-').slice(0, 48) || 'general';
}

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

    const key = await uploadFile(
      req.file.buffer,
      uploadFolder(req, kind),
      req.file.originalname || `${kind}${path.extname(req.file.originalname || '')}`,
      req.file.mimetype
    );

    if (!key) {
      return res.status(503).json({ error: 'File storage is not configured' });
    }

    return res.status(201).json({
      url: getPublicUrl(key),
      key,
      content_type: req.file.mimetype,
      size_bytes: req.file.size,
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
