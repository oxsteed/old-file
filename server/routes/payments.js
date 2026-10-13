const router = require('express').Router();
const { authenticate } = require('../middleware/auth');
const { requireAdmin, requirePermission } = require('../middleware/adminAuth');
const { paymentsLimiter, connectAccountLimiter } = require('../middleware/rateLimiter');
const { requireFeatureEnabled } = require('../middleware/featureFlags');
const {
  createConnectAccount,
  getConnectStatus,
  createPaymentIntent,
  capturePayment,
  refundPayment,
  getJobPayment,
  getMyPayments,
  requestInstantPayout,
  disconnectConnectAccount,
  getPayoutBalance,
  getInvestorSummary,
} = require('../controllers/paymentController');
const { errorHandler } = require('../middleware/errorHandler');
const checkRestrictions = require('../middleware/checkRestrictions');
const requireEmailVerified = require('../middleware/requireEmailVerified');
const requireTermsAcceptance = require('../middleware/requireTermsAcceptance');
const { requireOnboardingStep, requireTaxIdentity } = require('../middleware/helperOnboardingMiddleware');

const requirePaymentsEnabled = requireFeatureEnabled('Payments', 'FEATURE_PAYMENTS_ENABLED');

// Connect account
// Review P2-2-F01: creating a payout rail requires finished helper
// onboarding; tax identity (W-9 + fresh Didit) is enforced at payout time,
// not account creation, so helpers are never deadlocked out of onboarding.
router.post('/connect', authenticate, requirePaymentsEnabled, requireOnboardingStep('active'), connectAccountLimiter, createConnectAccount);
router.get('/connect/status', authenticate, requirePaymentsEnabled, getConnectStatus);
router.post('/connect/disconnect', authenticate, requirePaymentsEnabled, connectAccountLimiter, disconnectConnectAccount);
router.get('/payout/balance', authenticate, requirePaymentsEnabled, getPayoutBalance);
// Review P2-2-F01 / P2-2-F11: instant payouts move money, so they require
// finished onboarding AND tax identity (W-9 on file, fresh Didit).
router.post('/payout/instant', authenticate, requirePaymentsEnabled, requireOnboardingStep('active'), requireTaxIdentity, paymentsLimiter, requestInstantPayout);
router.get('/investor-summary', authenticate, requireAdmin, getInvestorSummary);

// Payments
// Review P2-7-F06/F08: moving money requires a verified email and current
// terms acceptance, like job posting and bidding.
router.get('/me', authenticate, requirePaymentsEnabled, getMyPayments);
router.post('/intent', authenticate, requireEmailVerified, requireTermsAcceptance, requirePaymentsEnabled, checkRestrictions('checkout'), paymentsLimiter, createPaymentIntent);
router.post('/capture', authenticate, requireEmailVerified, requireTermsAcceptance, requirePaymentsEnabled, checkRestrictions('checkout'), paymentsLimiter, capturePayment);
router.post('/refund', authenticate, requirePaymentsEnabled, checkRestrictions('checkout'), paymentsLimiter, requireAdmin, requirePermission('issue_refunds'), refundPayment);
router.get('/job/:job_id', authenticate, requirePaymentsEnabled, getJobPayment);

// Route-local JSON error handler for consistent API responses when this router
// is mounted without the global server error handler (tests, serverless, etc.).
router.use(errorHandler);

module.exports = router;
