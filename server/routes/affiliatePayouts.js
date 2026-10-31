const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { requireAdmin, requirePermission } = require('../middleware/adminAuth');
const { strictLimiter } = require('../middleware/rateLimiter');
const { rejectImpersonated } = require('../middleware/rejectImpersonated');
const { requireFeatureEnabled } = require('../middleware/featureFlags');
const { verifyStepupChallenge } = require('../services/stepupChallengeService');
const affiliatePayoutsController = require('../controllers/affiliatePayoutsController');
const AffiliateAnalyticsController = require('../controllers/AffiliateAnalyticsController');

// Audit fix: affiliate system is gated behind a feature flag (defaults off).
// The UI is hidden but the API was fully live.
router.use(requireFeatureEnabled('Affiliate', 'AFFILIATE_ENABLED', false));

// ── Stats (must be before /:programId to avoid route clash) ──────────────
router.get('/stats/all', requireAuth, affiliatePayoutsController.getAffiliateStats);

// ── Payouts ───────────────────────────────────────────────────────────────
router.get('/schedule', requireAuth, affiliatePayoutsController.getPayoutsSchedule);
router.post('/calculate', strictLimiter, requireAuth, affiliatePayoutsController.calculateAndCreatePayout);
// Review P3-787: processing moves real money, so it is an admin action with
// the financials grant, rate-limited and audited.
// ADM-040: processing moves real money; impersonated sessions are blocked.
// Audit fix (item 3): the maker must prove a fresh step-up challenge before
// the controller touches the processor, mirroring the legacy payout route.
// Previously below-threshold payouts on this route moved on a single admin
// session alone; the dual gate only queues at/above threshold.
router.post(
  '/:payoutId/process',
  requireAdmin,
  rejectImpersonated,
  requirePermission('view_financials'),
  strictLimiter,
  async (req, res, next) => {
    try {
      await verifyStepupChallenge({
        challengeId: req.body?.stepupChallengeId || req.body?.stepup_challenge_id,
        actorUserId: req.user?.id || null,
        actionType: 'affiliate_payout_process',
        code: req.body?.stepupCode || req.body?.stepup_code,
      });
      return affiliatePayoutsController.processPayout(req, res, next);
    } catch (err) {
      return next(err);
    }
  }
);

// Audit fix (auth finding 15, issuance track): the maker step-up on the
// process routes needs an issue path. The generic admin issue endpoint
// gates on the TOTP-only list, which deliberately excludes
// 'affiliate_payout_process' (email method), so this dedicated endpoint
// issues it with the payout's payable amount. Same guards as the process
// route itself; the issued challenge verifies on either process route,
// since verification keys on action type and actor, not on route.
router.post(
  '/:payoutId/stepup-challenges',
  requireAdmin,
  rejectImpersonated,
  requirePermission('view_financials'),
  strictLimiter,
  affiliatePayoutsController.issueProcessStepupChallenge
);

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
