// Phase 2 - Auth routes
// OxSteed v2

const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { authLimiter, strictLimiter } = require('../middleware/rateLimiter');
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
  resendVerification
} = require('../controllers/authController');

// Original routes
router.post('/register', authLimiter, register);
router.post('/login', authLimiter, login);
router.post('/login/2fa', authLimiter, loginWith2FA);
router.post('/otp/request', authLimiter, requestOTP);
router.post('/otp/verify', authLimiter, verifyOTP);
router.post('/forgot-password', strictLimiter, forgotPassword);
router.post('/reset-password', strictLimiter, resetPassword);
router.post('/refresh', authLimiter, refreshToken);
router.post('/logout', authenticate, logout);

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
router.put('/change-password', authenticate, changePassword);
router.post('/resend-verification', authenticate, resendVerification);

module.exports = router;
