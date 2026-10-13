'use strict';

const { AppError } = require('./errorHandler');

const ALLOWED_IMAGE_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp']);

function imageFileFilter(req, file, cb) {
  if (ALLOWED_IMAGE_MIMES.has(file.mimetype)) return cb(null, true);
  return cb(new AppError('Invalid file type. Only JPEG, PNG, and WebP are allowed.', 400, 'invalid_file_type'));
}

module.exports = imageFileFilter;
module.exports.ALLOWED_IMAGE_MIMES = ALLOWED_IMAGE_MIMES;
