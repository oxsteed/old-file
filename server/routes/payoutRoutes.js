const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { requireAdmin, requirePermission } = require('../middleware/adminAuth');
// advancedRateLimiter.js was removed during the audit remediation; strictLimiter
// (10/hour, per-IP) is the remaining generic strict bucket for admin money moves.
const { strictLimiter } = require('../middleware/rateLimiter');
const PayoutController = require('../controllers/PayoutController');
const AffiliateAnalyticsController = require('../controllers/AffiliateAnalyticsController');

// Payout Methods (User Routes)
router.get('/payout-methods', requireAuth, PayoutController.getPayoutMethods);
router.post('/payout-methods', requireAuth, PayoutController.createPayoutMethod);
router.put('/payout-methods/:method_id', requireAuth, PayoutController.updatePayoutMethod);
router.delete('/payout-methods/:method_id', requireAuth, PayoutController.deletePayoutMethod);

// Payouts (User Routes)
router.get('/schedule', requireAuth, PayoutController.getPayouts);
router.get('/:payout_id', requireAuth, PayoutController.getPayout);
router.get('/stats/payout', requireAuth, PayoutController.getPayoutStats);

// Process Payout (Admin Route)
// C9: any authenticated user must NOT reach this. Admin plus the financials
// grant (the catalogue scope that covers payouts), rate-limited, and the
// controller itself refuses to run until a real money processor is wired.
router.post(
  '/:payout_id/process',
  requireAdmin,
  requirePermission('view_financials'),
  strictLimiter,
  PayoutController.processPayout
);

// Analytics Routes
router.get('/:program_id/analytics/metrics', requireAuth, AffiliateAnalyticsController.getMetricsTimeSeries);
router.get('/:program_id/analytics/funnel', requireAuth, AffiliateAnalyticsController.getConversionFunnel);
router.get('/:program_id/analytics/top-products', requireAuth, AffiliateAnalyticsController.getTopProducts);
router.get('/:program_id/analytics/product/:product_id', requireAuth, AffiliateAnalyticsController.getProductAnalytics);
router.get('/:program_id/analytics/visitors', requireAuth, AffiliateAnalyticsController.getVisitorFunnel);
router.get('/:program_id/analytics/sources', requireAuth, AffiliateAnalyticsController.getSourceBreakdown);

module.exports = router;
