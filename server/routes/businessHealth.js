const express = require('express');
const router = express.Router();
const requireBusinessAccess = require('../middleware/requireBusinessAccess');
const { requireAuth } = require('../middleware/auth');
const ctrl = require('../controllers/businessHealthController');

router.get('/:businessId/health-alerts', requireAuth, requireBusinessAccess({ minRole: 'any', resolvePermissions: false }), ctrl.getAlerts);
router.patch('/:businessId/health-alerts/:id/dismiss', requireAuth, requireBusinessAccess({ minRole: 'any', resolvePermissions: false }), ctrl.dismissAlert);

module.exports = router;
