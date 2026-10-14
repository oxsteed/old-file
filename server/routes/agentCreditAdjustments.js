'use strict';

const router = require('express').Router();
const { requireAdmin, requireSuperAdminOrPermission } = require('../middleware/adminAuth');
const controller = require('../controllers/agentCreditAdjustmentController');

// Agent credit adjustments are hand-moved money: admin-only, and every
// mutation needs the explicit manage_financials grant (super-admin bypasses
// the grant but NOT the two-person rule, which is keyed on admin identity
// inside the controller).
router.use(requireAdmin);

const moneyGate = requireSuperAdminOrPermission('manage_financials');

router.get('/credit-adjustments/pending', moneyGate, controller.listPendingAdjustments);
router.post('/credit-adjustments', moneyGate, controller.proposeAdjustment);
// ADM-186: step-up challenges for the approval path. The approve endpoint
// verifies the challenge before money moves; this route is scoped to the
// same manage_financials gate because the super-admin challenge route is
// not reachable by non-super-admin approvers.
router.post('/credit-adjustments/stepup-challenges', moneyGate, controller.issueApprovalStepupChallenge);
router.post('/credit-adjustments/:id/approve', moneyGate, controller.approveAdjustment);
router.post('/credit-adjustments/:id/reject', moneyGate, controller.rejectAdjustment);
router.post('/credit-adjustments/:id/cancel', moneyGate, controller.cancelAdjustment);

module.exports = router;
