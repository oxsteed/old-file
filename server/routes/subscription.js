const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const subCtrl = require('../controllers/subscriptionController');
const verifyCtrl = require('../controllers/verificationController');

// Subscription routes
router.get('/plans', subCtrl.getPlans);
router.post('/checkout', authenticate, subCtrl.createCheckout);
router.get('/current', authenticate, subCtrl.getSubscription);
router.post('/cancel', authenticate, subCtrl.cancelSubscription);
router.post('/portal', authenticate, subCtrl.createPortalSession);

// Background check routes
router.post('/background-check', authenticate, verifyCtrl.initiateBackgroundCheck);
router.get('/background-check/status', authenticate, verifyCtrl.getBackgroundCheckStatus);

// Identity verification routes
router.post('/identity/session', authenticate, verifyCtrl.createIdentitySession);
router.get('/identity/status', authenticate, verifyCtrl.getIdentityStatus);

// Badge routes
router.get('/badges', authenticate, verifyCtrl.getUserBadges);
router.get('/badges/:userId', verifyCtrl.getUserBadges);

module.exports = router;
