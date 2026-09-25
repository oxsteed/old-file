// QR Code Generator Routes
// Endpoints for creating, retrieving, updating, and deleting QR codes

const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { generalLimiter } = require('../middleware/rateLimiter');
const { hasProAccess } = require('../utils/trial');
const {
  createQRCode,
  getQRCodes,
  getQRCode,
  updateQRCode,
  deleteQRCode,
  downloadQRCode,
} = require('../controllers/qrCodesController');

// QR generation is a Pro feature. Any authenticated account with a current
// Pro membership or first-year Pro trial can use it, regardless of mode.
const requireProTier = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  if (!hasProAccess(req.user)) {
    return res.status(403).json({
      error: 'Pro tier required',
      code: 'QR_PRO_REQUIRED',
      message: 'This feature is available with Pro access'
    });
  }
  next();
};

// All QR code routes require authentication and Pro tier
router.use(authenticate);
router.use(requireProTier);
router.use(generalLimiter);

// Create new QR code
router.post('/', createQRCode);

// Get all QR codes for user
router.get('/', getQRCodes);

// Get single QR code
router.get('/:id', getQRCode);

// Update QR code
router.put('/:id', updateQRCode);

// Delete QR code
router.delete('/:id', deleteQRCode);

// Download QR code (with analytics tracking)
router.post('/:id/download', downloadQRCode);

module.exports = router;
