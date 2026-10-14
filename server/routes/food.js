'use strict';

const express = require('express');
const router = express.Router();
const { authenticate, optionalAuth } = require('../middleware/auth');
const ctrl = require('../controllers/foodController');
const walletCtrl = require('../controllers/foodWalletController');
const disputeCtrl = require('../controllers/foodCreditDisputeController');
const reserveCtrl = require('../controllers/restaurantCreditReserveController');
const statementController = require('../controllers/creditStatementController');
const kiosk = require('../controllers/restaurantKioskController');
const oxsteedCreditPartnerCtrl = require('../controllers/oxsteedCreditPartnerController');
const { requireAdmin } = require('../middleware/adminAuth');
const { creditExportLimiter, creditPurchaseLimiter, paymentsLimiter, restaurantCreditMutationLimiter, profileChatLimiter, foodCheckoutCompleteLimiter } = require('../middleware/rateLimiter');
const checkRestrictions = require('../middleware/checkRestrictions');

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
router.put('/orders/:orderId/review', optionalAuth, ctrl.updateOrderReview);
router.delete('/orders/:orderId/review', optionalAuth, ctrl.deleteOrderReview);
router.post('/orders/:orderId/review/respond', authenticate, ctrl.respondToOrderReview);
// Stripe hosted-checkout return URL. Kept on optionalAuth so guests can
// complete a true guest cart (food_orders.customer_id IS NULL) after paying
// at Stripe; user-bound carts require the signed-in owner (see controller).
//
// RESIDUAL RISK: the Stripe checkout session_id is an unguessable capability
// string. Anyone who learns it can hit this endpoint and flip the matching
// order to paid (only when Stripe itself reports the session paid) or trigger
// the return_url redirect. Mitigations: foodCheckoutCompleteLimiter (10 per
// 15min per IP+session), auth required for user-bound carts, and the
// session's food_order_id/client_reference_id must match the order.
router.get('/orders/:orderId/checkout/complete', optionalAuth, foodCheckoutCompleteLimiter, ctrl.completeCheckout);
router.get('/orders/:orderId/checkout/cancelled', ctrl.cancelCheckout);
// H12: resume an interrupted pay_now checkout without placing a duplicate order.
router.post('/orders/:orderId/checkout', authenticate, checkRestrictions('checkout'), ctrl.resumeFoodCheckoutSession);
router.post('/restaurants/:restaurantId/orders/quote', optionalAuth, ctrl.quoteOrder);

// Signed-in customer surface.
router.get('/my/restaurants', authenticate, ctrl.listMyRestaurants);
router.get('/my/orders', authenticate, ctrl.listMyOrders);
router.get('/orders/:orderId', authenticate, ctrl.getOrder);
router.get('/customer/profile', authenticate, ctrl.getCustomerProfile);
router.patch('/customer/profile', authenticate, ctrl.updateCustomerProfile);
// P3-9-F01: customer-facing loyalty balance (view points / redeem at checkout).
router.get('/customer/loyalty/:restaurantId', authenticate, ctrl.getMyLoyaltyBalance);
router.use('/customer/wallets', authenticate, checkRestrictions('checkout'), noStoreCreditResponse);
router.get('/customer/wallets', walletCtrl.listCustomerWallets);
router.get('/customer/wallets/:restaurantId', walletCtrl.getCustomerWallet);
router.get('/customer/wallets/:restaurantId/integrity', walletCtrl.verifyMyWalletIntegrity);
router.get('/customer/wallets/:restaurantId/statements', creditExportLimiter, statementController.handler('restaurant'));
router.get('/customer/wallets/:restaurantId/statements.pdf', creditExportLimiter, statementController.handler('restaurant', 'pdf'));
router.get('/customer/wallets/:restaurantId/statements.csv', creditExportLimiter, statementController.handler('restaurant', 'csv'));
router.post('/customer/wallets/:restaurantId/payment-sessions', restaurantCreditMutationLimiter, walletCtrl.createCustomerWalletPaymentSession);
router.post('/customer/wallets/:restaurantId/payment-sessions/:sessionId/cancel', restaurantCreditMutationLimiter, walletCtrl.cancelCustomerWalletPaymentSession);
router.post('/customer/wallets/:restaurantId/holds', restaurantCreditMutationLimiter, walletCtrl.createMyWalletHold);
router.get('/customer/wallets/:restaurantId/holds', walletCtrl.listMyWalletHolds);
router.post('/customer/wallets/:restaurantId/holds/:holdId/release', restaurantCreditMutationLimiter, walletCtrl.releaseMyWalletHold);
router.post('/customer/wallets/:restaurantId/transfers', restaurantCreditMutationLimiter, walletCtrl.createMyWalletTransfer);
router.get('/customer/wallets/:restaurantId/transfers', walletCtrl.listMyWalletTransfers);
router.post('/customer/wallets/:restaurantId/load-requests', restaurantCreditMutationLimiter, walletCtrl.createMyWalletLoadRequest);
router.get('/customer/wallets/:restaurantId/load-requests', walletCtrl.listMyWalletLoadRequests);
// Phase 5: trial-tier credit-cap pre-check for the RequestCreditModal.
// Enforcement is authoritative on the request path; this endpoint only
// informs the UI whether the "at capacity" notice should render.
router.get('/customer/wallets/:restaurantId/credit-capacity', walletCtrl.getCreditCapacity);
router.post('/customer/wallets/:restaurantId/load-requests/:requestId/cancel', restaurantCreditMutationLimiter, walletCtrl.cancelMyWalletLoadRequest);
router.post('/customer/wallets/:restaurantId/load-requests/:requestId/disputes', restaurantCreditMutationLimiter, disputeCtrl.createDispute);
router.get('/customer/wallets/:restaurantId/disputes', disputeCtrl.listMyDisputes);
// Phase 3 restaurant-credit fraud controls: admin-only review surface for
// food_credit_fraud_signals. requireAdmin verifies the admin token itself,
// the same gating used by server/routes/admin.js.
router.get('/admin/fraud-signals', requireAdmin, walletCtrl.listFraudSignals);
router.post('/admin/fraud-signals/:id/review', requireAdmin, walletCtrl.reviewFraudSignal);
// Phase 6 (restaurant credit protection): platform credit-approval per
// restaurant. requireAdmin verifies the admin token itself, the same gating
// used by server/routes/admin.js. Revoking starts the 30-day grace clock;
// the grace-period worker migrates remaining balances to OxSteed Credit.
router.get('/admin/restaurants/:restaurantId/credit-approval', requireAdmin, walletCtrl.getRestaurantCreditApproval);
router.post('/admin/restaurants/:restaurantId/credit-approval', requireAdmin, walletCtrl.setRestaurantCreditApproval);
router.get('/customer/wallets/:restaurantId/refunds', walletCtrl.listMyWalletRefunds);
router.get('/customer/favorites', authenticate, ctrl.listCustomerFavoriteRestaurants);
router.post('/customer/favorites/:restaurantId/toggle', authenticate, ctrl.toggleCustomerFavoriteRestaurant);
router.get('/customer/favorite-items', authenticate, ctrl.listCustomerFavoriteItems);
router.put('/customer/favorite-items/sync', authenticate, ctrl.syncCustomerFavoriteItems);
router.post('/customer/favorite-items/:restaurantId/:itemId/toggle', authenticate, ctrl.toggleCustomerFavoriteItem);
router.post('/restaurants/:restaurantId/messages', authenticate, profileChatLimiter, ctrl.createRestaurantCustomerMessage);
router.post('/restaurants/:restaurantId/reports', authenticate, ctrl.createRestaurantReport);

// Merchant dispute surface (Phase 1 of the restaurant credit protection
// system). Path mirrors the customer /customer/wallets/:restaurantId shape
// while keeping operator authorization on requireRestaurantAccess +
// assertWalletOperator in the controller.
router.use('/merchant/wallets', authenticate, noStoreCreditResponse);
router.get('/merchant/wallets/:restaurantId/disputes', disputeCtrl.listMerchantDisputes);
router.post('/merchant/wallets/:restaurantId/disputes/:disputeId/respond', restaurantCreditMutationLimiter, disputeCtrl.respondToDispute);
// Phase 6: a restaurant's own platform credit-approval status (badge/banner
// data for the merchant credit dashboard). Scoped to restaurants the
// signed-in operator can access; the controller enforces that.
router.get('/merchant/credit-approval', authenticate, noStoreCreditResponse, walletCtrl.getMyRestaurantCreditApproval);

// Admin dispute resolution. Never moves money: 'resolved_release' only
// re-queues the load request to pending for restaurant re-review.
router.post('/admin/wallets/disputes/:disputeId/resolve', requireAdmin, disputeCtrl.resolveDispute);

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
router.use('/restaurants/:restaurantId/customer-wallet-loads', authenticate, noStoreCreditResponse);
router.use('/restaurants/:restaurantId/customer-wallet-load-requests', authenticate, noStoreCreditResponse);
router.use('/restaurants/:restaurantId/customer-wallet-status', authenticate, noStoreCreditResponse);
router.use('/restaurants/:restaurantId/customer-wallet-integrity', authenticate, noStoreCreditResponse);
router.use('/restaurants/:restaurantId/customer-wallet-reconciliation', authenticate, noStoreCreditResponse);
router.use('/restaurants/:restaurantId/customer-wallet-statement', authenticate, noStoreCreditResponse);
router.use('/merchant/wallets/:restaurantId/refunds', authenticate, noStoreCreditResponse);
router.post('/restaurants/:restaurantId/customer-wallet-loads', restaurantCreditMutationLimiter, walletCtrl.loadCustomerWallet);
router.post('/restaurants/:restaurantId/customer-wallet-load-requests', restaurantCreditMutationLimiter, walletCtrl.loadCustomerWallet);
router.get('/restaurants/:restaurantId/customer-wallet-load-requests', walletCtrl.listCustomerWalletLoadRequests);
router.post('/restaurants/:restaurantId/customer-wallet-load-requests/:requestId/approve', restaurantCreditMutationLimiter, walletCtrl.approveCustomerWalletLoadRequest);
router.post('/restaurants/:restaurantId/customer-wallet-load-requests/:requestId/cancel', restaurantCreditMutationLimiter, walletCtrl.cancelCustomerWalletLoadRequest);
router.patch('/restaurants/:restaurantId/customer-wallet-status', restaurantCreditMutationLimiter, walletCtrl.updateCustomerWalletStatus);
router.get('/restaurants/:restaurantId/customer-wallet-integrity', walletCtrl.verifyCustomerWalletIntegrity);
router.get('/restaurants/:restaurantId/customer-wallet-reconciliation', walletCtrl.getCustomerWalletReconciliation);
router.get('/restaurants/:restaurantId/customer-wallet-statement', walletCtrl.getCustomerWalletStatement);
// Phase 2: restaurant-initiated credit refunds. Operator authorization is
// enforced inside the controller (requireRestaurantAccess + assertWalletOperator).
router.post('/merchant/wallets/:restaurantId/refunds', restaurantCreditMutationLimiter, walletCtrl.createCustomerWalletRefund);
router.get('/merchant/wallets/:restaurantId/refunds', walletCtrl.listRestaurantWalletRefunds);
// Phase 5: trial-tier credit cap + FIFO derisking. Only meaningful for
// restaurants WITHOUT a Phase 4 reserve row (the trial-cap service itself
// reports trial_cap_applies: false for enrolled restaurants). Operator
// authorization is enforced inside the controller (requireRestaurantAccess
// + assertWalletOperator), mirroring the merchant wallet surface.
router.get('/merchant/wallets/:restaurantId/exposure', walletCtrl.getCreditExposure);
router.post('/merchant/wallets/:restaurantId/derisk', restaurantCreditMutationLimiter, walletCtrl.deriskCredit);
// Phase 4: restaurant credit pre-purchase reserve ("gift card inventory"
// model). Opt-in per restaurant: only restaurants WITH a reserve row are
// capped at issuance; restaurants without a row keep the trial-tier cap
// (Phase 5). Operator authorization is enforced inside the controller
// (requireRestaurantAccess + assertWalletOperator), mirroring the merchant
// wallet surface.
router.use('/merchant/credit-reserve', authenticate, noStoreCreditResponse);
router.post('/merchant/credit-reserve/purchase', restaurantCreditMutationLimiter, reserveCtrl.purchaseCreditReserve);
router.post('/merchant/credit-reserve/purchase/:purchaseId/confirm', restaurantCreditMutationLimiter, reserveCtrl.confirmCreditReservePurchase);
router.get('/merchant/credit-reserve/balance', reserveCtrl.getCreditReserveBalance);
router.get('/merchant/credit-reserve/ledger', reserveCtrl.listCreditReserveLedger);
router.get('/restaurants/:restaurantId/oxsteed-credit/settlements', authenticate, noStoreCreditResponse, oxsteedCreditPartnerCtrl.listPartnerSettlements);
router.get('/restaurants/:restaurantId/oxsteed-credit/transactions', authenticate, noStoreCreditResponse, oxsteedCreditPartnerCtrl.listPartnerTransactions);
router.get('/restaurants/:restaurantId/oxsteed-credit/ledger', authenticate, noStoreCreditResponse, oxsteedCreditPartnerCtrl.getPartnerCreditLedger);
router.get('/restaurants/:restaurantId/oxsteed-credit/report.csv', authenticate, noStoreCreditResponse, creditExportLimiter, oxsteedCreditPartnerCtrl.downloadPartnerCreditReport);
router.use('/restaurants/:restaurantId/customer-wallet-holds', authenticate, noStoreCreditResponse);
router.post('/restaurants/:restaurantId/customer-wallet-holds/:holdId/capture', restaurantCreditMutationLimiter, walletCtrl.captureCustomerWalletHold);
router.post('/restaurants/:restaurantId/customer-wallet-holds/:holdId/release', restaurantCreditMutationLimiter, walletCtrl.releaseCustomerWalletHold);

// Ordering. Customers can browse as guests, but must sign in before submitting
// an order so the restaurant has an accountable customer record.
// In-checkout card payments: creates a destination-charge Stripe
// PaymentIntent for the restaurant's Connect account; the client confirms it
// with Elements, then places the order with paymentMode 'card' and the
// payment intent id.
// Review P3-1095: card intents carry the per-user payments budget
// (creditPurchaseLimiter skips every non-credit body).
// Review P2-7-F07: in-checkout card payments are a checkout surface; honor
// admin checkout restrictions like the other payment-intent routes.
router.post('/card-payment/intent', authenticate, checkRestrictions('checkout'), paymentsLimiter, ctrl.createCardPaymentIntent);
router.get('/payment-methods', authenticate, ctrl.listSavedPaymentMethods);
router.post('/restaurants/:restaurantId/orders', optionalAuth, creditPurchaseLimiter, ctrl.createOrder);

// Merchant order operations (kitchen feed, status flow, in-store payment).
router.get('/restaurants/:restaurantId/orders', authenticate, ctrl.listRestaurantOrders);
router.patch('/restaurants/:restaurantId/orders/:orderId/status', authenticate, ctrl.updateOrderStatus);
router.post('/restaurants/:restaurantId/orders/:orderId/split', authenticate, ctrl.splitOrder);

module.exports = router;
