const router = require('express').Router();
const { authenticate } = require('../middleware/auth');
const ctrl = require('../controllers/verificationController');

// Background check (requires auth)
router.post('/background-check', authenticate, ctrl.initiateBackgroundCheck);
router.get('/background-check/status', authenticate, ctrl.getBackgroundCheckStatus);

// Checkr webhook (public - called by Checkr)
router.post('/webhooks/checkr', ctrl.checkrWebhook);

// Stripe Identity verification (requires auth)
router.post('/identity/session', authenticate, ctrl.createIdentitySession);
router.get('/identity/status', authenticate, ctrl.getIdentityStatus);

// Stripe Identity webhook (public - called by Stripe)
router.post('/webhooks/identity', ctrl.identityWebhook);

// Badges
router.get('/badges', authenticate, ctrl.getUserBadges);
router.get('/badges/:userId', ctrl.getUserBadges);

module.exports = router;
