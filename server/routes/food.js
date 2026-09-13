'use strict';

const express = require('express');
const router = express.Router();
const { authenticate, optionalAuth } = require('../middleware/auth');
const ctrl = require('../controllers/foodController');
const walletCtrl = require('../controllers/foodWalletController');
const kiosk = require('../controllers/restaurantKioskController');
const oxsteedCreditPartnerCtrl = require('../controllers/oxsteedCreditPartnerController');
const { creditExportLimiter } = require('../middleware/rateLimiter');

function noStoreCreditResponse(_req, res, next) {
  res.set('Cache-Control', 'private, no-store');
  res.set('Pragma', 'no-cache');
  next();
}

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
router.post('/restaurants/:restaurantId/orders/quote', optionalAuth, ctrl.quoteOrder);

// Signed-in customer surface.
router.get('/my/restaurants', authenticate, ctrl.listMyRestaurants);
router.get('/my/orders', authenticate, ctrl.listMyOrders);
router.get('/orders/:orderId', authenticate, ctrl.getOrder);
router.get('/customer/profile', authenticate, ctrl.getCustomerProfile);
router.patch('/customer/profile', authenticate, ctrl.updateCustomerProfile);
router.get('/customer/wallets', authenticate, walletCtrl.listCustomerWallets);
router.get('/customer/wallets/:restaurantId', authenticate, walletCtrl.getCustomerWallet);
router.get('/customer/wallets/:restaurantId/integrity', authenticate, walletCtrl.verifyMyWalletIntegrity);
router.post('/customer/wallets/:restaurantId/payment-sessions', authenticate, walletCtrl.createCustomerWalletPaymentSession);
router.post('/customer/wallets/:restaurantId/payment-sessions/:sessionId/cancel', authenticate, walletCtrl.cancelCustomerWalletPaymentSession);
router.post('/customer/wallets/:restaurantId/holds', authenticate, walletCtrl.createMyWalletHold);
router.get('/customer/wallets/:restaurantId/holds', authenticate, walletCtrl.listMyWalletHolds);
router.post('/customer/wallets/:restaurantId/holds/:holdId/release', authenticate, walletCtrl.releaseMyWalletHold);
router.post('/customer/wallets/:restaurantId/transfers', authenticate, walletCtrl.createMyWalletTransfer);
router.get('/customer/wallets/:restaurantId/transfers', authenticate, walletCtrl.listMyWalletTransfers);
router.post('/customer/wallets/:restaurantId/load-requests', authenticate, walletCtrl.createMyWalletLoadRequest);
router.get('/customer/wallets/:restaurantId/load-requests', authenticate, walletCtrl.listMyWalletLoadRequests);
router.post('/customer/wallets/:restaurantId/load-requests/:requestId/cancel', authenticate, walletCtrl.cancelMyWalletLoadRequest);
router.post('/customer/favorites/:restaurantId/toggle', authenticate, ctrl.toggleCustomerFavoriteRestaurant);
router.get('/customer/favorite-items', authenticate, ctrl.listCustomerFavoriteItems);
router.put('/customer/favorite-items/sync', authenticate, ctrl.syncCustomerFavoriteItems);
router.post('/customer/favorite-items/:restaurantId/:itemId/toggle', authenticate, ctrl.toggleCustomerFavoriteItem);
router.post('/restaurants/:restaurantId/messages', authenticate, ctrl.createRestaurantCustomerMessage);
router.post('/restaurants/:restaurantId/reports', authenticate, ctrl.createRestaurantReport);

// Merchant onboarding and menu setup.
router.post('/restaurants', authenticate, ctrl.createRestaurant);
router.patch('/restaurants/:restaurantId', authenticate, ctrl.updateRestaurant);
router.get('/restaurants/:restaurantId/setup-progress', authenticate, ctrl.getRestaurantSetupProgress);
router.post('/restaurants/:restaurantId/promotions', authenticate, ctrl.createRestaurantPromotion);
router.get('/restaurants/:restaurantId/promotions/manage', authenticate, ctrl.listMerchantRestaurantPromotions);
router.patch('/restaurants/:restaurantId/promotions/:promotionId', authenticate, ctrl.updateRestaurantPromotion);
router.post('/restaurants/:restaurantId/locations', authenticate, ctrl.createRestaurantLocation);
router.patch('/restaurants/:restaurantId/locations/:locationId', authenticate, ctrl.updateRestaurantLocation);
router.get('/restaurants/:restaurantId/menu/manage', authenticate, ctrl.getManagedRestaurantMenu);
router.post('/restaurants/:restaurantId/categories', authenticate, ctrl.createMenuCategory);
router.patch('/restaurants/:restaurantId/categories/:categoryId', authenticate, ctrl.updateMenuCategory);
router.delete('/restaurants/:restaurantId/categories/:categoryId', authenticate, ctrl.deleteMenuCategory);
router.post('/restaurants/:restaurantId/menu-items', authenticate, ctrl.createMenuItem);
router.post('/restaurants/:restaurantId/menu-items/:itemId/duplicate', authenticate, ctrl.duplicateMenuItem);
router.patch('/restaurants/:restaurantId/menu-items/:itemId', authenticate, ctrl.updateMenuItem);
router.delete('/restaurants/:restaurantId/menu-items/:itemId', authenticate, ctrl.deleteMenuItem);
router.post('/restaurants/:restaurantId/menu-items/:itemId/modifier-groups', authenticate, ctrl.createModifierGroup);
router.patch('/restaurants/:restaurantId/modifier-groups/:groupId', authenticate, ctrl.updateModifierGroup);
router.delete('/restaurants/:restaurantId/modifier-groups/:groupId', authenticate, ctrl.deleteModifierGroup);
router.post('/restaurants/:restaurantId/customer-wallet-loads', authenticate, walletCtrl.loadCustomerWallet);
router.post('/restaurants/:restaurantId/customer-wallet-load-requests', authenticate, walletCtrl.loadCustomerWallet);
router.get('/restaurants/:restaurantId/customer-wallet-load-requests', authenticate, walletCtrl.listCustomerWalletLoadRequests);
router.post('/restaurants/:restaurantId/customer-wallet-load-requests/:requestId/approve', authenticate, walletCtrl.approveCustomerWalletLoadRequest);
router.post('/restaurants/:restaurantId/customer-wallet-load-requests/:requestId/cancel', authenticate, walletCtrl.cancelCustomerWalletLoadRequest);
router.patch('/restaurants/:restaurantId/customer-wallet-status', authenticate, walletCtrl.updateCustomerWalletStatus);
router.get('/restaurants/:restaurantId/customer-wallet-integrity', authenticate, walletCtrl.verifyCustomerWalletIntegrity);
router.get('/restaurants/:restaurantId/customer-wallet-reconciliation', authenticate, walletCtrl.getCustomerWalletReconciliation);
router.get('/restaurants/:restaurantId/customer-wallet-statement', authenticate, walletCtrl.getCustomerWalletStatement);
router.get('/restaurants/:restaurantId/oxsteed-credit/settlements', authenticate, noStoreCreditResponse, oxsteedCreditPartnerCtrl.listPartnerSettlements);
router.get('/restaurants/:restaurantId/oxsteed-credit/transactions', authenticate, noStoreCreditResponse, oxsteedCreditPartnerCtrl.listPartnerTransactions);
router.get('/restaurants/:restaurantId/oxsteed-credit/report.csv', authenticate, noStoreCreditResponse, creditExportLimiter, oxsteedCreditPartnerCtrl.downloadPartnerCreditReport);
router.post('/restaurants/:restaurantId/customer-wallet-holds/:holdId/capture', authenticate, walletCtrl.captureCustomerWalletHold);
router.post('/restaurants/:restaurantId/customer-wallet-holds/:holdId/release', authenticate, walletCtrl.releaseCustomerWalletHold);

// Ordering. Customers can browse as guests, but must sign in before submitting
// an order so the restaurant has an accountable customer record.
router.post('/restaurants/:restaurantId/orders', authenticate, ctrl.createOrder);

// Merchant order operations (kitchen feed, status flow, in-store payment).
router.get('/restaurants/:restaurantId/orders', authenticate, ctrl.listRestaurantOrders);
router.patch('/restaurants/:restaurantId/orders/:orderId/status', authenticate, ctrl.updateOrderStatus);
router.patch('/restaurants/:restaurantId/orders/:orderId/payment', authenticate, ctrl.updateOrderPayment);

module.exports = router;
