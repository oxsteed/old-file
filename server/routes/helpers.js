// server/routes/helpers.js
// Public helper discovery — no authentication required.
// Authenticated endpoints for the logged-in helper's own settings are also here.

const express = require('express');
const router  = express.Router();
const { listHelpers, getHelperProfile, getHelperStatus, searchSkills, searchLicenses, getHelperAvailability, getHelperPricing, getHelperSlots, toggleListing, getMyListingStatus } = require('../controllers/helpersController');
const { generalLimiter } = require('../middleware/rateLimiter');
const { authenticate } = require('../middleware/auth');

// ── Authenticated helper-owner endpoints (must come before /:id wildcards) ──
router.get('/me/listing',  authenticate, getMyListingStatus);
router.put('/me/listing',  authenticate, toggleListing);

// ── Public directory endpoints ───────────────────────────────────────────────
router.get('/',              generalLimiter, listHelpers);
router.get('/skills',        generalLimiter, searchSkills);
router.get('/licenses',      generalLimiter, searchLicenses);
router.get('/:id/status',    generalLimiter, getHelperStatus);
router.get('/:id/profile',   generalLimiter, getHelperProfile);

// Dynamic endpoints (client-side fetched after page load) — Issue #35
router.get('/:id/availability', generalLimiter, getHelperAvailability);
router.get('/:id/pricing',      generalLimiter, getHelperPricing);
router.get('/:id/slots',        generalLimiter, getHelperSlots);

module.exports = router;
