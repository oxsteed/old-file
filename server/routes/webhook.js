const express = require('express');
const router = express.Router();
const webhookCtrl = require('../controllers/webhookController');

// Stripe webhook (requires raw body for signature verification)
router.post('/stripe', express.raw({ type: 'application/json' }), webhookCtrl.stripeWebhook);

// Didit identity webhook (requires raw body for HMAC verification)
router.post('/didit', express.raw({ type: 'application/json' }), webhookCtrl.diditWebhook);

module.exports = router;
