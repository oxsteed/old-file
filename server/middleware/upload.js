const multer = require('multer');
const path = require('path');

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
  // Review P3-6-F18: the job-post client accepts these phone-camera formats;
  // the server used to reject them with 400 after the upload completed.
  '.m4v':  ['video/x-m4v', 'video/mp4'],
  '.3gp':  ['video/3gpp'],
  '.3g2':  ['video/3gpp2'],
  '.mp3':  ['audio/mpeg'],
  '.wav':  ['audio/wav', 'audio/x-wav'],
  '.ogg':  ['audio/ogg', 'video/ogg'],
};

const fileFilter = (req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase();
  const allowedMimes = ALLOWED[ext];
  if (!allowedMimes) {
    const error = new Error('File type not allowed');
    error.statusCode = 400;
    error.code = 'invalid_file_type';
    return cb(error, false);
  }
  if (!allowedMimes.includes(file.mimetype)) {
    const error = new Error('File type not allowed');
    error.statusCode = 400;
    error.code = 'invalid_file_type';
    return cb(error, false);
  }
  cb(null, true);
};

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB
    // Bound multipart metadata as well as file bytes to reduce parser DoS risk.
    fieldNameSize: 100,
    fieldSize: 64 * 1024,
    fields: 30,
    files: 10,
    parts: 40,
    headerPairs: 200,
  },
});

module.exports = upload;
