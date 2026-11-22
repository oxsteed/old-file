'use strict';

const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/investorInvitationController');
const { authenticate } = require('../middleware/auth');
const { requireAdmin, requirePermission } = require('../middleware/adminAuth');
const { strictLimiter } = require('../middleware/rateLimiter');

// Private admission control plane. No public route creates investor access.
router.post('/verify', strictLimiter, ctrl.verify);
router.post('/accept', strictLimiter, ctrl.accept);
router.post('/accept-existing', authenticate, strictLimiter, ctrl.accept);
router.post('/admin', authenticate, requireAdmin, requirePermission('manage_users'), strictLimiter, ctrl.create);
router.post('/admin/:id/revoke', authenticate, requireAdmin, requirePermission('manage_users'), strictLimiter, ctrl.revoke);

module.exports = router;
