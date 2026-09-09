'use strict';

const multer = require('multer');
const path = require('path');

const allowedTypes = new Map([
  ['.pdf', 'application/pdf'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.png', 'image/png'],
  ['.webp', 'image/webp'],
  ['.gif', 'image/gif'],
]);

// Shipment documents are inspected by magic bytes after multer accepts them.
// Keep the route-specific allowlist narrow because these files may be shared with operators.
module.exports = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 20 * 1024 * 1024,
    fieldNameSize: 100,
    fieldSize: 64 * 1024,
    fields: 20,
    files: 1,
    parts: 22,
    headerPairs: 200,
  },
  fileFilter: (req, file, cb) => {
    const extension = path.extname(file.originalname || '').toLowerCase();
    const expectedMime = allowedTypes.get(extension);
    if (!expectedMime || file.mimetype !== expectedMime) {
      const error = new Error('Only PDF, JPEG, PNG, WebP, and GIF shipment documents are allowed.');
      error.statusCode = 400;
      error.code = 'invalid_file_type';
      return cb(error);
    }
    cb(null, true);
  },
});
