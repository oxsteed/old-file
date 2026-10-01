const router = require('express').Router();
const { requireAdmin, requireSuperAdmin, requirePermission } = require('../middleware/adminAuth');
const ctrl = require('../controllers/feeConfigController');

// All fee config routes require admin access
router.get('/', requireAdmin, requirePermission('view_financials'), ctrl.getFeeConfig);
router.get('/history', requireAdmin, requirePermission('view_financials'), ctrl.getFeeHistory);
router.put('/', requireSuperAdmin, ctrl.updateFeeConfig);
router.post('/preview', requireAdmin, requirePermission('view_financials'), ctrl.previewFees);
router.post('/reset', requireSuperAdmin, ctrl.resetToDefaults);

module.exports = router;
