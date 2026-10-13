// server/routes/helperRegistration.js
const express = require('express');
const router  = express.Router();

const { authenticate } = require('../middleware/auth');
const requireEmailVerified = require('../middleware/requireEmailVerified');
const { requireHelperStep } = require('../middleware/helperOnboardingMiddleware');
const { authLimiter } = require('../middleware/rateLimiter');

const {
  startRegistration,
  verifyOTP,
  resendOTP,
  getCategories,
  saveW9,
  acceptTerms,
  acceptPendingTerms,
  finalizeRegistration,
  submitOnboardingProfile,
  submitBackgroundCheck,
  getOnboardingStatus
} = require('../controllers/helperRegistrationController');

// Public (no auth)
router.post('/start',       authLimiter, startRegistration);
router.post('/verify-otp',  authLimiter, verifyOTP);
router.post('/resend-otp',  authLimiter, resendOTP);
router.post('/send-otp',    authLimiter, resendOTP);  // alias for frontend
router.get('/categories',   getCategories);
// Review P2-482: the deprecated completion endpoint created accounts from an
// email alone and returned 500s. Account creation happens in /verify-otp now.
router.post('/complete',    authLimiter, (_req, res) => res.status(410).json({
  error: 'This step is no longer used. Verify your code to finish creating your account.',
  code: 'endpoint_retired',
}));
// Review P2-2-F08/P2-7-F05: POST /tier was a dead endpoint with no UI
// caller. Tier selection is not part of the redesigned onboarding (W6);
// finalizeRegistration does not require it and membership_tier is managed
// by admins. Retired with 410 Gone rather than left as dead surface.
router.post('/tier',        authenticate, (_req, res) => res.status(410).json({
  error: 'Tier selection is no longer part of helper onboarding.',
  code: 'endpoint_retired',
}));
router.post('/w9',          authenticate, saveW9);
router.post('/accept-terms', authenticate, acceptTerms);
// Review P2-477: records the signup checkbox against the pending registration
// (version, time, hashed IP, user agent) before the account exists.
router.post('/registration-terms', authLimiter, acceptPendingTerms);
router.post('/finalize',    authenticate, requireHelperStep('finalize'), finalizeRegistration);
// Review P2-2-F08/P2-7-F05: POST /payment was a no-op stub ("Payment step
// recorded") with no client caller; removed. POST /profile and
// POST /update-contact were the retired wizard's split profile/contact steps,
// superseded by PUT /onboarding/profile (which sets both profile_completed
// and contact_completed); removed.

// Review P2-2-F08/P2-7-F05: POST /profile-photo has no UI caller and was
// superseded by PUT /api/helper-profile/photo (client-side upload flow).
// Retired with 410 Gone rather than left as dead surface.
router.post('/profile-photo', authenticate, (_req, res) => res.status(410).json({
  error: 'Profile photo upload moved. Update your photo from your helper profile.',
  code: 'endpoint_retired',
}));

// Authenticated + onboarding gated + email verified
router.put('/onboarding/profile',
  authenticate,
  requireEmailVerified,
  requireHelperStep('profile'),
  submitOnboardingProfile
);
// Review P2-2-F08/P2-7-F05: PUT /onboarding/id-verification was a dead state
// reporter with no client caller; identity is owned by the Didit flow
// (/verify-identity + webhook). Removed.
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
