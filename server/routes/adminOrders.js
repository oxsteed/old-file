const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { requireAdmin, requirePermission } = require('../middleware/adminAuth');
const { rejectImpersonated } = require('../middleware/rejectImpersonated');
const adminOrdersController = require('../controllers/adminOrdersController');
const { strictLimiter } = require('../middleware/rateLimiter');

// All admin order routes require authentication and admin role
router.use(requireAuth, requireAdmin, requirePermission('manage_operations'));

// Get orders list with filtering and pagination
router.get('/', adminOrdersController.getOrders);

// Get order statistics
router.get('/stats', adminOrdersController.getOrderStats);

// G1-B6: the admin return queue. Registered before /:orderId so the
// static 'returns' segment is never captured as an order id.
router.get('/returns', adminOrdersController.listReturnRequests);

// Decide a return request (approved/declined, status only, never a refund).
router.post('/returns/:returnId/decision', adminOrdersController.decideReturnRequest);

// Get single order detail
router.get('/:orderId', adminOrdersController.getOrder);

// Mark order as shipped
router.post('/:orderId/mark-shipped', adminOrdersController.markShipped);

// Process refund - issues real Stripe refunds, requires the issue_refunds grant
// ADM-040: impersonated sessions cannot issue refunds.
router.post('/:orderId/refund', strictLimiter, rejectImpersonated, requirePermission('issue_refunds'), adminOrdersController.processRefund);

// Cancel order
router.post('/:orderId/cancel', adminOrdersController.cancelOrder);

module.exports = router;
