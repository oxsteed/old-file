const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');

let checkoutController;
try {
  checkoutController = require('../controllers/cartCheckoutController');
} catch (err) {
  console.error('Failed to load cartCheckoutController:', err.message);
  checkoutController = {};
}

const notAvailable = (req, res) => res.status(503).json({ error: 'Checkout service unavailable' });

router.get('/:cartId/session', requireAuth, checkoutController.getCheckoutSession || notAvailable);
router.post('/:cartId/payment-intent', requireAuth, checkoutController.createPaymentIntent || notAvailable);
router.post('/:cartId/confirm', requireAuth, checkoutController.confirmPayment || notAvailable);

module.exports = router;
