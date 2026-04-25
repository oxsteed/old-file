const express = require('express');
const router = express.Router();
const paymentController = require('../controllers/consultingPaymentController');
const { authenticate } = require('../middleware/auth');
const { generalLimiter } = require('../middleware/rateLimiter');

router.post('/payment-intent', authenticate, generalLimiter, paymentController.createPaymentIntent);
router.post('/confirm-purchase', authenticate, paymentController.confirmPurchase);
router.get('/my-purchases', authenticate, paymentController.listUserPurchases);
router.get('/invoices', authenticate, paymentController.getInvoices);
router.post('/webhook', express.raw({ type: 'application/json' }), paymentController.handlePaymentWebhook);

module.exports = router;
