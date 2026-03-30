const multer = require('multer');
const path = require('path');

const storage = multer.memoryStorage();

const fileFilter = (req, file, cb) => {
    const allowed = ['.jpg', '.jpeg', '.png', '.gif', '.pdf', '.doc', '.docx', '.webm', '.mp4', '.mov', '.mp3', '.wav', '.ogg'];
  const ext = path.extname(file.originalname).toLowerCase();
  if (allowed.includes(ext)) {
    cb(null, true);
  } else {
    cb(new Error('File type not allowed'), false);
  }
};

const upload = multer({
  storage,
  fileFilter,
    limits: { fileSize: 50 * 1024 * 1024 } // 50MB
});

module.exports = upload;
