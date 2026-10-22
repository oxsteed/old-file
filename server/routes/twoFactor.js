// Two-Factor Authentication Routes
// OxSteed v2
const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { rejectImpersonated } = require('../middleware/rejectImpersonated');
const { strictLimiter } = require('../middleware/rateLimiter');
const {
  setup2FA,
  verifySetup,
  validate2FA,
  disable2FA,
  get2FAStatus,
  regenerateBackupCodes
} = require('../controllers/twoFactorController');

// All routes except validate require authentication
// validate is called during login (before full auth)

// Get 2FA status for current user
router.get('/status', authenticate, get2FAStatus);

// Initiate 2FA setup (returns QR code + secret)
// Audit finding 4: an impersonated session must not enroll TOTP on the
// victim's account (it would receive the secret/QR/backup codes and lock
// the victim out). Block impersonated sessions on every 2FA write route.
router.post('/setup', authenticate, rejectImpersonated, strictLimiter, setup2FA);

// Verify setup with code from authenticator app
router.post('/verify-setup', authenticate, rejectImpersonated, strictLimiter, verifySetup);

// Validate 2FA code during login (no auth required - pre-login)
router.post('/validate', strictLimiter, validate2FA);

// Disable 2FA (requires current TOTP code)
router.post('/disable', authenticate, rejectImpersonated, strictLimiter, disable2FA);

// Regenerate backup codes (requires current TOTP code)
router.post('/regenerate-backup', authenticate, rejectImpersonated, strictLimiter, regenerateBackupCodes);

module.exports = router;
