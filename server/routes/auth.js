// Phase 2 — Auth routes
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
} = require('../controllers/authController');

router.post('/register', register);
router.post('/login', login);
router.post('/otp/request', requestOTP);
router.post('/otp/verify', verifyOTP);
router.post('/refresh', refreshToken);
router.post('/logout', authenticate, logout);

module.exports = router;
