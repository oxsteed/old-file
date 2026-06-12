'use strict';

const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const ctrl = require('../controllers/foodController');

// Public customer discovery.
router.get('/restaurants', ctrl.listRestaurants);
router.get('/restaurants/:restaurantId', ctrl.getRestaurant);

// Merchant onboarding and menu setup.
router.post('/restaurants', authenticate, ctrl.createRestaurant);
router.post('/restaurants/:restaurantId/categories', authenticate, ctrl.createMenuCategory);
router.post('/restaurants/:restaurantId/menu-items', authenticate, ctrl.createMenuItem);

// Customer, kiosk, counter, and kitchen order flows.
router.post('/restaurants/:restaurantId/orders', authenticate, ctrl.createOrder);
router.get('/restaurants/:restaurantId/orders', authenticate, ctrl.listRestaurantOrders);
router.patch('/restaurants/:restaurantId/orders/:orderId/status', authenticate, ctrl.updateOrderStatus);

module.exports = router;
