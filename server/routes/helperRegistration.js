const router = require('express').Router();
const ctrl = require('../controllers/helperRegistrationController');
const { authenticate } = require('../middleware/auth');
const {
  requireHelperLimitedAccess,
  requireCompletedHelperOnboarding
} = require('../middleware/helperOnboardingMiddleware');

// Public - get service categories
router.get('/categories', ctrl.getCategories);

// Public - registration steps (token-based, no auth needed)
router.post('/start', ctrl.startHelperRegistration);
router.post('/send-otp', ctrl.sendOTP);
router.post('/verify-otp', ctrl.verifyOTP);
router.post('/resend-otp', ctrl.resendHelperOTP);

// Step 3: Limited-access routes (helper must be verified but onboarding can be incomplete)
// These are routes the helper needs BEFORE full onboarding is complete
router.post('/update-contact', authenticate, requireHelperLimitedAccess, ctrl.updateContact);
router.post('/profile', authenticate, requireHelperLimitedAccess, ctrl.saveHelperProfile);
router.post('/tier', authenticate, requireHelperLimitedAccess, ctrl.selectTier);
router.post('/w9', authenticate, requireHelperLimitedAccess, ctrl.submitW9);
router.post('/accept-terms', authenticate, requireHelperLimitedAccess, ctrl.helperAcceptTerms);
router.post('/finalize', authenticate, requireHelperLimitedAccess, ctrl.finalizeRegistration);

module.exports = router;
