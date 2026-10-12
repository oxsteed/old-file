// server/routes/helperRegistration.js
const express = require('express');
const router  = express.Router();

const { authenticate } = require('../middleware/auth');
const requireEmailVerified = require('../middleware/requireEmailVerified');
const { requireHelperStep } = require('../middleware/helperOnboardingMiddleware');
const { authLimiter } = require('../middleware/rateLimiter');
const upload = require('../middleware/upload');
const validateFileUpload = require('../middleware/validateFileUpload');

const {
  startRegistration,
  verifyOTP,
  resendOTP,
  getCategories,
  completeRegistration,
  saveTier,
  saveW9,
  acceptTerms,
  acceptPendingTerms,
  finalizeRegistration,
  savePaymentStep,
  submitOnboardingProfile,
  submitIdVerification,
  submitBackgroundCheck,
  submitProfile,
  updateContact,
  uploadProfilePhoto,
  getOnboardingStatus
} = require('../controllers/helperRegistrationController');

// Public (no auth)
router.post('/start',       authLimiter, startRegistration);
router.post('/verify-otp',  authLimiter, verifyOTP);
router.post('/resend-otp',  authLimiter, resendOTP);
router.post('/send-otp',    authLimiter, resendOTP);  // alias for frontend
router.get('/categories',   getCategories);
router.post('/complete',    authLimiter, completeRegistration);
router.post('/tier',        authenticate, saveTier);
router.post('/w9',          authenticate, saveW9);
router.post('/accept-terms', authenticate, acceptTerms);
// Review P2-477: records the signup checkbox against the pending registration
// (version, time, hashed IP, user agent) before the account exists.
router.post('/registration-terms', authLimiter, acceptPendingTerms);
router.post('/finalize',    authenticate, requireHelperStep('finalize'), finalizeRegistration);
router.post('/payment',     authenticate, savePaymentStep);

// Authenticated - profile + contact + photo (frontend Step4)
// Email verification required to submit helper profile
router.post('/profile', authenticate, requireEmailVerified, submitProfile);
router.post('/update-contact', authenticate, requireEmailVerified, updateContact);
router.post('/profile-photo', authenticate, requireEmailVerified, upload.single('photo'), validateFileUpload, uploadProfilePhoto);

// Authenticated + onboarding gated + email verified
router.put('/onboarding/profile',
  authenticate,
  requireEmailVerified,
  requireHelperStep('profile'),
  submitOnboardingProfile
);
router.put('/onboarding/id-verification',
  authenticate,
  requireEmailVerified,
  requireHelperStep('identity'),
  submitIdVerification
);
router.put('/onboarding/background-check',
  authenticate,
  requireEmailVerified,
  requireHelperStep('background'),
  submitBackgroundCheck
);
router.get('/onboarding/status',
  authenticate,
  getOnboardingStatus
);

module.exports = router;
