'use strict';

const router = require('express').Router();
const { authenticate } = require('../middleware/auth');
const { requireAdmin, requireSuperAdminOrPermission, requireAdminTotp, hasGlobalGrant } = require('../middleware/adminAuth');
const controller = require('../controllers/agentCreditAdjustmentController');

// 707 (D-424): bookkeeper/auditor READ of the adjustment queue (list +
// detail). The read gate is the actual grant, never the role label: the
// caller must be an admin-role user holding an active, non-expired,
// non-revoked global grant containing view_financials (or
// manage_financials); super-admins pass unconditionally. Grants are
// issued to regular admins only, so a non-admin user never reaches the
// queue, and the admin TOTP mandate is enforced here exactly as on the
// write routes (requireAdminTotp). These routes are registered BEFORE
// router.use(requireAdmin) so a view-only reader is not stopped by the
// admin-only write gate; the write routes below are untouched, and the
// maker-checker, two-person rule, and rail fail-closed apply path are
// unchanged. A reader without the grant gets 403
// credit_adjustment_read_forbidden.
async function requireAdjustmentQueueRead(req, res, next) {
  try {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized.' });
    if (!['admin', 'super_admin'].includes(req.user.role)) {
      return res.status(403).json({
        error: 'Admin access required to view the adjustment queue.',
        code: 'credit_adjustment_read_forbidden',
      });
    }
    if (req.user.role === 'super_admin') {
      req.adjustmentReadOnly = false;
      return next();
    }
    const [canView, canManage] = await Promise.all([
      hasGlobalGrant(req.user.id, 'view_financials'),
      hasGlobalGrant(req.user.id, 'manage_financials'),
    ]);
    if (!canView && !canManage) {
      return res.status(403).json({
        error: 'A finance read grant is required to view the adjustment queue.',
        code: 'credit_adjustment_read_forbidden',
      });
    }
    // A reader who can also write sees the queue as a writer; a
    // view-only reader sees readOnly: true in the payload.
    req.adjustmentReadOnly = !canManage;
    return next();
  } catch (err) {
    return next(err);
  }
}

router.get('/credit-adjustments/pending', authenticate, requireAdminTotp, requireAdjustmentQueueRead, controller.listPendingAdjustments);
router.get('/credit-adjustments/:id', authenticate, requireAdminTotp, requireAdjustmentQueueRead, controller.getAdjustment);

// Agent credit adjustments are hand-moved money: admin-only, and every
// mutation needs the explicit manage_financials grant (super-admin bypasses
// the grant but NOT the two-person rule, which is keyed on admin identity
// inside the controller).
router.use(requireAdmin);

const moneyGate = requireSuperAdminOrPermission('manage_financials');

router.get('/credit-adjustments/pending', moneyGate, controller.listPendingAdjustments);
router.post('/credit-adjustments', moneyGate, controller.proposeAdjustment);
// Group 13 Slice 4h (687, D-395): link an existing adjustment to the
// reconciliation exception it resolves. Set-once; no money moves here.
router.post('/credit-adjustments/:id/link-exception', moneyGate, controller.linkAdjustmentToException);
// ADM-186: step-up challenges for the approval path. The approve endpoint
// verifies the challenge before money moves; this route is scoped to the
// same manage_financials gate because the super-admin challenge route is
// not reachable by non-super-admin approvers.
router.post('/credit-adjustments/stepup-challenges', moneyGate, controller.issueApprovalStepupChallenge);
router.post('/credit-adjustments/:id/approve', moneyGate, controller.approveAdjustment);
router.post('/credit-adjustments/:id/reject', moneyGate, controller.rejectAdjustment);
router.post('/credit-adjustments/:id/cancel', moneyGate, controller.cancelAdjustment);

module.exports = router;
