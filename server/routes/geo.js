const router = require('express').Router();
const { suggest } = require('../controllers/geoController');

// Public — no auth needed, rate-limited by the global limiter
router.get('/suggest', suggest);

module.exports = router;
