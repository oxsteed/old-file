const express = require('express');
const multer = require('multer');
const { requireAuth } = require('../middleware/auth');
const validateFileUpload = require('../middleware/validateFileUpload');
const profileImageController = require('../controllers/helperProfileImageController');

const router = express.Router();

// Configure multer for image uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB
    fieldNameSize: 100,
    fieldSize: 64 * 1024,
    fields: 10,
    files: 1,
    parts: 12,
    headerPairs: 200,
  },
  fileFilter: (req, file, cb) => {
    const allowedMimes = ['image/jpeg', 'image/png', 'image/webp'];
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only JPEG, PNG, and WebP are allowed.'));
    }
  }
});

/**
 * Cover Image Routes
 */

/**
 * PUT /api/helper-profile/cover-image
 * Upload or update helper profile cover image
 */
router.put('/cover-image', requireAuth, upload.single('image'), validateFileUpload, profileImageController.uploadCoverImage);

/**
 * DELETE /api/helper-profile/cover-image
 * Delete helper profile cover image
 */
router.delete('/cover-image', requireAuth, profileImageController.deleteCoverImage);

/**
 * QR Code Routes
 */

/**
 * GET /api/helper-profile/:helperId/qr-code
 * Generate QR code for helper profile
 * Query params: size (small/medium/large or custom px), format (dataurl/buffer/svg)
 */
router.get('/:helperId/qr-code', profileImageController.generateQRCode);

/**
 * GET /api/helper-profile/:helperId/qr-code/multi-size
 * Generate QR codes in multiple sizes (small, medium, large)
 */
router.get('/:helperId/qr-code/multi-size', profileImageController.generateMultiSizeQRCode);

/**
 * GET /api/helper-profile/:helperId/public
 * Get helper profile with cover image (public endpoint)
 */
router.get('/:helperId/public', profileImageController.getHelperProfileWithCover);

module.exports = router;
