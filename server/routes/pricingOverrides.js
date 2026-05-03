const router = require('express').Router();
const { requireSuperAdmin } = require('../middleware/adminAuth');
const ctrl = require('../controllers/pricingOverrideController');

// All pricing override routes require super-admin access
router.get('/', requireSuperAdmin, ctrl.getAllPricingOverrides);
router.get('/comparison', requireSuperAdmin, ctrl.getPricingComparison);
router.get('/:countryCode', requireSuperAdmin, ctrl.getPricingOverride);
router.get('/:countryCode/history', requireSuperAdmin, ctrl.getPricingHistory);
router.put('/:countryCode', requireSuperAdmin, ctrl.updatePricingOverride);
router.post('/batch', requireSuperAdmin, ctrl.batchUpdatePricing);
router.post('/sync-stripe', requireSuperAdmin, ctrl.syncPricesToStripe);

module.exports = router;
