const path = require('path');

// Use the existing upload volume so QR images survive application deployments.
const QR_UPLOAD_DIR = path.join(
  process.env.LOCAL_UPLOAD_DIR || path.join(__dirname, '../runtime/uploads'),
  'qr-codes',
);
const LEGACY_QR_UPLOAD_DIRS = [
  path.join(__dirname, '../../public/qr-codes'),
  path.join(__dirname, '../public/qr-codes'),
];

module.exports = { QR_UPLOAD_DIR, LEGACY_QR_UPLOAD_DIRS };
