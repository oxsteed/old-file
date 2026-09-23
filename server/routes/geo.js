const express = require('express');
const router  = express.Router();
const { nearby, route, routeMatrix, suggest, reverse } = require('../controllers/geoController');
const { geoLimiter } = require('../middleware/rateLimiter');
const { requireAuth } = require('../middleware/auth');

// Public - no auth needed, rate-limited for protection
router.get('/suggest', geoLimiter, suggest);
router.get('/reverse', geoLimiter, reverse);
router.get('/nearby', geoLimiter, nearby);
router.post('/route', geoLimiter, requireAuth, route);
router.post('/route-matrix', geoLimiter, requireAuth, routeMatrix);

module.exports = router;
