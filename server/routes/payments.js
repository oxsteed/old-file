const router = require('express').Router();
const { authenticate } = require('../middleware/auth');
const { requireAdmin } = require('../middleware/adminAuth');
const { createConnectAccount, getConnectStatus, createPaymentIntent, capturePayment, refundPayment, getJobPayment, getMyPayments } = require('../controllers/paymentController');
const { errorHandler } = require('../middleware/errorHandler');

// Connect account
router.post('/connect', authenticate, createConnectAccount);
router.get('/connect/status', authenticate, getConnectStatus);

// Payments
router.get('/me', authenticate, getMyPayments);
router.post('/intent', authenticate, createPaymentIntent);
router.post('/capture', authenticate, capturePayment);
router.post('/refund', authenticate, requireAdmin, refundPayment);
router.get('/job/:job_id', authenticate, getJobPayment);

// Route-local JSON error handler for consistent API responses when this router
// is mounted without the global server error handler (tests, serverless, etc.).
router.use(errorHandler);

module.exports = router;
