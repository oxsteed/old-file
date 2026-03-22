// Phase 2 - Auth routes
// OxSteed v2

const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const {
  register,
  login,
  requestOTP,
  verifyOTP,
  refreshToken,
  logout,
  // Customer registration flow
  checkEmail,
  checkZip,
  addToWaitlist,
  startRegistration,
  acceptTerms,
  verifyRegistrationOTP,
  resendRegistrationOTP
} = require('../controllers/authController');

const {
  getCategories,
  startHelperRegistration,
  saveHelperProfile,
  selectTier,
  submitW9,
  recordPaymentSetup,
  helperAcceptTerms,
  verifyHelperOTP,
  resendHelperOTP
} = require('../controllers/helperRegistrationController');

// Original routes
router.post('/register', register);
router.post('/login', login);
router.post('/otp/request', requestOTP);
router.post('/otp/verify', verifyOTP);
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

// Helper registration flow (7-step)
router.get('/helper/categories', getCategories);
router.post('/helper/register/start', startHelperRegistration);
router.post('/helper/register/profile', saveHelperProfile);
router.post('/helper/register/tier', selectTier);
router.post('/helper/register/w9', submitW9);
router.post('/helper/register/payment', recordPaymentSetup);
router.post('/helper/register/accept-terms', helperAcceptTerms);
router.post('/helper/register/verify-otp', verifyHelperOTP);
router.post('/helper/register/resend-otp', resendHelperOTP);

module.exports = router;
