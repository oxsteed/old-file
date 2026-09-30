'use strict';

/**
 * Reconciliation exception workspace routes (admin only).
 *
 * Mounted under /api/admin/reconciliation.
 */

const router = require('express').Router();
const { requireAdmin } = require('../middleware/adminAuth');
const reconciliationController = require('../controllers/reconciliationController');

router.get('/', requireAdmin, reconciliationController.listExceptions);
router.post('/exceptions/:id/assign', requireAdmin, reconciliationController.assignException);
router.post('/exceptions/:id/acknowledge', requireAdmin, reconciliationController.acknowledgeException);
router.post('/exceptions/:id/resolve', requireAdmin, reconciliationController.resolveException);

module.exports = router;
