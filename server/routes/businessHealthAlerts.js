const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const requireBusinessAccess = require('../middleware/requireBusinessAccess');
const ctrl = require('../controllers/businessHealthAlertsController');
// WP-059: operating-health alerts follow the hub tab gate (analytics.view_summary);
// finance-derived alerts additionally need a finance permission (controller).
const requirePermission = require('../middleware/requirePermission');

router.get ('/:businessId/health-alerts',                    requireAuth, requireBusinessAccess({ minRole: 'any' }),     requirePermission('analytics.view_summary'), ctrl.listAlerts);
router.post('/:businessId/health-alerts/generate',           requireAuth, requireBusinessAccess({ minRole: 'any' }),     requirePermission('analytics.view_summary'), ctrl.generateAlerts);
router.post('/:businessId/health-alerts/:alertId/dismiss',   requireAuth, requireBusinessAccess({ minRole: 'any' }),     requirePermission('analytics.view_summary'), ctrl.dismissAlert);

module.exports = router;
