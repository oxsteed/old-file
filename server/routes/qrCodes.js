// QR Code Generator Routes
// Endpoints for creating, retrieving, updating, and deleting QR codes

const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { tierMiddleware } = require('../middleware/tierMiddleware');
const { generalLimiter } = require('../middleware/rateLimiter');
const {
  createQRCode,
  getQRCodes,
  getQRCode,
  updateQRCode,
  deleteQRCode,
  downloadQRCode,
} = require('../controllers/qrCodesController');

// All QR code routes require authentication and Pro tier
router.use(authenticate);
router.use(tierMiddleware('helper_pro'));
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
