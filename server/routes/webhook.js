const express = require('express');
const router = express.Router();
const webhookCtrl = require('../controllers/webhookController');

// Stripe webhook (requires raw body)
router.post('/stripe', express.raw({ type: 'application/json' }), webhookCtrl.stripeWebhook);

// Checkr webhook (placeholder - controller not yet implemented)
router.post('/checkr', (req, res) => {
  console.log('Checkr webhook received:', req.body);
  res.json({ received: true });
});

module.exports = router;
