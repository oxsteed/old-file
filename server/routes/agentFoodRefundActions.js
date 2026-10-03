const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { requireAdmin, requirePermission } = require('../middleware/adminAuth');
const agentFoodRefundActions = require('../controllers/agentFoodRefundActions');

// Support-agent console: authenticated platform admins only. Each
// money-moving action carries its own grant; the chain below must not be
// loosened (the issue_refunds grant is verified, not assumed).
router.use(requireAuth, requireAdmin);

/**
 * POST /agent/food-orders/:id/refund
 * Agent-issued food order refund. Grant-gated with issue_refunds.
 */
router.post('/food-orders/:id/refund', requirePermission('issue_refunds'), agentFoodRefundActions.refundFoodOrder);

module.exports = router;
