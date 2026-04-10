const express = require('express');
const router  = express.Router();
const { suggest, reverse } = require('../controllers/geoController');
const { geoLimiter } = require('../middleware/rateLimiter');

// Public — no auth needed, rate-limited for protection
router.get('/suggest', geoLimiter, suggest);
router.get('/reverse', geoLimiter, reverse);

module.exports = router;
