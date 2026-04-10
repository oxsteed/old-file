// server/routes/helpers.js
// Public helper discovery — no authentication required.

const express = require('express');
const router  = express.Router();
const { listHelpers, getHelperProfile, getHelperStatus, searchSkills, searchLicenses, getHelperAvailability, getHelperPricing, getHelperSlots } = require('../controllers/helpersController');
const { generalLimiter } = require('../middleware/rateLimiter');

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
