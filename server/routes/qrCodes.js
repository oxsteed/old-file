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

// QR generation is a Pro helper feature. A helper can reach Pro through
// the dedicated helper_pro/broker role, a current Pro membership, or an
// active Pro trial. Keep the legacy tier2 value valid during migration.
const requireProTier = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const helperRole = ['helper', 'helper_pro', 'broker'].includes(req.user.role);
  if (!helperRole || !hasProAccess(req.user)) {
    return res.status(403).json({
      error: 'Pro tier required',
      code: 'QR_PRO_REQUIRED',
      message: 'This feature is only available for Pro helpers'
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
