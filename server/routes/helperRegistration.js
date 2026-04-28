// server/routes/helperRegistration.js
const express = require('express');
const router  = express.Router();

const { authenticate } = require('../middleware/auth');
const requireEmailVerified = require('../middleware/requireEmailVerified');
const { requireOnboardingStep } = require('../middleware/helperOnboardingMiddleware');
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
router.post('/complete',    completeRegistration);
router.post('/tier',        authenticate, saveTier);
router.post('/w9',          authenticate, saveW9);
router.post('/accept-terms', authenticate, acceptTerms);
router.post('/finalize',    authenticate, finalizeRegistration);
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
  requireOnboardingStep('registered'),
  submitOnboardingProfile
);
router.put('/onboarding/id-verification',
  authenticate,
  requireEmailVerified,
  requireOnboardingStep('profile_complete'),
  submitIdVerification
);
router.put('/onboarding/background-check',
  authenticate,
  requireEmailVerified,
  requireOnboardingStep('id_submitted'),
  submitBackgroundCheck
);
router.get('/onboarding/status',
  authenticate,
  getOnboardingStatus
);

module.exports = router;
