const express = require('express');
const multer = require('multer');
const { requireAuth } = require('../middleware/auth');
const validateFileUpload = require('../middleware/validateFileUpload');
const imageFileFilter = require('../middleware/imageFileFilter');
const profileImageController = require('../controllers/businessProfileImageController');

const router = express.Router();
const { scopeExempt } = require('../middleware/scopeGates');

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
  fileFilter: imageFileFilter,
});

/**
 * Cover Image Routes
 */

/**
 * PUT /api/business-profile/cover-image
 * Upload or update business profile cover image
 */
router.put('/cover-image', requireAuth, upload.single('image'), validateFileUpload, profileImageController.uploadCoverImage);

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
router.get('/:businessId/qr-code', scopeExempt('public-storefront'), profileImageController.generateQRCode);

/**
 * GET /api/business-profile/:businessId/qr-code/multi-size
 * Generate QR codes in multiple sizes (small, medium, large)
 */
router.get('/:businessId/qr-code/multi-size', scopeExempt('public-storefront'), profileImageController.generateMultiSizeQRCode);

/**
 * GET /api/business-profile/:businessId/public
 * Get business profile with cover image (public endpoint)
 */
router.get('/:businessId/public', scopeExempt('public-storefront'), profileImageController.getBusinessProfileWithCover);

module.exports = router;
