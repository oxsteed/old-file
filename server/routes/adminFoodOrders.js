'use strict';

const router = require('express').Router();
const { requireAdmin, requirePermission } = require('../middleware/adminAuth');
const ctrl = require('../controllers/adminFoodOrdersController');

// Food orders admin requires manage_orders or super_admin.
router.use(requireAdmin);

router.get('/', requirePermission('manage_orders'), ctrl.listFoodOrders);
router.get('/:id', requirePermission('manage_orders'), ctrl.getFoodOrder);
router.post('/:id/refund', requirePermission('issue_refunds'), ctrl.refundFoodOrder);

module.exports = router;
