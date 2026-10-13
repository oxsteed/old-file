const express = require('express');
const router = express.Router();
const consultingPaymentController = require('../controllers/consultingPaymentController');
const { authenticate } = require('../middleware/auth');
const { requireAdmin, requirePermission } = require('../middleware/adminAuth');
const { generalLimiter, strictLimiter } = require('../middleware/rateLimiter');
const checkRestrictions = require('../middleware/checkRestrictions');

// Public packages list - rate-limited to prevent enumeration / DoS.
router.get('/packages', generalLimiter, consultingPaymentController.getPackages);

// Authenticated payment endpoints. Strict rate limit on intent creation to
// prevent payment-intent flooding (each one creates a real Stripe object).
// Review P2-7-F07: consulting payment intent/confirm are checkout surfaces.
router.post('/payment-intent', strictLimiter, authenticate, checkRestrictions('checkout'), consultingPaymentController.createPaymentIntent);
router.post('/confirm-payment', strictLimiter, authenticate, checkRestrictions('checkout'), consultingPaymentController.confirmPayment);
router.get('/payment/:paymentId/status', authenticate, consultingPaymentController.getPaymentStatus);
// T25-F01: consulting refunds require the issue_refunds grant, like all other
// refund paths, not just an admin role.
router.post('/refund', strictLimiter, authenticate, requireAdmin, requirePermission('issue_refunds'), consultingPaymentController.refundPayment);

module.exports = router;
