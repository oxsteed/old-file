const router     = require('express').Router();
const { generalLimiter } = require('../middleware/rateLimiter');
const { authenticate }   = require('../middleware/auth');
const {
  getPrograms,
  getWholesale,
  joinWholesale,
} = require('../controllers/growthController');

// Public — no auth required
router.get('/programs',  generalLimiter, getPrograms);
router.get('/wholesale', generalLimiter, getWholesale);

// Auth required — join a wholesale listing
router.post('/wholesale/:id/join', authenticate, joinWholesale);

module.exports = router;
