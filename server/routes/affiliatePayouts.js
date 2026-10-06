const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { requireFeatureEnabled } = require('../middleware/featureFlags');
const affiliatePayoutsController = require('../controllers/affiliatePayoutsController');
const AffiliateAnalyticsController = require('../controllers/AffiliateAnalyticsController');

// Audit fix: affiliate system is gated behind a feature flag (defaults off).
// The UI is hidden but the API was fully live.
router.use(requireFeatureEnabled('Affiliate', 'AFFILIATE_ENABLED', false));

// ── Stats (must be before /:programId to avoid route clash) ──────────────
router.get('/stats/all', requireAuth, affiliatePayoutsController.getAffiliateStats);

// ── Payouts ───────────────────────────────────────────────────────────────
router.get('/schedule', requireAuth, affiliatePayoutsController.getPayoutsSchedule);
router.post('/calculate', requireAuth, affiliatePayoutsController.calculateAndCreatePayout);
router.post('/:payoutId/process', requireAuth, affiliatePayoutsController.processPayout);

// ── Programs ──────────────────────────────────────────────────────────────
router.post('/', requireAuth, affiliatePayoutsController.createAffiliateProgram);
router.get('/', requireAuth, affiliatePayoutsController.getAffiliatePrograms);
router.get('/:programId', requireAuth, affiliatePayoutsController.getAffiliateProgram);

// ── Commissions ───────────────────────────────────────────────────────────
router.get('/:programId/commissions', requireAuth, affiliatePayoutsController.getAffiliateCommissions);

// ── Analytics ─────────────────────────────────────────────────────────────
router.get('/:program_id/analytics/metrics',  requireAuth, AffiliateAnalyticsController.getMetricsTimeSeries);
router.get('/:program_id/analytics/funnel',   requireAuth, AffiliateAnalyticsController.getConversionFunnel);
router.get('/:program_id/analytics/products', requireAuth, AffiliateAnalyticsController.getTopProducts);
router.get('/:program_id/analytics/visitors', requireAuth, AffiliateAnalyticsController.getVisitorFunnel);
router.get('/:program_id/analytics/sources',  requireAuth, AffiliateAnalyticsController.getSourceBreakdown);
router.get('/:program_id/analytics/product/:product_id', requireAuth, AffiliateAnalyticsController.getProductAnalytics);

module.exports = router;
