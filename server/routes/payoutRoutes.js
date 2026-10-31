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

// Auth audit item 6: the payout's payable amount for step-up binding
// (the same canonical figure the gate uses). A missing row skips binding;
// the controller reports it with its own error. Note: no issue endpoint
// exists for affiliate_payout_process today, so this step-up cannot
// currently be satisfied through any supported path; binding the verify
// side is still correct and harmless, and adding an issue endpoint would
// enable a currently-dead money route, which is a product decision, not
// this fix's call. A pre-read failure also skips binding (never a new
// error); the controller re-reads the row under its own handling.
async function resolveAffiliateStepupAmount(req) {
  try {
    const pool = require('../db');
    const { affiliatePayableCents } = require('../utils/affiliatePayableCents');
    const { rows } = await pool.query('SELECT * FROM affiliate_payouts WHERE id = $1', [req.params.payout_id]);
    if (!rows.length) return null;
    const n = Number(affiliatePayableCents(rows[0]));
    return Number.isSafeInteger(n) && n > 0 ? n : null;
  } catch (preReadError) {
    require('../utils/logger').warn('payoutRoutes.process stepup pre-read failed, skipping amount binding', { payoutId: req.params.payout_id, error: preReadError.message });
    return null;
  }
}

// Process Payout (Admin Route)
// C9: any authenticated user must NOT reach this. Admin plus the financials
// grant (the catalogue scope that covers payouts), rate-limited, and the
// controller itself refuses to run until a real money processor is wired.
// Audit fix (auth finding 15): processing moves affiliate money on a single
// admin's say-so. Impersonated sessions are blocked, and the acting admin
// must prove a fresh step-up challenge before the controller touches the
// processor. Pentest fix: the controller now runs the same dual-approval
// gate as the newer /api/affiliate route, so above-threshold payouts queue
// for a second admin instead of executing directly; below the threshold
// the direct-execution semantics are unchanged.
router.post(
  '/:payout_id/process',
  requireAdmin,
  rejectImpersonated,
  requirePermission('view_financials'),
  strictLimiter,
  async (req, res, next) => {
    try {
      // Auth audit item 6: bind to the payout's payable amount.
      const affiliateExpectedAmount = await resolveAffiliateStepupAmount(req);
      await verifyStepupChallenge({
        challengeId: req.body?.stepupChallengeId || req.body?.stepup_challenge_id,
        actorUserId: req.user?.id || null,
        actionType: 'affiliate_payout_process',
        code: req.body?.stepupCode || req.body?.stepup_code,
        ...(affiliateExpectedAmount !== null ? { expectedAmountCents: affiliateExpectedAmount } : {}),
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
