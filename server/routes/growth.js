const router     = require('express').Router();
const { generalLimiter } = require('../middleware/rateLimiter');
const { authenticate }   = require('../middleware/auth');
const {
  getPrograms,
  getWholesale,
  joinWholesale,
  submitFinancingPreQual,
  getGrants,
} = require('../controllers/growthController');

// Public — no auth required
router.get('/programs',  generalLimiter, getPrograms);
router.get('/wholesale', generalLimiter, getWholesale);
router.get('/grants',    generalLimiter, getGrants);

// Auth required — join a wholesale listing
router.post('/wholesale/:id/join', authenticate, joinWholesale);
router.post('/financing/pre-qual', authenticate, submitFinancingPreQual);

module.exports = router;
