const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const ctrl = require('../controllers/verificationController');

// Background check (requires auth)
router.post('/background-check', authenticate, ctrl.initiateBackgroundCheck);
router.get('/background-check/status', authenticate, ctrl.getBackgroundCheckStatus);

// NOTE: Webhook handlers (checkrWebhook, identityWebhook) are intentionally NOT
// in this router. They are mounted directly in index.js with express.raw() before
// express.json() so they receive a raw Buffer for HMAC signature verification.
// Including them here would expose them via the /api/subscription/* alias mounts
// where express.json() has already parsed the body, causing the handlers to crash.

// Stripe Identity verification (requires auth)
router.post('/identity/session', authenticate, ctrl.createIdentitySession);
router.get('/identity/status', authenticate, ctrl.getIdentityStatus);

// Badges
router.get('/badges', authenticate, ctrl.getUserBadges);
router.get('/badges/:userId', ctrl.getUserBadges);

module.exports = router;
