// server/routes/helpers.js
// Public helper discovery — no authentication required.

const express = require('express');
const router  = express.Router();
const { listHelpers, getHelperProfile, getHelperStatus, searchSkills, searchLicenses } = require('../controllers/helpersController');

router.get('/',             listHelpers);
router.get('/skills',       searchSkills);
router.get('/licenses',     searchLicenses);
router.get('/:id/status',   getHelperStatus);
router.get('/:id/profile',  getHelperProfile);

module.exports = router;
