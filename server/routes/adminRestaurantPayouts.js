'use strict';

// Admin routes for restaurant wallet-earnings payouts
// (mounted at /api/admin/restaurant-payouts).
//
// Admin-only, and every mutation needs the explicit manage_financials grant
// (super-admin bypasses the grant but NOT the audit trail, which is keyed on
// admin identity inside the service). Follows the restaurant top-up admin
// pattern in routes/adminRestaurantTopups.js.

const router = require('express').Router();
const { requireAdmin, requireSuperAdminOrPermission } = require('../middleware/adminAuth');
const { rejectImpersonated } = require('../middleware/rejectImpersonated');
const { errorHandler } = require('../middleware/errorHandler');
const ctrl = require('../controllers/adminRestaurantPayoutController');

router.use(requireAdmin);

const moneyGate = requireSuperAdminOrPermission('manage_financials');

router.get('/', moneyGate, ctrl.listQueue);
// ADM-113: step-up challenges for the approve path (same gate as approve).
router.post('/stepup-challenges', moneyGate, ctrl.issueApproveStepupChallenge);
// ADM-040: payouts move money via Stripe Transfer; impersonated sessions are blocked.
router.post('/:payoutId/approve', moneyGate, rejectImpersonated, ctrl.approve);
router.post('/:payoutId/reject', moneyGate, rejectImpersonated, ctrl.reject);

router.use(errorHandler);

module.exports = router;
