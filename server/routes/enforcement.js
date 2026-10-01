/**
 * enforcement.js
 * Routes for admin enforcement actions (warnings, restrictions, suspensions)
 */

const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { requireAdmin, requirePermission } = require('../middleware/adminAuth');
const enforcementController = require('../controllers/enforcementController');

const router = express.Router();

// Admin routes
router.post('/issue', requireAuth, requireAdmin, enforcementController.issueEnforcementAction);
router.get('/user/:userId', requireAuth, requireAdmin, enforcementController.getUserEnforcementActions);
router.get('/all', requireAuth, requireAdmin, enforcementController.listEnforcementActions);
router.post('/:actionId/deactivate', requireAuth, requireAdmin, enforcementController.deactivateAction);
router.get('/audit-log', requireAuth, requireAdmin, requirePermission('view_audit_log'), enforcementController.getAuditLog);

module.exports = router;
