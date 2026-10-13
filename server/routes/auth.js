// Phase 2 - Auth routes
// OxSteed v2

const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { authLimiter, loginLimiter, authSessionLimiter, authLookupLimiter, strictLimiter, passwordResetLimiter, passwordResetVerifyLimiter } = require('../middleware/rateLimiter');
const { verifyCaptcha } = require('../middleware/verifyCaptcha'); // audit L1 hook point (off by default)
const {
  login,
  loginWith2FA,
  requestOTP,
  verifyOTP,
  forgotPassword,
  resetPassword,
  refreshToken,
  logout,
  // Customer registration flow
  checkEmail,
  checkZip,
  addToWaitlist,
  startRegistration,
  acceptTerms,
  verifyRegistrationOTP,
  resendRegistrationOTP,
  // Settings & Profile
  getMe,
  updateProfile,
  changePassword,
  changeEmail,
  confirmEmailChange,
  resendVerification,
  switchRole,
} = require('../controllers/authController');
const logisticsInternalAccessCtrl = require('../controllers/logisticsInternalAccessController');
const passkeyCtrl = require('../controllers/passkeyController');
const { errorHandler } = require('../middleware/errorHandler');

// Original routes (legacy single-step POST /register removed 2026-09-29;
// /join + the 3-step /register/* flow is the single customer signup path)
router.post('/login', loginLimiter, login);
router.post('/login/2fa', loginLimiter, loginWith2FA);
router.post('/login/passkey/options', strictLimiter, passkeyCtrl.authenticationOptions);
router.post('/login/passkey', strictLimiter, passkeyCtrl.verifyAuthentication);
router.get('/internal-access/config', strictLimiter, logisticsInternalAccessCtrl.getRouteConfig);
router.post('/internal-access/verify', strictLimiter, logisticsInternalAccessCtrl.verifyInternalAccess);
router.post('/internal-access/login', loginLimiter, logisticsInternalAccessCtrl.loginWithInternalAccess);
// Recovery — only emails on ACCESS_GATE_RECOVERY_EMAILS can actually trigger
// the send; we still rate-limit the endpoint to prevent allowlist enumeration.
router.post('/internal-access/recovery/request', strictLimiter, logisticsInternalAccessCtrl.requestRecovery);
router.post('/internal-access/recovery/use', strictLimiter, logisticsInternalAccessCtrl.useRecovery);
router.post('/otp/request', authLimiter, requestOTP);
router.post('/otp/verify', authLimiter, verifyOTP);
// Backward-compatible aliases used by older web/mobile clients.
router.post('/request-otp', authLimiter, requestOTP);
router.post('/verify-otp', authLimiter, verifyOTP);
router.post('/forgot-password', passwordResetLimiter, forgotPassword);
// L2: /reset-password only reads {token, password}; it gets its own
// token-keyed limiter (the email-keyed one above always missed here).
router.post('/reset-password', passwordResetVerifyLimiter, resetPassword);
router.post('/refresh', authSessionLimiter, refreshToken);
router.post('/logout', authSessionLimiter, logout);

// Customer registration flow (3-step)
router.post('/check-email', authLookupLimiter, verifyCaptcha, checkEmail);
router.post('/check-zip', authLookupLimiter, checkZip);
router.post('/waitlist', authLimiter, addToWaitlist);
router.post('/register/start', authLimiter, startRegistration);
router.post('/register/accept-terms', authLimiter, acceptTerms);
router.post('/register/verify-otp', authLimiter, verifyRegistrationOTP);
router.post('/register/resend-otp', authLimiter, resendRegistrationOTP);

// Settings & Profile routes
router.get('/me', authenticate, getMe);
router.put('/profile', authLimiter, authenticate, updateProfile);
router.patch('/me', authLimiter, authenticate, updateProfile);
router.put('/change-password', authLimiter, authenticate, changePassword);
router.post('/change-email', authLimiter, authenticate, changeEmail);
router.post('/confirm-email-change', authLimiter, authenticate, confirmEmailChange);
router.post('/resend-verification', authLimiter, authenticate, resendVerification);

// Role switching (customer ↔ helper)
router.post('/switch-role', authLimiter, authenticate, switchRole);

// Route-local error handler so this router returns JSON errors even when mounted
// in isolation (tests, serverless handlers, etc.). In the full server, this also
// prevents falling through to a generic HTML error response.
router.use(errorHandler);

module.exports = router;
