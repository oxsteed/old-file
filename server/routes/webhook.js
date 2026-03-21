const express = require('express');
const router = express.Router();
const webhookCtrl = require('../controllers/webhookController');

// Stripe webhook (requires raw body)
router.post('/stripe', express.raw({ type: 'application/json' }), webhookCtrl.handleStripeWebhook);

// Checkr webhook
router.post('/checkr', webhookCtrl.handleCheckrWebhook);

module.exports = router;
