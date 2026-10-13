const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const ordersController = require('../controllers/ordersController');
const { strictLimiter } = require('../middleware/rateLimiter');

router.get('/', requireAuth, ordersController.getOrders);
router.get('/stats', requireAuth, ordersController.getOrderStats);
router.get('/:orderId', requireAuth, ordersController.getOrder);
router.post('/:orderId/cancel', strictLimiter, requireAuth, ordersController.cancelOrder);

module.exports = router;
