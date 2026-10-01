const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { requireAdmin, requirePermission } = require('../middleware/adminAuth');
const adminOrdersController = require('../controllers/adminOrdersController');

// All admin order routes require authentication and admin role
router.use(requireAuth, requireAdmin, requirePermission('manage_operations'));

// Get orders list with filtering and pagination
router.get('/', adminOrdersController.getOrders);

// Get order statistics
router.get('/stats', adminOrdersController.getOrderStats);

// Get single order detail
router.get('/:orderId', adminOrdersController.getOrder);

// Mark order as shipped
router.post('/:orderId/mark-shipped', adminOrdersController.markShipped);

// Process refund - issues real Stripe refunds, requires the issue_refunds grant
router.post('/:orderId/refund', requirePermission('issue_refunds'), adminOrdersController.processRefund);

// Cancel order
router.post('/:orderId/cancel', adminOrdersController.cancelOrder);

module.exports = router;
