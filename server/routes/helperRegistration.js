// server/routes/helperRegistration.js

const express = require('express');
const router  = express.Router();

const { authenticate } = require('../middleware/auth');
const {
  requireHelperLimitedAccess
} = require('../middleware/helperOnboardingMiddleware');

const {
  startHelperRegistration,
  sendOTP,
  resendHelperOTP,
  verifyOTP,
  updateContactInfo,
  completeProfileStep,
  selectTierStep,
  completeW9Step,
  acceptTermsStep,
  finalizeRegistration,
  getCategories
} = require('../controllers/helperRegistrationController');

// ── PUBLIC (no auth required — user does not exist yet) ───────────
router.get('/categories',            getCategories);
router.post('/register/start',       startHelperRegistration);
router.post('/register/send-otp',    sendOTP);
router.post('/register/verify-otp',  verifyOTP);
router.post('/register/resend-otp',  resendHelperOTP);

// ── AUTHENTICATED + LIMITED ACCESS (user exists, email verified,
//    onboarding may still be incomplete) ───────────────────────────
router.post('/register/update-contact', authenticate, requireHelperLimitedAccess, updateContactInfo);
router.post('/register/profile',        authenticate, requireHelperLimitedAccess, completeProfileStep);
router.post('/register/tier',           authenticate, requireHelperLimitedAccess, selectTierStep);
router.post('/register/w9',            authenticate, requireHelperLimitedAccess, completeW9Step);
router.post('/register/accept-terms',   authenticate, requireHelperLimitedAccess, acceptTermsStep);
router.post('/register/finalize',       authenticate, requireHelperLimitedAccess, finalizeRegistration);

module.exports = router;
