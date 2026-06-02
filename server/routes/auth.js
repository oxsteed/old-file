// Phase 2 - Auth routes
// OxSteed v2

const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { authLimiter, strictLimiter, passwordResetLimiter } = require('../middleware/rateLimiter');
const {
  register,
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
const { errorHandler } = require('../middleware/errorHandler');

// Original routes
router.post('/register', authLimiter, register);
router.post('/login', authLimiter, login);
router.post('/login/2fa', authLimiter, loginWith2FA);
router.get('/internal-access/config', logisticsInternalAccessCtrl.getRouteConfig);
router.post('/internal-access/verify', strictLimiter, logisticsInternalAccessCtrl.verifyInternalAccess);
router.post('/internal-access/login', authLimiter, logisticsInternalAccessCtrl.loginWithInternalAccess);
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
router.post('/reset-password', passwordResetLimiter, resetPassword);
router.post('/refresh', authLimiter, refreshToken);
router.post('/logout', logout);

// Customer registration flow (3-step)
router.post('/check-email', authLimiter, checkEmail);
router.post('/check-zip', authLimiter, checkZip);
router.post('/waitlist', authLimiter, addToWaitlist);
router.post('/register/start', authLimiter, startRegistration);
router.post('/register/accept-terms', authLimiter, acceptTerms);
router.post('/register/verify-otp', authLimiter, verifyRegistrationOTP);
router.post('/register/resend-otp', authLimiter, resendRegistrationOTP);

// Settings & Profile routes
router.get('/me', authenticate, getMe);
router.put('/profile', authenticate, updateProfile);
router.patch('/me', authenticate, updateProfile);
router.put('/change-password', authenticate, changePassword);
router.post('/change-email', authenticate, changeEmail);
router.post('/confirm-email-change', authenticate, confirmEmailChange);
router.post('/resend-verification', authenticate, resendVerification);

// Role switching (customer ↔ helper)
router.post('/switch-role', authenticate, switchRole);

// Route-local error handler so this router returns JSON errors even when mounted
// in isolation (tests, serverless handlers, etc.). In the full server, this also
// prevents falling through to a generic HTML error response.
router.use(errorHandler);

module.exports = router;
