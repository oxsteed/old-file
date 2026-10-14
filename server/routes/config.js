const router = require('express').Router();
const { authenticate, requireRole } = require('../middleware/auth');
// ADM-037: pricing writes sat behind authenticate+requireRole with no TOTP
// enforcement; a TOTP-less admin session could rewrite platform pricing.
const { requireAdminTotp } = require('../middleware/adminAuth');
const { getCapabilities, getPricing, updatePricing } = require('../controllers/configController');

// Public - anyone can read tier pricing
router.get('/pricing', getPricing);
router.get('/capabilities', getCapabilities);

// Super admin only - update tier pricing
router.put('/pricing', authenticate, requireRole('super_admin'), requireAdminTotp, updatePricing);

module.exports = router;
