const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { requireAdmin } = require('../middleware/adminAuth');
const adminOrdersController = require('../controllers/adminOrdersController');

// All admin order routes require authentication and admin role
router.use(requireAuth, requireAdmin);

// Get orders list with filtering and pagination
router.get('/', adminOrdersController.getOrders);

// Get order statistics
router.get('/stats', adminOrdersController.getOrderStats);

// Get single order detail
router.get('/:orderId', adminOrdersController.getOrder);

// Mark order as shipped
router.post('/:orderId/mark-shipped', adminOrdersController.markShipped);

// Process refund
router.post('/:orderId/refund', adminOrdersController.processRefund);

// Cancel order
router.post('/:orderId/cancel', adminOrdersController.cancelOrder);

module.exports = router;
