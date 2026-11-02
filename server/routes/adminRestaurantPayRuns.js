'use strict';

// Admin pay-run reads (finding 25), mounted at /api/admin/restaurant-pay-runs.
// Read-only; mutations live on the merchant pay-run routes.

const router = require('express').Router();
const { requireAdmin, requireSuperAdminOrPermission } = require('../middleware/adminAuth');
const { errorHandler } = require('../middleware/errorHandler');
const ctrl = require('../controllers/adminRestaurantPayRunsController');

router.use(requireAdmin);

const moneyGate = requireSuperAdminOrPermission('manage_financials');

router.get('/', moneyGate, ctrl.listPayRuns);
router.get('/:payRunId', moneyGate, ctrl.getPayRun);

router.use(errorHandler);

module.exports = router;
