const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { requireAdmin, requirePermission } = require('../middleware/adminAuth');
const { rejectImpersonated } = require('../middleware/rejectImpersonated');
const { requireUserTotpStepUp } = require('../middleware/requireUserTotpStepUp');
const { verifyStepupChallenge } = require('../services/stepupChallengeService');
// advancedRateLimiter.js was removed during the audit remediation; strictLimiter
// (10/hour, per-IP) is the remaining generic strict bucket for admin money moves.
const { strictLimiter } = require('../middleware/rateLimiter');
const PayoutController = require('../controllers/PayoutController');
const AffiliateAnalyticsController = require('../controllers/AffiliateAnalyticsController');
const { requireOnboardingStep } = require('../middleware/helperOnboardingMiddleware');

// Payout Methods (User Routes)
// Review P2-2-F01: registering or changing a payout destination is a money
// path; helpers must have finished onboarding first. Reads stay open.
// Audit fix (auth finding 20): payout-method writes are the classic
// account-takeover payout-redirection vector. Writes require a fresh TOTP
// proof (totp_code in the body), verified against the helper's enrolled
// secret, on top of onboarding. Fail closed when TOTP is not enrolled.
router.get('/payout-methods', requireAuth, PayoutController.getPayoutMethods);
router.post('/payout-methods', requireAuth, requireUserTotpStepUp, requireOnboardingStep('active'), PayoutController.createPayoutMethod);
router.put('/payout-methods/:method_id', requireAuth, requireUserTotpStepUp, requireOnboardingStep('active'), PayoutController.updatePayoutMethod);
router.delete('/payout-methods/:method_id', requireAuth, requireUserTotpStepUp, requireOnboardingStep('active'), PayoutController.deletePayoutMethod);

// Payouts (User Routes)
router.get('/schedule', requireAuth, PayoutController.getPayouts);
router.get('/:payout_id', requireAuth, PayoutController.getPayout);
router.get('/stats/payout', requireAuth, PayoutController.getPayoutStats);

// Process Payout (Admin Route)
// C9: any authenticated user must NOT reach this. Admin plus the financials
// grant (the catalogue scope that covers payouts), rate-limited, and the
// controller itself refuses to run until a real money processor is wired.
// Audit fix (auth finding 15): processing moves affiliate money on a single
// admin's say-so. Impersonated sessions are blocked, and the acting admin
// must prove a fresh step-up challenge before the controller touches the
// processor. (The newer /api/affiliate route additionally gates
// above-threshold payouts through dual approval; this route keeps the
// direct-execution semantics with the maker step-up added here.)
router.post(
  '/:payout_id/process',
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
      return PayoutController.processPayout(req, res);
    } catch (err) {
      return next(err);
    }
  }
);

// Analytics Routes
router.get('/:program_id/analytics/metrics', requireAuth, AffiliateAnalyticsController.getMetricsTimeSeries);
router.get('/:program_id/analytics/funnel', requireAuth, AffiliateAnalyticsController.getConversionFunnel);
router.get('/:program_id/analytics/top-products', requireAuth, AffiliateAnalyticsController.getTopProducts);
router.get('/:program_id/analytics/product/:product_id', requireAuth, AffiliateAnalyticsController.getProductAnalytics);
router.get('/:program_id/analytics/visitors', requireAuth, AffiliateAnalyticsController.getVisitorFunnel);
router.get('/:program_id/analytics/sources', requireAuth, AffiliateAnalyticsController.getSourceBreakdown);

module.exports = router;
