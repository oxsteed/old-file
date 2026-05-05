const express = require('express');
const multer = require('multer');
const { requireAuth } = require('../middleware/auth');
const profileImageController = require('../controllers/businessProfileImageController');

const router = express.Router();

// Configure multer for image uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB
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
 * PUT /api/business-profile/cover-image
 * Upload or update business profile cover image
 */
router.put('/cover-image', requireAuth, upload.single('image'), profileImageController.uploadCoverImage);

/**
 * DELETE /api/business-profile/cover-image
 * Delete business profile cover image
 */
router.delete('/cover-image', requireAuth, profileImageController.deleteCoverImage);

/**
 * QR Code Routes
 */

/**
 * GET /api/business-profile/:businessId/qr-code
 * Generate QR code for business profile
 * Query params: size (small/medium/large or custom px), format (dataurl/buffer/svg)
 */
router.get('/:businessId/qr-code', profileImageController.generateQRCode);

/**
 * GET /api/business-profile/:businessId/qr-code/multi-size
 * Generate QR codes in multiple sizes (small, medium, large)
 */
router.get('/:businessId/qr-code/multi-size', profileImageController.generateMultiSizeQRCode);

/**
 * GET /api/business-profile/:businessId/public
 * Get business profile with cover image (public endpoint)
 */
router.get('/:businessId/public', profileImageController.getBusinessProfileWithCover);

module.exports = router;
