'use strict';

const router = require('express').Router();
const { requireAdmin, requirePermission } = require('../middleware/adminAuth');
const { rejectImpersonated } = require('../middleware/rejectImpersonated');
const ctrl = require('../controllers/adminFoodOrdersController');
const { strictLimiter } = require('../middleware/rateLimiter');

// Food orders admin requires manage_orders or super_admin.
router.use(requireAdmin);

router.get('/', requirePermission('manage_orders'), ctrl.listFoodOrders);
router.get('/:id', requirePermission('manage_orders'), ctrl.getFoodOrder);
// ADM-040: impersonated sessions cannot issue refunds.
router.post('/:id/refund', strictLimiter, rejectImpersonated, requirePermission('issue_refunds'), ctrl.refundFoodOrder);

module.exports = router;
