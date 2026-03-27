const router = require('express').Router();
const ctrl = require('../controllers/helperRegistrationController');

// Public - get service categories
router.get('/categories', ctrl.getCategories);

// Public - registration steps (token-based, no auth needed)
router.post('/start', ctrl.startHelperRegistration);
router.post('/send-otp', ctrl.sendOTP);
router.post('/verify-otp', ctrl.verifyOTP);
router.post('/update-contact', ctrl.updateContact);
router.post('/profile', ctrl.saveHelperProfile);
router.post('/tier', ctrl.selectTier);
router.post('/w9', ctrl.submitW9);
router.post('/accept-terms', ctrl.helperAcceptTerms);
router.post('/finalize', ctrl.finalizeRegistration);
router.post('/resend-otp', ctrl.resendHelperOTP);

module.exports = router;
