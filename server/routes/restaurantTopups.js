'use strict';

// OxSteed Restaurants — customer top-up routes (mounted at /api/restaurants).
//
// Merchant application for top-up eligibility reuses the payouts manager
// gate from the restaurantPayouts surface (owner, or an admin holding the
// view_financials grant): only the restaurant owner can ask OxSteed to
// enable customer top-ups. The application itself is additionally gated in
// the service on the restaurant having payouts connected.
//
// Customer intent creation is open to any signed-in user but is
// fail-closed in the service: the restaurant must be active AND OxSteed's
// eligibility decision must currently be 'approved'. Intent creation is
// per-user rate limited.

const router = require('express').Router();
const { authenticate } = require('../middleware/auth');
const { restaurantTopupIntentLimiter } = require('../middleware/rateLimiter');
const { requirePayoutManager } = require('../controllers/restaurantPayoutController');
const { errorHandler } = require('../middleware/errorHandler');
const ctrl = require('../controllers/restaurantTopupController');

router.post(
  '/:restaurantId/topup-eligibility/apply',
  authenticate,
  requirePayoutManager,
  ctrl.applyForEligibility
);
router.post(
  '/:restaurantId/topups',
  authenticate,
  restaurantTopupIntentLimiter,
  ctrl.createTopup
);
router.post(
  '/:restaurantId/topups/stepup-challenges',
  authenticate,
  restaurantTopupIntentLimiter,
  ctrl.issueTopupStepupChallenge
);
router.get(
  '/:restaurantId/topups/:topupId',
  authenticate,
  ctrl.getTopup
);

// Route-local JSON error handler for consistent API responses when this
// router is mounted without the global server error handler (tests,
// serverless, etc.). Same pattern as routes/restaurantPayouts.js.
router.use(errorHandler);

module.exports = router;
