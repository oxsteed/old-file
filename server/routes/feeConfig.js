const router = require('express').Router();
const { requireAdmin, requireSuperAdmin, requirePermission } = require('../middleware/adminAuth');
const { strictLimiter } = require('../middleware/rateLimiter');
const { rejectImpersonated } = require('../middleware/rejectImpersonated');
const { requireAdminActionStepup, issueAdminActionStepup } = require('../middleware/adminActionStepup');
const ctrl = require('../controllers/feeConfigController');

// All fee config routes require admin access
router.get('/', requireAdmin, requirePermission('view_financials'), ctrl.getFeeConfig);
router.get('/history', requireAdmin, requirePermission('view_financials'), ctrl.getFeeHistory);
router.post('/stepup-challenges', requireSuperAdmin, strictLimiter, rejectImpersonated, issueAdminActionStepup('fee_config_update'));
router.put('/', requireSuperAdmin, strictLimiter, rejectImpersonated, requireAdminActionStepup('fee_config_update'), ctrl.updateFeeConfig);
router.post('/preview', requireAdmin, requirePermission('view_financials'), ctrl.previewFees);
router.post('/reset', requireSuperAdmin, strictLimiter, rejectImpersonated, requireAdminActionStepup('fee_config_update'), ctrl.resetToDefaults);

module.exports = router;
