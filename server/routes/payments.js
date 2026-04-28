const router = require('express').Router();
const { authenticate } = require('../middleware/auth');
const { requireAdmin } = require('../middleware/adminAuth');
const { createConnectAccount, getConnectStatus, createPaymentIntent, capturePayment, refundPayment, getJobPayment, getMyPayments } = require('../controllers/paymentController');

// Connect account
router.post('/connect', authenticate, createConnectAccount);
router.get('/connect/status', authenticate, getConnectStatus);

// Payments
router.get('/me', authenticate, getMyPayments);
router.post('/intent', authenticate, createPaymentIntent);
router.post('/capture', authenticate, capturePayment);
router.post('/refund', authenticate, requireAdmin, refundPayment);
router.get('/job/:job_id', authenticate, getJobPayment);

module.exports = router;
