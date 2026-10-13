const { fileTypeFromBuffer } = require('file-type');
const logger = require('../utils/logger');
const fileScanService = require('../services/fileScanService');
const { stripExif } = require('../utils/stripExif');
const { dailyQuotaBytes, quotaKeyFor, reserveQuota } = require('./uploadQuota');

// Image formats stripExif can re-encode without metadata. GIF carries no
// EXIF; SVG is normalized to application/octet-stream at storage time.
const EXIF_STRIP_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp']);

/**
 * Middleware to validate uploaded files using magic-bytes (content sniffing).
 * Prevents attackers from bypassing extension-based filters by renaming malicious 
 * files (e.g., shell.php renamed to image.jpg).
 *
 * Also (review P3-6-F07) strips EXIF/GPS metadata from JPEG/PNG/WebP uploads
 * after they pass validation, so every upload surface that uses this
 * middleware stores metadata-free images — not just restaurant-media and
 * media-creator photos. Stripped files are marked with `file.exifStripped`
 * so downstream code does not re-encode them a second time.
 *
 * And (review P3-6-F13) reserves the upload bytes against the caller's daily
 * quota before the (expensive) malware scan runs.
 */
const validateFileUpload = async (req, res, next) => {
  // Support both single file (req.file) and multiple files (req.files) from multer
  const files = [];
  if (req.file) files.push(req.file);
  if (req.files) {
    if (Array.isArray(req.files)) {
      files.push(...req.files);
    } else {
      // Handle field-based uploads { avatar: [...], docs: [...] }
      Object.values(req.files).forEach(f => files.push(...(Array.isArray(f) ? f : [f])));
    }
  }

  if (files.length === 0) return next();

  try {
    // Pass 1: magic-bytes validation for every file.
    for (const file of files) {
      if (!file.buffer || file.buffer.length === 0) continue;

      // Detection using the first few bytes of the buffer
      const detected = await fileTypeFromBuffer(file.buffer);
      file.detectedMime = detected?.mime || null;

      if (!detected) {
        // Some text-based files (txt, csv, json) might not have magic bytes detected by file-type
        // We check the extension as fallback but default to rejection for binary-expected fields
        const safeTextExtensions = ['.txt', '.csv', '.json', '.w9'];
        const ext = require('path').extname(file.originalname).toLowerCase();
        if (!safeTextExtensions.includes(ext)) {
          logger.warn('File type detection failed', { filename: file.originalname, size: file.size });
          return res.status(400).json({ error: 'Security check failed: Could not determine file type.' });
        }
      } else {
        // Check for discrepancies between detected MIME and what the browser/multer reported.
        // If browser says image/jpeg but magic bytes say application/x-php, reject.
        if (file.mimetype && file.mimetype !== detected.mime) {
          const normalizedMime = file.mimetype.replace('x-', '');
          const normalizedDetected = detected.mime.replace('x-', '');

          if (normalizedMime !== normalizedDetected) {
            logger.error('File MIME mismatch identified (Spoofing attempt?)', {
              filename: file.originalname,
              reported: file.mimetype,
              detected: detected.mime,
            });
            return res.status(400).json({ error: 'Security check failed: File content does not match the reported type.' });
          }
        }

        // Final allowlist check for sensitive binary types.
        const blockedMimes = ['application/x-msdownload', 'application/x-sh', 'text/javascript', 'application/javascript'];
        if (blockedMimes.includes(detected.mime)) {
          return res.status(400).json({ error: 'Security violation: Executable or script files are not permitted.' });
        }
      }
    }

    // Pass 2 (review P3-6-F13): reserve the upload bytes against the
    // caller's daily quota before paying for the malware scan. A denied
    // reservation rejects the upload here; an unreachable quota store
    // fails open (logged) so uploads keep working.
    try {
      const newBytes = files.reduce(
        (sum, f) => sum + (Buffer.isBuffer(f.buffer) ? f.buffer.length : 0), 0
      );
      if (newBytes > 0) {
        const userKey = quotaKeyFor(req);
        const quotaBytes = dailyQuotaBytes();
        const allowed = await reserveQuota(userKey, newBytes, quotaBytes);
        if (!allowed) {
          logger.warn('Upload daily quota exceeded', { userKey, bytes: newBytes, quotaBytes });
          return res.status(429).json({
            error: 'Daily upload limit reached. Please try again tomorrow.',
            code: 'upload_quota_exceeded',
          });
        }
      }
    } catch (quotaError) {
      logger.warn('Upload quota check unavailable; allowing upload', { error: quotaError.message });
    }

    // Pass 3: malware scan, then EXIF strip for supported images.
    for (const file of files) {
      if (!file.buffer || file.buffer.length === 0) continue;

      try {
        const scan = await fileScanService.scanBuffer(file.buffer);
        if (!scan || typeof scan.clean !== 'boolean' || typeof scan.provider !== 'string') {
          throw new Error('Malware scanner returned an invalid result');
        }
        if (!scan.clean) {
          logger.warn('Malware scanner rejected upload', {
            filename: file.originalname,
            provider: scan.provider,
            signature: scan.signature || undefined,
          });
          return res.status(400).json({ error: 'Security check failed: The uploaded file was rejected.' });
        }
      } catch (scanError) {
        logger.error('Malware scanner unavailable', {
          filename: file.originalname,
          error: scanError.message,
        });
        return res.status(503).json({ error: 'File security scanning is temporarily unavailable. Please try again.' });
      }

      // Review P3-6-F07: strip EXIF/GPS from images centrally.
      const mime = String(file.detectedMime || file.mimetype || '').toLowerCase();
      if (EXIF_STRIP_MIMES.has(mime) && !file.exifStripped) {
        try {
          const clean = await stripExif(file.buffer);
          file.buffer = clean;
          file.size = clean.length;
          file.exifStripped = true;
        } catch (stripError) {
          logger.warn('EXIF strip failed; rejecting upload', {
            filename: file.originalname,
            error: stripError.message,
          });
          return res.status(400).json({ error: 'Security check failed: The image could not be processed.' });
        }
      }
    }
    next();
  } catch (err) {
    logger.error('File validation error', { err: err.message });
    return res.status(500).json({ error: 'Internal security check failed' });
  }
};

module.exports = validateFileUpload;
