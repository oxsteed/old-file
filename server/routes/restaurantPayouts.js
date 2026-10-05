'use strict';

// OxSteed Restaurants — merchant payout routes (mounted at /api/restaurants).
//
// Mirrors the helper Stripe Connect surface in routes/payments.js, but scoped
// per restaurant: the restaurant owner (or an admin with the 'view_financials'
// grant) creates a Stripe Express account for the restaurant, resumes
// onboarding, reads payout status, or disconnects. All routes sit behind the
// Payments feature flag and the connect-account rate limiter, like the
// helper flow.

const router = require('express').Router();
const { authenticate } = require('../middleware/auth');
const { connectAccountLimiter } = require('../middleware/rateLimiter');
const { requireFeatureEnabled } = require('../middleware/featureFlags');
const { errorHandler } = require('../middleware/errorHandler');
const {
  requirePayoutManager,
  createConnectRestaurantAccount,
  getRestaurantConnectStatus,
  disconnectConnectRestaurantAccount,
} = require('../controllers/restaurantPayoutController');
const walletPayoutCtrl = require('../controllers/restaurantWalletPayoutController');

const requirePaymentsEnabled = requireFeatureEnabled('Payments', 'FEATURE_PAYMENTS_ENABLED');

router.post(
  '/:restaurantId/payouts/connect',
  authenticate,
  requirePaymentsEnabled,
  connectAccountLimiter,
  requirePayoutManager,
  createConnectRestaurantAccount
);
router.get(
  '/:restaurantId/payouts/status',
  authenticate,
  requirePaymentsEnabled,
  requirePayoutManager,
  getRestaurantConnectStatus
);
router.post(
  '/:restaurantId/payouts/disconnect',
  authenticate,
  requirePaymentsEnabled,
  connectAccountLimiter,
  requirePayoutManager,
  disconnectConnectRestaurantAccount
);

// Wallet-earnings payouts: the restaurant owner requests payouts of the
// wallet/credit balances OxSteed holds in restaurant_sub_bank. An admin
// approves; the service executes a Stripe Transfer to the Connect account.
router.get(
  '/:restaurantId/wallet-payouts/balance',
  authenticate,
  requirePayoutManager,
  walletPayoutCtrl.getPayoutBalance
);
router.post(
  '/:restaurantId/wallet-payouts',
  authenticate,
  requirePayoutManager,
  walletPayoutCtrl.requestPayout
);
router.get(
  '/:restaurantId/wallet-payouts',
  authenticate,
  requirePayoutManager,
  walletPayoutCtrl.listPayouts
);

// Route-local JSON error handler for consistent API responses when this
// router is mounted without the global server error handler (tests,
// serverless, etc.). Same pattern as routes/payments.js.
router.use(errorHandler);

module.exports = router;
