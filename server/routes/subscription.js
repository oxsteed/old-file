const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const subCtrl = require('../controllers/subscriptionController');

// Subscription routes
router.get('/plans', subCtrl.getPlans);
router.post('/checkout', authenticate, subCtrl.createCheckout);
router.get('/current', authenticate, subCtrl.getSubscription);
router.post('/cancel', authenticate, subCtrl.cancelSubscription);
router.post('/portal', authenticate, subCtrl.createPortalSession);

module.exports = router;
