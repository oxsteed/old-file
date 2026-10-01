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
  getInvestorSummary,
} = require('../controllers/paymentController');
const { errorHandler } = require('../middleware/errorHandler');

const requirePaymentsEnabled = requireFeatureEnabled('Payments', 'FEATURE_PAYMENTS_ENABLED');

// Connect account
router.post('/connect', authenticate, requirePaymentsEnabled, connectAccountLimiter, createConnectAccount);
router.get('/connect/status', authenticate, requirePaymentsEnabled, getConnectStatus);
router.post('/connect/disconnect', authenticate, requirePaymentsEnabled, connectAccountLimiter, disconnectConnectAccount);
router.post('/payout/instant', authenticate, requirePaymentsEnabled, paymentsLimiter, requestInstantPayout);
router.get('/investor-summary', authenticate, getInvestorSummary);

// Payments
router.get('/me', authenticate, requirePaymentsEnabled, getMyPayments);
router.post('/intent', authenticate, requirePaymentsEnabled, paymentsLimiter, createPaymentIntent);
router.post('/capture', authenticate, requirePaymentsEnabled, paymentsLimiter, capturePayment);
router.post('/refund', authenticate, requirePaymentsEnabled, paymentsLimiter, requireAdmin, requirePermission('issue_refunds'), refundPayment);
router.get('/job/:job_id', authenticate, requirePaymentsEnabled, getJobPayment);

// Route-local JSON error handler for consistent API responses when this router
// is mounted without the global server error handler (tests, serverless, etc.).
router.use(errorHandler);

module.exports = router;
