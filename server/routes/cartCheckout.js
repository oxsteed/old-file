const { paymentsLimiter } = require('../middleware/rateLimiter');
const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const checkRestrictions = require('../middleware/checkRestrictions');
const requireEmailVerified = require('../middleware/requireEmailVerified');
const requireTermsAcceptance = require('../middleware/requireTermsAcceptance');

const notAvailable = (req, res) => res.status(503).json({ error: 'Checkout service unavailable' });

let checkoutController;
try {
  checkoutController = require('../controllers/cartCheckoutController');
} catch (err) {
  console.error('Failed to load cartCheckoutController:', err.message);
  checkoutController = {
    getCheckoutSession: notAvailable,
    createPaymentIntent: notAvailable,
    confirmPayment: notAvailable
  };
}

router.get('/:cartId/session', requireAuth, checkoutController.getCheckoutSession || notAvailable);
// Review P2-7-F07: admins must be able to restrict checkout here too.
// Review P2-7-F06/F08: checkout moves money; require verified email and
// current terms like the other payment entry points.
router.post('/:cartId/payment-intent', requireAuth, requireEmailVerified, requireTermsAcceptance, checkRestrictions('checkout'), paymentsLimiter, checkoutController.createPaymentIntent || notAvailable);
router.post('/:cartId/confirm', requireAuth, requireEmailVerified, requireTermsAcceptance, checkRestrictions('checkout'), paymentsLimiter, checkoutController.confirmPayment || notAvailable);

module.exports = router;
