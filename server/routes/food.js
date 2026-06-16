'use strict';

const express = require('express');
const router = express.Router();
const { authenticate, optionalAuth } = require('../middleware/auth');
const ctrl = require('../controllers/foodController');
const kiosk = require('../controllers/restaurantKioskController');

// Public customer discovery + the in-store "now serving" queue board.
router.get('/restaurants', ctrl.listRestaurants);
router.get('/restaurants/:restaurantId', ctrl.getRestaurant);
router.get('/restaurants/:restaurantId/queue-board', ctrl.getQueueBoard);
router.get('/restaurants/:restaurantId/kiosk-config', kiosk.getPublicKioskConfig);
router.get('/payment-config', ctrl.getPaymentConfig);
router.get('/orders/track/:trackingToken', ctrl.getTrackedOrder);
router.get('/orders/:orderId/checkout/complete', ctrl.completeCheckout);
router.get('/orders/:orderId/checkout/cancelled', ctrl.cancelCheckout);

// Signed-in customer surface.
router.get('/my/restaurants', authenticate, ctrl.listMyRestaurants);
router.get('/my/orders', authenticate, ctrl.listMyOrders);
router.get('/orders/:orderId', authenticate, ctrl.getOrder);
router.get('/customer/profile', authenticate, ctrl.getCustomerProfile);
router.patch('/customer/profile', authenticate, ctrl.updateCustomerProfile);
router.post('/customer/favorites/:restaurantId/toggle', authenticate, ctrl.toggleCustomerFavoriteRestaurant);

// Merchant onboarding and menu setup.
router.post('/restaurants', authenticate, ctrl.createRestaurant);
router.patch('/restaurants/:restaurantId', authenticate, ctrl.updateRestaurant);
router.post('/restaurants/:restaurantId/categories', authenticate, ctrl.createMenuCategory);
router.patch('/restaurants/:restaurantId/categories/:categoryId', authenticate, ctrl.updateMenuCategory);
router.delete('/restaurants/:restaurantId/categories/:categoryId', authenticate, ctrl.deleteMenuCategory);
router.post('/restaurants/:restaurantId/menu-items', authenticate, ctrl.createMenuItem);
router.patch('/restaurants/:restaurantId/menu-items/:itemId', authenticate, ctrl.updateMenuItem);
router.delete('/restaurants/:restaurantId/menu-items/:itemId', authenticate, ctrl.deleteMenuItem);
router.post('/restaurants/:restaurantId/menu-items/:itemId/modifier-groups', authenticate, ctrl.createModifierGroup);
router.delete('/restaurants/:restaurantId/modifier-groups/:groupId', authenticate, ctrl.deleteModifierGroup);

// Ordering. optionalAuth lets in-store kiosk/tablet guests order without an
// account; signed-in customers get the order attached to their history.
router.post('/restaurants/:restaurantId/orders', optionalAuth, ctrl.createOrder);

// Merchant order operations (kitchen feed, status flow, in-store payment).
router.get('/restaurants/:restaurantId/orders', authenticate, ctrl.listRestaurantOrders);
router.patch('/restaurants/:restaurantId/orders/:orderId/status', authenticate, ctrl.updateOrderStatus);
router.patch('/restaurants/:restaurantId/orders/:orderId/payment', authenticate, ctrl.updateOrderPayment);

module.exports = router;
