'use strict';

// Device-authenticated OxSteed Credit kiosk endpoints. A kiosk is paired
// exactly like a POS/Kitchen/Display device (see restaurantAppFlowController
// pairDevice/createDevicePairingCode with appKey='credit_kiosk') and reuses
// that same device-token model here instead of a customer JWT: the kiosk
// itself is the trusted actor, and the card credential + PIN presented at
// the kiosk identify the customer for a given transaction.

const router = require('express').Router({ mergeParams: true });
const rateLimit = require('express-rate-limit');
const cardController = require('../controllers/oxsteedCreditCardController');
const { creditMutationLimiter } = require('../middleware/rateLimiter');

// Audit fix: kiosk endpoints get a per-device rate limit, not just the
// shared IP-based creditMutationLimiter. A compromised kiosk should not
// be able to brute-force redemptions.
const kioskDeviceLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `kiosk:${req.kioskDeviceId || req.ip}`,
  message: {
    error: 'Too many kiosk requests. Please try again later.',
    retryAfter: '15 minutes',
  },
});

function noStoreCreditResponse(_req, res, next) {
  res.set('Cache-Control', 'private, no-store');
  res.set('Pragma', 'no-cache');
  next();
}

router.use(noStoreCreditResponse, cardController.authenticateCreditKiosk);

// Redeem an OxSteed Credit card at this restaurant's POS/kiosk (spend).
router.post('/redeem', kioskDeviceLimiter, cardController.kioskRedeemCard);

// Convert OxSteed Credit balance back to physical cash dispensed by this
// kiosk (the private, closed-loop "cash-out" flow).
router.post('/cash-out', kioskDeviceLimiter, cardController.kioskCashOut);

module.exports = router;
