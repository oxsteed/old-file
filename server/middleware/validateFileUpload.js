const FileType = require('file-type');
const logger = require('../utils/logger');

/**
 * Middleware to validate uploaded files using magic-bytes (content sniffing).
 * Prevents attackers from bypassing extension-based filters by renaming malicious 
 * files (e.g., shell.php renamed to image.jpg).
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
    for (const file of files) {
      if (!file.buffer || file.buffer.length === 0) continue;

      // Detection using the first few bytes of the buffer
      const detected = await FileType.fromBuffer(file.buffer);
      
      if (!detected) {
        // Some text-based files (txt, csv, json) might not have magic bytes detected by file-type
        // We check the extension as fallback but default to rejection for binary-expected fields
        const safeTextExtensions = ['.txt', '.csv', '.json', '.w9'];
        const ext = require('path').extname(file.originalname).toLowerCase();
        if (safeTextExtensions.includes(ext)) continue;

        logger.warn('File type detection failed', { filename: file.originalname, size: file.size });
        return res.status(400).json({ error: `Security check failed: Could not determine file type for ${file.originalname}.` });
      }

      // Check for discrepancies between detected MIME and what the browser/multer reported
      // If browser says image/jpeg but magic bytes say application/x-php, we must reject.
      if (file.mimetype && file.mimetype !== detected.mime) {
        // Minor variations like audio/wav vs audio/x-wav are usually fine
        const normalizedMime = file.mimetype.replace('x-', '');
        const normalizedDetected = detected.mime.replace('x-', '');
        
        if (normalizedMime !== normalizedDetected) {
            logger.error('File MIME mismatch identified (Spoofing attempt?)', { 
                filename: file.originalname, 
                reported: file.mimetype, 
                detected: detected.mime 
            });
            return res.status(400).json({ error: `Security check failed: File content does not match reported extension for ${file.originalname}.` });
        }
      }

      // Final allowlist check for sensitive binary types
      const blockedMimes = ['application/x-msdownload', 'application/x-sh', 'text/javascript', 'application/javascript'];
      if (blockedMimes.includes(detected.mime)) {
          return res.status(400).json({ error: 'Security violation: Executable or script files are not permitted.' });
      }
    }
    next();
  } catch (err) {
    logger.error('File validation error', { err: err.message });
    return res.status(500).json({ error: 'Internal security check failed' });
  }
};

module.exports = validateFileUpload;
