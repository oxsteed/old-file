const router = require('express').Router();
const { requireAdmin, requireSuperAdmin } = require('../middleware/adminAuth');
const ctrl = require('../controllers/feeConfigController');

// All fee config routes require admin access
router.get('/', requireAdmin, ctrl.getFeeConfig);
router.get('/history', requireAdmin, ctrl.getFeeHistory);
router.put('/', requireSuperAdmin, ctrl.updateFeeConfig);
router.post('/preview', requireAdmin, ctrl.previewFees);
router.post('/reset', requireSuperAdmin, ctrl.resetToDefaults);

module.exports = router;
