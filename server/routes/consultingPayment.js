const express = require('express');
const router = express.Router();
const consultingPaymentController = require('../controllers/consultingPaymentController');
const { authenticate } = require('../middleware/auth');

// Get available packages (public)
router.get('/packages', consultingPaymentController.getPackages);

// Authenticated endpoints
router.post('/payment-intent', authenticate, consultingPaymentController.createPaymentIntent);
router.post('/confirm-payment', authenticate, consultingPaymentController.confirmPayment);
router.get('/payment/:paymentId/status', authenticate, consultingPaymentController.getPaymentStatus);
router.post('/refund', authenticate, consultingPaymentController.refundPayment);

module.exports = router;
