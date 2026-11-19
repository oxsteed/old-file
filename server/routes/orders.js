const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const ordersController = require('../controllers/ordersController');
const { strictLimiter } = require('../middleware/rateLimiter');

router.get('/', requireAuth, ordersController.getOrders);
router.get('/stats', requireAuth, ordersController.getOrderStats);
router.get('/:orderId', requireAuth, ordersController.getOrder);
router.post('/:orderId/cancel', strictLimiter, requireAuth, ordersController.cancelOrder);
// Group 1, item 35: return requests record the customer's request; they
// never issue a refund (refunds stay in the money-approvals flow).
router.post('/:orderId/return', strictLimiter, requireAuth, ordersController.createReturnRequest);
router.get('/:orderId/return', requireAuth, ordersController.getReturnRequests);
router.post('/:orderId/return/:returnId/cancel', strictLimiter, requireAuth, ordersController.cancelReturnRequest);

module.exports = router;
