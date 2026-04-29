const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const ordersController = require('../controllers/ordersController');

router.get('/', requireAuth, ordersController.getOrders);
router.get('/stats', requireAuth, ordersController.getOrderStats);
router.get('/:orderId', requireAuth, ordersController.getOrder);
router.post('/:orderId/cancel', requireAuth, ordersController.cancelOrder);

module.exports = router;
