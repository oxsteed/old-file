'use strict';

const router = require('express').Router();
const { authenticate } = require('../middleware/auth');
const { requireAdmin } = require('../middleware/adminAuth');
const { strictLimiter } = require('../middleware/rateLimiter');
const controller = require('../controllers/passkeyController');

router.get('/', authenticate, requireAdmin, controller.listPasskeys);
router.post('/registration/options', authenticate, requireAdmin, strictLimiter, controller.registrationOptions);
router.post('/registration/verify', authenticate, requireAdmin, strictLimiter, controller.verifyRegistration);
router.delete('/:id', authenticate, requireAdmin, strictLimiter, controller.revokePasskey);
router.post('/authentication/options', strictLimiter, controller.authenticationOptions);
router.post('/authentication/verify', strictLimiter, controller.verifyAuthentication);

module.exports = router;
