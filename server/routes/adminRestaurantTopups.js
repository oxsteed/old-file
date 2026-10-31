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
const pool = require('../db');
const { requestMoneyMovementApproval } = require('../services/dualApprovalService');
const { sendMoneyMovementGateResult } = require('../utils/dualApprovalHttp');

router.use(requireAdmin);

const { strictLimiter } = require('../middleware/rateLimiter');
const { rejectImpersonated } = require('../middleware/rejectImpersonated');
const { requireAdminActionStepup, issueAdminActionStepup, resolveClawbackAmountCents } = require('../middleware/adminActionStepup');
const moneyGate = requireSuperAdminOrPermission('manage_financials');

router.get('/applications', moneyGate, ctrl.listApplications);
router.post('/stepup-challenges/approve', moneyGate, strictLimiter, rejectImpersonated, issueAdminActionStepup('restaurant_topup_approve'));
router.post('/stepup-challenges/clawback', moneyGate, strictLimiter, rejectImpersonated, issueAdminActionStepup('restaurant_topup_clawback', resolveClawbackAmountCents));
router.post('/applications/:restaurantId/approve', moneyGate, strictLimiter, rejectImpersonated, requireAdminActionStepup('restaurant_topup_approve'), ctrl.approveApplication);
router.post('/applications/:restaurantId/reject', moneyGate, ctrl.rejectApplication);
router.post('/applications/:restaurantId/suspend', moneyGate, ctrl.suspendApplication);
// Pentest fix: clawback moves money (it debits a wallet, possibly
// negative), so it gets the same three protections as the approve route
// plus a dual-approval gate: step-up challenge, impersonation rejection,
// and above-threshold queueing for a second admin via the
// restaurant_topup_clawback executor. Below the threshold the controller
// runs as before. A missing top-up row is left to the controller so it
// still returns its 404.
router.post('/topups/:topupId/clawback', moneyGate, strictLimiter, rejectImpersonated, requireAdminActionStepup('restaurant_topup_clawback', resolveClawbackAmountCents), async (req, res, next) => {
  try {
    const { rows: [topup] } = await pool.query(
      'SELECT amount_cents, currency FROM restaurant_topups WHERE id = $1',
      [req.params.topupId]
    );
    const amountCents = topup ? Number(topup.amount_cents) : NaN;
    // A missing reason is left to the controller so it still returns its
    // 400 instead of queueing an approval that could never execute.
    const reason = String(req.body?.reason || '').trim();
    if (topup && reason && Number.isSafeInteger(amountCents) && amountCents > 0) {
      const gate = await requestMoneyMovementApproval({
        movementType: 'restaurant_topup_clawback',
        referenceKey: `restaurant-topup-clawback:${req.params.topupId}`,
        amountCents,
        currencyCode: String(topup.currency || 'USD'),
        requestedBy: req.user.id,
        idempotencyKey: req.get?.('Idempotency-Key') || `restaurant-topup-clawback:${req.params.topupId}`,
        payload: { topupId: req.params.topupId, makerAdminId: req.user.id, reason },
      });
      if (gate.queued) return sendMoneyMovementGateResult(res, gate);
    }
    return ctrl.clawbackTopup(req, res, next);
  } catch (err) {
    return next(err);
  }
});

router.use(errorHandler);

module.exports = router;
