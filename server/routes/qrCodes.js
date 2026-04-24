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
  generateQRWithLogo,
  getTemplates,
  savePreset,
  getPresets,
  deletePreset,
  createBatch,
  getBatches,
  generateBatchQRCodes,
} = require('../controllers/qrCodesController');

// All QR code routes require authentication and Pro tier
router.use(authenticate);
router.use(tierMiddleware('helper_pro'));
router.use(generalLimiter);

// Generate QR code with embedded logo (server-side)
router.post('/generate-with-logo', generateQRWithLogo);

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

// ────────────────────────────────────────────────────────────────────────────
// TEMPLATES
// ────────────────────────────────────────────────────────────────────────────

// Get available preset templates (public, no auth needed for listing)
router.get('/templates/list', getTemplates);

// ────────────────────────────────────────────────────────────────────────────
// PRESETS - Save and manage user's styling presets
// ────────────────────────────────────────────────────────────────────────────

// Save a new preset
router.post('/presets/save', savePreset);

// Get all presets for the user
router.get('/presets/list', getPresets);

// Delete a preset
router.delete('/presets/:presetId', deletePreset);

// ────────────────────────────────────────────────────────────────────────────
// BATCH GENERATION - Generate multiple QR codes at once
// ────────────────────────────────────────────────────────────────────────────

// Create a new batch
router.post('/batches/create', createBatch);

// Get all batches for the user
router.get('/batches/list', getBatches);

// Generate QR codes from a batch
router.post('/batches/:batchId/generate', generateBatchQRCodes);

module.exports = router;
