const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const requireBusinessAccess = require('../middleware/requireBusinessAccess');
const ctrl = require('../controllers/businessHealthAlertsController');

router.get ('/:businessId/health-alerts',                    requireAuth, requireBusinessAccess({ minRole: 'any' }),     ctrl.listAlerts);
router.post('/:businessId/health-alerts/generate',           requireAuth, requireBusinessAccess({ minRole: 'any' }),     ctrl.generateAlerts);
router.post('/:businessId/health-alerts/:alertId/dismiss',   requireAuth, requireBusinessAccess({ minRole: 'any' }),     ctrl.dismissAlert);

module.exports = router;
