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
  '.mp3':  ['audio/mpeg'],
  '.wav':  ['audio/wav', 'audio/x-wav'],
  '.ogg':  ['audio/ogg', 'video/ogg'],
};

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

module.exports = upload;
