'use strict';

const router = require('express').Router();
const { authenticate } = require('../middleware/auth');
const { requireAdmin } = require('../middleware/adminAuth');
const { rejectImpersonated } = require('../middleware/rejectImpersonated');
const { strictLimiter } = require('../middleware/rateLimiter');
const controller = require('../controllers/passkeyController');

router.get('/', authenticate, requireAdmin, controller.listPasskeys);
router.post('/registration/options', authenticate, requireAdmin, rejectImpersonated, strictLimiter, controller.registrationOptions);
router.post('/registration/verify', authenticate, requireAdmin, rejectImpersonated, strictLimiter, controller.verifyRegistration);
router.delete('/:id', authenticate, requireAdmin, rejectImpersonated, strictLimiter, controller.revokePasskey);
// Review P1-118: admin passkey sign-in has one entry point,
// POST /api/auth/login/passkey/options + /api/auth/login/passkey (routes/auth.js).
// The duplicate /api/2fa/passkeys/authentication/* routes were removed.

module.exports = router;
