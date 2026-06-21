'use strict';

const express = require('express');
const router = express.Router();
const { authenticate, optionalAuth } = require('../middleware/auth');
const ctrl = require('../controllers/foodController');
const kiosk = require('../controllers/restaurantKioskController');

// Public customer discovery + the in-store "now serving" queue board.
router.get('/markets', ctrl.listMarkets);
router.get('/restaurants', ctrl.listRestaurants);
router.get('/restaurants/:restaurantId', ctrl.getRestaurant);
router.get('/restaurants/:restaurantId/queue-board', ctrl.getQueueBoard);
router.get('/restaurants/:restaurantId/promotions', ctrl.listRestaurantPromotions);
router.get('/restaurants/:restaurantId/locations', optionalAuth, ctrl.listRestaurantLocations);
router.get('/restaurants/:restaurantId/kiosk-config', kiosk.getPublicKioskConfig);
router.get('/payment-config', ctrl.getPaymentConfig);
router.get('/orders/track/:trackingToken', ctrl.getTrackedOrder);
router.post('/orders/:orderId/review', optionalAuth, ctrl.createOrderReview);
router.get('/orders/:orderId/checkout/complete', ctrl.completeCheckout);
router.get('/orders/:orderId/checkout/cancelled', ctrl.cancelCheckout);

// Signed-in customer surface.
router.get('/my/restaurants', authenticate, ctrl.listMyRestaurants);
router.get('/my/orders', authenticate, ctrl.listMyOrders);
router.get('/orders/:orderId', authenticate, ctrl.getOrder);
router.get('/customer/profile', authenticate, ctrl.getCustomerProfile);
router.patch('/customer/profile', authenticate, ctrl.updateCustomerProfile);
router.post('/customer/favorites/:restaurantId/toggle', authenticate, ctrl.toggleCustomerFavoriteRestaurant);
router.get('/customer/favorite-items', authenticate, ctrl.listCustomerFavoriteItems);
router.put('/customer/favorite-items/sync', authenticate, ctrl.syncCustomerFavoriteItems);
router.post('/customer/favorite-items/:restaurantId/:itemId/toggle', authenticate, ctrl.toggleCustomerFavoriteItem);

// Merchant onboarding and menu setup.
router.post('/restaurants', authenticate, ctrl.createRestaurant);
router.patch('/restaurants/:restaurantId', authenticate, ctrl.updateRestaurant);
router.get('/restaurants/:restaurantId/setup-progress', authenticate, ctrl.getRestaurantSetupProgress);
router.post('/restaurants/:restaurantId/promotions', authenticate, ctrl.createRestaurantPromotion);
router.get('/restaurants/:restaurantId/promotions/manage', authenticate, ctrl.listMerchantRestaurantPromotions);
router.patch('/restaurants/:restaurantId/promotions/:promotionId', authenticate, ctrl.updateRestaurantPromotion);
router.post('/restaurants/:restaurantId/locations', authenticate, ctrl.createRestaurantLocation);
router.patch('/restaurants/:restaurantId/locations/:locationId', authenticate, ctrl.updateRestaurantLocation);
router.post('/restaurants/:restaurantId/categories', authenticate, ctrl.createMenuCategory);
router.patch('/restaurants/:restaurantId/categories/:categoryId', authenticate, ctrl.updateMenuCategory);
router.delete('/restaurants/:restaurantId/categories/:categoryId', authenticate, ctrl.deleteMenuCategory);
router.post('/restaurants/:restaurantId/menu-items', authenticate, ctrl.createMenuItem);
router.patch('/restaurants/:restaurantId/menu-items/:itemId', authenticate, ctrl.updateMenuItem);
router.delete('/restaurants/:restaurantId/menu-items/:itemId', authenticate, ctrl.deleteMenuItem);
router.post('/restaurants/:restaurantId/menu-items/:itemId/modifier-groups', authenticate, ctrl.createModifierGroup);
router.delete('/restaurants/:restaurantId/modifier-groups/:groupId', authenticate, ctrl.deleteModifierGroup);

// Ordering. Customers can browse as guests, but must sign in before submitting
// an order so the restaurant has an accountable customer record.
router.post('/restaurants/:restaurantId/orders', authenticate, ctrl.createOrder);

// Merchant order operations (kitchen feed, status flow, in-store payment).
router.get('/restaurants/:restaurantId/orders', authenticate, ctrl.listRestaurantOrders);
router.patch('/restaurants/:restaurantId/orders/:orderId/status', authenticate, ctrl.updateOrderStatus);
router.patch('/restaurants/:restaurantId/orders/:orderId/payment', authenticate, ctrl.updateOrderPayment);

module.exports = router;
