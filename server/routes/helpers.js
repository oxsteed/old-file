// server/routes/helpers.js
// Public helper discovery — no authentication required.

const express = require('express');
const router  = express.Router();
const { listHelpers, getHelperProfile, getHelperStatus, searchSkills, searchLicenses, getHelperAvailability, getHelperPricing, getHelperSlots } = require('../controllers/helpersController');

router.get('/',              listHelpers);
router.get('/skills',        searchSkills);
router.get('/licenses',      searchLicenses);
router.get('/:id/status',    getHelperStatus);
router.get('/:id/profile',   getHelperProfile);

// Dynamic endpoints (client-side fetched after page load) — Issue #35
router.get('/:id/availability', getHelperAvailability);
router.get('/:id/pricing',     getHelperPricing);
router.get('/:id/slots',       getHelperSlots);

module.exports = router;
