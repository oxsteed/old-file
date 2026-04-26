const express = require('express');
const router = express.Router();
const consultingPaymentController = require('../controllers/consultingPaymentController');
const { authenticate } = require('../middleware/auth');
const { generalLimiter, strictLimiter } = require('../middleware/rateLimiter');

// Public packages list — rate-limited to prevent enumeration / DoS.
router.get('/packages', generalLimiter, consultingPaymentController.getPackages);

// Authenticated payment endpoints. Strict rate limit on intent creation to
// prevent payment-intent flooding (each one creates a real Stripe object).
router.post('/payment-intent', strictLimiter, authenticate, consultingPaymentController.createPaymentIntent);
router.post('/confirm-payment', authenticate, consultingPaymentController.confirmPayment);
router.get('/payment/:paymentId/status', authenticate, consultingPaymentController.getPaymentStatus);
router.post('/refund', strictLimiter, authenticate, consultingPaymentController.refundPayment);

module.exports = router;
