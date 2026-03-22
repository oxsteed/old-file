const router = require('express').Router();
const { authenticate, requireRole } = require('../middleware/auth');
const { getPricing, updatePricing } = require('../controllers/configController');

// Public — anyone can read tier pricing
router.get('/pricing', getPricing);

// Super admin only — update tier pricing
router.put('/pricing', authenticate, requireRole('super_admin'), updatePricing);

module.exports = router;
