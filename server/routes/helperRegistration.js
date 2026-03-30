// server/routes/helperRegistration.js
const express = require('express');
const router  = express.Router();

const { authenticate } = require('../middleware/auth');
const { requireOnboardingStep, requireTier } = require('../middleware/helperOnboardingMiddleware');
const upload = require('../middleware/upload');

const {
  startRegistration,
  verifyOTP,
  resendOTP,
  completeRegistration,
  submitOnboardingProfile,
  submitIdVerification,
  submitBackgroundCheck,
  submitProfile,
  updateContact,
  uploadProfilePhoto,
  getOnboardingStatus
} = require('../controllers/helperRegistrationController');

// Public (no auth)
router.post('/start',       startRegistration);
router.post('/verify-otp',  verifyOTP);
router.post('/resend-otp',  resendOTP);
router.post('/send-otp',    resendOTP);  // alias for frontend
router.post('/complete',    completeRegistration);

// Authenticated - profile + contact + photo (frontend Step4)
router.post('/profile', authenticate, submitProfile);
router.post('/update-contact', authenticate, updateContact);
router.post('/profile-photo', authenticate, upload.single('photo'), uploadProfilePhoto);

// Authenticated + onboarding gated
router.put('/onboarding/profile',
  authenticate,
  requireOnboardingStep('registered'),
  submitOnboardingProfile
);
router.put('/onboarding/id-verification',
  authenticate,
  requireOnboardingStep('profile_complete'),
  submitIdVerification
);
router.put('/onboarding/background-check',
  authenticate,
  requireOnboardingStep('id_submitted'),
  submitBackgroundCheck
);
router.get('/onboarding/status',
  authenticate,
  getOnboardingStatus
);

module.exports = router;
