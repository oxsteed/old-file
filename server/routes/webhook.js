const express = require('express');
const router = express.Router();
const webhookCtrl = require('../controllers/webhookController');

// Stripe webhook (requires raw body for signature verification)
router.post('/stripe', express.raw({ type: 'application/json' }), webhookCtrl.stripeWebhook);
router.post('/stripe/connect', express.raw({ type: 'application/json' }), (req, res, next) => {
  req.stripeWebhookDestination = 'connect';
  return webhookCtrl.stripeWebhook(req, res, next);
});

// Didit identity webhook (requires raw body for HMAC verification)
router.post('/didit', express.raw({ type: 'application/json' }), webhookCtrl.diditWebhook);

module.exports = router;
