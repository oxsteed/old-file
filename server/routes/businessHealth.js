const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const ctrl = require('../controllers/businessHealthController');

router.get('/:businessId/health-alerts', requireAuth, ctrl.getAlerts);
router.patch('/:businessId/health-alerts/:id/dismiss', requireAuth, ctrl.dismissAlert);

module.exports = router;
