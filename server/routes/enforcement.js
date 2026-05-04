/**
 * enforcement.js
 * Routes for admin enforcement actions (warnings, restrictions, suspensions)
 */

const express = require('express');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const enforcementController = require('../controllers/enforcementController');

const router = express.Router();

// Admin routes
router.post('/issue', requireAdmin, enforcementController.issueEnforcementAction);
router.get('/user/:userId', requireAdmin, enforcementController.getUserEnforcementActions);
router.get('/all', requireAdmin, enforcementController.listEnforcementActions);
router.post('/:actionId/deactivate', requireAdmin, enforcementController.deactivateAction);
router.get('/audit-log', requireAdmin, enforcementController.getAuditLog);

module.exports = router;
