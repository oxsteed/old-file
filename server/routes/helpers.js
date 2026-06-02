// server/routes/helpers.js
// Public helper discovery - no authentication required.
// Authenticated endpoints for the logged-in helper's own settings are also here.

const express = require('express');
const router  = express.Router();
const { listHelpers, getHelperProfile, getHelperStatus, searchSkills, searchLicenses, getHelperAvailability, getHelperPricing, getHelperSlots, toggleListing, getMyListingStatus, getMyAvailability, toggleAvailability, removeCredential } = require('../controllers/helpersController');
const { getHelperProfileQRCodePng } = require('../controllers/helperProfileImageController');
const {
  listHelperInvoices, createHelperInvoice, updateHelperInvoice,
  markHelperInvoicePaid, deleteHelperInvoice, sendHelperInvoice,
} = require('../controllers/businessInvoiceController');
const { generalLimiter, directoryLimiter } = require('../middleware/rateLimiter');
const { authenticate } = require('../middleware/auth');
const { requireAdmin } = require('../middleware/adminAuth');

// ── Admin-only endpoints (must come before /:id wildcards) ────────────────────
router.post('/:id/remove-credential', requireAdmin, removeCredential);

// ── Authenticated helper-owner endpoints (must come before /:id wildcards) ──
router.get('/me/listing',       authenticate, getMyListingStatus);
router.put('/me/listing',       authenticate, toggleListing);
router.get('/me/availability',  authenticate, getMyAvailability);
router.put('/me/availability',  authenticate, toggleAvailability);

// ── Helper invoices (authenticated, helper-scoped) ─────────────────────────────
router.get('/invoices',                        authenticate, listHelperInvoices);
router.post('/invoices',                       authenticate, createHelperInvoice);
router.put('/invoices/:invoiceId',             authenticate, updateHelperInvoice);
router.post('/invoices/:invoiceId/pay',        authenticate, markHelperInvoicePaid);
router.post('/invoices/:invoiceId/send',       authenticate, sendHelperInvoice);
router.delete('/invoices/:invoiceId',          authenticate, deleteHelperInvoice);

// ── Public directory endpoints ───────────────────────────────────────────────
// SECURITY: Use directoryLimiter (stricter) to prevent bulk enumeration
router.get('/',              directoryLimiter, listHelpers);
router.get('/list',          directoryLimiter, listHelpers);
router.get('/skills',        generalLimiter, searchSkills);
router.get('/licenses',      generalLimiter, searchLicenses);
router.get('/:id/status',    generalLimiter, getHelperStatus);
router.get('/:id/profile-qr.png', generalLimiter, getHelperProfileQRCodePng);
router.get('/:id/profile',   generalLimiter, getHelperProfile);

// Dynamic endpoints (client-side fetched after page load) - Issue #35
router.get('/:id/availability', generalLimiter, getHelperAvailability);
router.get('/:id/pricing',      generalLimiter, getHelperPricing);
router.get('/:id/slots',        generalLimiter, getHelperSlots);

// Weekly availability template — used by BidAcceptanceModal to show free slots
const helperAvailabilityCtrl = require('../controllers/helperAvailabilityController');
router.get('/:helperId/available-slots', generalLimiter, helperAvailabilityCtrl.getAvailableSlots);

module.exports = router;
