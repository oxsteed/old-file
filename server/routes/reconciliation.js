'use strict';

/**
 * Reconciliation exception workspace routes (admin only).
 *
 * Mounted under /api/admin/reconciliation.
 */

const router = require('express').Router();
const { requireAdmin, requirePermission } = require('../middleware/adminAuth');
const reconciliationController = require('../controllers/reconciliationController');

router.get('/', requireAdmin, requirePermission('view_financials'), reconciliationController.listExceptions);
router.post('/exceptions/:id/assign', requireAdmin, requirePermission('view_financials'), reconciliationController.assignException);
router.post('/exceptions/:id/acknowledge', requireAdmin, requirePermission('view_financials'), reconciliationController.acknowledgeException);
router.post('/exceptions/:id/resolve', requireAdmin, requirePermission('view_financials'), reconciliationController.resolveException);

module.exports = router;
