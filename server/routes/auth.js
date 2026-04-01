// Phase 2 - Auth routes
// OxSteed v2

const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
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
router.post('/register', register);
router.post('/login', login);
router.post('/login/2fa', loginWith2FA);
router.post('/otp/request', requestOTP);
router.post('/otp/verify', verifyOTP);
router.post('/forgot-password', forgotPassword);
router.post('/reset-password', resetPassword);
router.post('/refresh', refreshToken);
router.post('/logout', authenticate, logout);
// Customer registration flow (3-step)
router.post('/check-email', checkEmail);
router.post('/check-zip', checkZip);
router.post('/waitlist', addToWaitlist);
router.post('/register/start', startRegistration);
router.post('/register/accept-terms', acceptTerms);
router.post('/register/verify-otp', verifyRegistrationOTP);
router.post('/register/resend-otp', resendRegistrationOTP);
// Settings & Profile routes
router.get('/me', authenticate, getMe);
router.put('/profile', authenticate, updateProfile);
router.put('/change-password', authenticate, changePassword);
router.post('/resend-verification', authenticate, resendVerification);
module.exports = router;
