const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const ctrl = require('../controllers/verificationController');

// Background check (requires auth)
router.post('/background-check', authenticate, ctrl.initiateBackgroundCheck);
router.get('/background-check/status', authenticate, ctrl.getBackgroundCheckStatus);

// Checkr webhook (public - called by Checkr)
// Mounted early in index.js (before express.json()) to preserve raw body for HMAC.
// This route definition is kept for clarity but the request is handled by the
// app-level mount; if reached here the body would already be parsed.
router.post('/webhooks/checkr', ctrl.checkrWebhook);

// Stripe Identity verification (requires auth)
router.post('/identity/session', authenticate, ctrl.createIdentitySession);
router.get('/identity/status', authenticate, ctrl.getIdentityStatus);

// Stripe Identity webhook (public - called by Stripe)
// Mounted early in index.js (before express.json()) to preserve raw body for HMAC.
router.post('/webhooks/identity', ctrl.identityWebhook);

// Badges
router.get('/badges', authenticate, ctrl.getUserBadges);
router.get('/badges/:userId', ctrl.getUserBadges);

module.exports = router;
