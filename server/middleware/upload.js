const multer  = require('multer');
const path    = require('path');
const { fileTypeFromBuffer } = require('file-type');

const storage = multer.memoryStorage();

// Allowed extension → allowed MIME types mapping
const ALLOWED = {
  '.jpg':  ['image/jpeg'],
  '.jpeg': ['image/jpeg'],
  '.png':  ['image/png'],
  '.gif':  ['image/gif'],
  '.webp': ['image/webp'],
  '.pdf':  ['application/pdf'],
  '.doc':  ['application/msword'],
  '.docx': ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  '.webm': ['video/webm'],
  '.mp4':  ['video/mp4'],
  '.mov':  ['video/quicktime'],
  '.mp3':  ['audio/mpeg'],
  '.wav':  ['audio/wav', 'audio/x-wav'],
  '.ogg':  ['audio/ogg', 'video/ogg'],
};

// First pass: reject obviously disallowed extensions/MIME types at upload time
const fileFilter = (req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase();
  const allowedMimes = ALLOWED[ext];
  if (!allowedMimes) {
    return cb(new Error('File type not allowed'), false);
  }
  if (!allowedMimes.includes(file.mimetype)) {
    return cb(new Error('File type not allowed'), false);
  }
  cb(null, true);
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
});

/**
 * Magic-byte validation middleware.
 *
 * Run this AFTER multer (multer must buffer the file first).
 * Reads the actual file bytes and confirms the real type matches
 * the claimed extension — catches renamed executables and other
 * disguised files that slip past extension/MIME checks.
 *
 * Usage (in a route):
 *   router.post('/upload', upload.single('file'), validateMagicBytes, handler);
 *   router.post('/upload', upload.array('files'), validateMagicBytes, handler);
 */
async function validateMagicBytes(req, res, next) {
  // Gather all uploaded files (single or array)
  const files = req.files
    ? (Array.isArray(req.files) ? req.files : Object.values(req.files).flat())
    : (req.file ? [req.file] : []);

  if (files.length === 0) return next();

  for (const file of files) {
    const ext = path.extname(file.originalname).toLowerCase();
    const allowedMimes = ALLOWED[ext];

    // fileTypeFromBuffer reads the first bytes and returns the real type
    const detected = await fileTypeFromBuffer(file.buffer);

    if (!detected) {
      // No recognisable magic bytes — could be a plain text file (.doc before
      // Office XML era) or a genuinely unknown binary. Reject to be safe.
      return res.status(400).json({ error: 'Could not verify file type' });
    }

    if (!allowedMimes.includes(detected.mime)) {
      return res.status(400).json({
        error: `File content does not match its extension (detected: ${detected.mime})`,
      });
    }
  }

  next();
}

module.exports = { upload, validateMagicBytes };
