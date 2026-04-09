const router = require('express').Router();
const { suggest, reverse } = require('../controllers/geoController');

// Public — no auth needed, rate-limited by the global limiter
router.get('/suggest', suggest);
router.get('/reverse', reverse);

module.exports = router;
