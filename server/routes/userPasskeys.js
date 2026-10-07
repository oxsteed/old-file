'use strict';

const router = require('express').Router();
const { authenticate } = require('../middleware/auth');
const { rejectImpersonated } = require('../middleware/rejectImpersonated');
const { strictLimiter } = require('../middleware/rateLimiter');
const controller = require('../controllers/userPasskeyController');

router.get('/', authenticate, controller.listPasskeys);
// Registration and revocation are credential-management operations.
// Block impersonated sessions from planting or removing lasting credentials.
router.post('/registration/options', authenticate, rejectImpersonated, strictLimiter, controller.registrationOptions);
router.post('/registration/verify', authenticate, rejectImpersonated, strictLimiter, controller.verifyRegistration);
router.delete('/:id', authenticate, rejectImpersonated, strictLimiter, controller.revokePasskey);
router.patch('/:id', authenticate, rejectImpersonated, strictLimiter, controller.renamePasskey);
router.post('/authentication/options', strictLimiter, controller.authenticationOptions);
router.post('/authentication/verify', strictLimiter, controller.verifyAuthentication);

module.exports = router;
