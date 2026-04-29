const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const checkoutController = require('../controllers/cartCheckoutController');

router.get('/:cartId/session', requireAuth, checkoutController.getCheckoutSession);
router.post('/:cartId/payment-intent', requireAuth, checkoutController.createPaymentIntent);
router.post('/:cartId/confirm', requireAuth, checkoutController.confirmPayment);

module.exports = router;
