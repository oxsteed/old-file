const router = require('express').Router();
const authenticate = require('../middleware/authenticate');
const ctrl = require('../controllers/helperRegistrationController');

// Public - get service categories
router.get('/categories', ctrl.getCategories);

// Public - registration steps (token-based, no auth needed)
router.post('/start', ctrl.startHelperRegistration);
router.post('/profile', ctrl.saveHelperProfile);
router.post('/tier', ctrl.selectTier);
router.post('/w9', ctrl.submitW9);
router.post('/payment', ctrl.recordPaymentSetup);
router.post('/accept-terms', ctrl.helperAcceptTerms);
router.post('/verify-otp', ctrl.verifyHelperOTP);
router.post('/resend-otp', ctrl.resendHelperOTP);

module.exports = router;
