const router = require('express').Router();
const { authenticate, requireRole } = require('../middleware/auth');
const { getCapabilities, getPricing, updatePricing } = require('../controllers/configController');

// Public - anyone can read tier pricing
router.get('/pricing', getPricing);
router.get('/capabilities', getCapabilities);

// Super admin only - update tier pricing
router.put('/pricing', authenticate, requireRole('super_admin'), updatePricing);

module.exports = router;
