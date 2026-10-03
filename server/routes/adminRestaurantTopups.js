'use strict';

// Admin routes for restaurant customer top-up eligibility + clawback
// (mounted at /api/admin/restaurant-topups).
//
// Admin-only, and every mutation needs the explicit manage_financials grant
// (super-admin bypasses the grant but NOT the audit trail, which is keyed on
// admin identity inside the service). Follows the agent credit-adjustment
// pattern in routes/agentCreditAdjustments.js.

const router = require('express').Router();
const { requireAdmin, requireSuperAdminOrPermission } = require('../middleware/adminAuth');
const { errorHandler } = require('../middleware/errorHandler');
const ctrl = require('../controllers/adminRestaurantTopupController');

router.use(requireAdmin);

const moneyGate = requireSuperAdminOrPermission('manage_financials');

router.get('/applications', moneyGate, ctrl.listApplications);
router.post('/applications/:restaurantId/approve', moneyGate, ctrl.approveApplication);
router.post('/applications/:restaurantId/reject', moneyGate, ctrl.rejectApplication);
router.post('/applications/:restaurantId/suspend', moneyGate, ctrl.suspendApplication);
router.post('/topups/:topupId/clawback', moneyGate, ctrl.clawbackTopup);

router.use(errorHandler);

module.exports = router;
