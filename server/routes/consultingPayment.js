const express = require('express');
const router = express.Router();
const consultingPaymentController = require('../controllers/consultingPaymentController');
const { authenticate } = require('../middleware/auth');
const { requireAdmin, requirePermission } = require('../middleware/adminAuth');
const { generalLimiter, strictLimiter } = require('../middleware/rateLimiter');

// Public packages list - rate-limited to prevent enumeration / DoS.
router.get('/packages', generalLimiter, consultingPaymentController.getPackages);

// Authenticated payment endpoints. Strict rate limit on intent creation to
// prevent payment-intent flooding (each one creates a real Stripe object).
router.post('/payment-intent', strictLimiter, authenticate, consultingPaymentController.createPaymentIntent);
router.post('/confirm-payment', strictLimiter, authenticate, consultingPaymentController.confirmPayment);
router.get('/payment/:paymentId/status', authenticate, consultingPaymentController.getPaymentStatus);
// T25-F01: consulting refunds require the issue_refunds grant, like all other
// refund paths, not just an admin role.
router.post('/refund', strictLimiter, authenticate, requireAdmin, requirePermission('issue_refunds'), consultingPaymentController.refundPayment);

module.exports = router;
