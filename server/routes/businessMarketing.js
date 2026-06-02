const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const requireBusinessAccess = require('../middleware/requireBusinessAccess');
const ctrl = require('../controllers/businessMarketingController');

router.get   ('/:businessId/broadcasts',              requireAuth, requireBusinessAccess({ minRole: 'manager' }), ctrl.listBroadcasts);
router.post  ('/:businessId/broadcasts',              requireAuth, requireBusinessAccess({ minRole: 'manager' }), ctrl.createBroadcast);
router.post  ('/:businessId/broadcasts/:id/send',     requireAuth, requireBusinessAccess({ minRole: 'manager' }), ctrl.sendBroadcast);
router.delete('/:businessId/broadcasts/:id',          requireAuth, requireBusinessAccess({ minRole: 'manager' }), ctrl.deleteBroadcast);

router.get   ('/:businessId/promo-codes',             requireAuth, requireBusinessAccess({ minRole: 'any' }),     ctrl.listPromoCodes);
router.post  ('/:businessId/promo-codes',             requireAuth, requireBusinessAccess({ minRole: 'manager' }), ctrl.createPromoCode);
router.post  ('/:businessId/promo-codes/:codeId/toggle', requireAuth, requireBusinessAccess({ minRole: 'manager' }), ctrl.togglePromoCode);
router.delete('/:businessId/promo-codes/:codeId',     requireAuth, requireBusinessAccess({ minRole: 'manager' }), ctrl.deletePromoCode);

router.post  ('/:businessId/featured-placement-requests', requireAuth, requireBusinessAccess({ minRole: 'manager' }), ctrl.requestFeaturedPlacement);

module.exports = router;
