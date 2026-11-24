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
const cashierController = require('../controllers/creditKioskCashierController');
const { creditMutationLimiter, createStoreOption } = require('../middleware/rateLimiter');

// Audit fix: kiosk endpoints get a per-device rate limit, not just the
// shared IP-based creditMutationLimiter. A compromised kiosk should not
// be able to brute-force redemptions.
const kioskDeviceLimiter = rateLimit({
  // Review P3-1096: shared Redis store so the budget holds across replicas.
  ...createStoreOption('rl:kiosk_device:'),
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

// Group 13 Slice 4g: the cashier surface (681-685). These routes use their
// own device auth (credit_kiosk terminal or managed display kiosk) instead
// of the redeem/cash-out credit_kiosk-only auth below, so they are
// registered BEFORE the router.use that applies that auth to the rest.
// 681: in-shift location picker — only the locations this device is
// authorized for, defaulting to the paired location.
router.get(
  '/cashier/locations',
  noStoreCreditResponse,
  cashierController.authenticateCashierKiosk,
  kioskDeviceLimiter,
  cashierController.getLocations,
);

// 684: cashier transaction lookup (683: the same read with no filters is
// the authorized-transaction list). Always scoped to the device.
router.get(
  '/cashier/transactions',
  noStoreCreditResponse,
  cashierController.authenticateCashierKiosk,
  kioskDeviceLimiter,
  cashierController.listTransactions,
);
router.get(
  '/cashier/transactions/:transactionId',
  noStoreCreditResponse,
  cashierController.authenticateCashierKiosk,
  kioskDeviceLimiter,
  cashierController.getTransaction,
);

// 682: the cashier shift — open (idempotent), current shift + derived
// summary, one shift by id, and the working-location commit for the 681
// picker. Registered before the :shiftId routes so 'current' is literal.
router.post(
  '/cashier/shifts',
  noStoreCreditResponse,
  cashierController.authenticateCashierKiosk,
  kioskDeviceLimiter,
  cashierController.openShift,
);
router.get(
  '/cashier/shifts/current',
  noStoreCreditResponse,
  cashierController.authenticateCashierKiosk,
  kioskDeviceLimiter,
  cashierController.getCurrentShift,
);
router.get(
  '/cashier/shifts/:shiftId',
  noStoreCreditResponse,
  cashierController.authenticateCashierKiosk,
  kioskDeviceLimiter,
  cashierController.getShift,
);
router.patch(
  '/cashier/shifts/current/location',
  noStoreCreditResponse,
  cashierController.authenticateCashierKiosk,
  kioskDeviceLimiter,
  cashierController.updateCurrentShiftLocation,
);
// 685: close the shift, recording the derived closeout checklist.
router.post(
  '/cashier/shifts/:shiftId/close',
  noStoreCreditResponse,
  cashierController.authenticateCashierKiosk,
  kioskDeviceLimiter,
  cashierController.closeShift,
);

// Group 13 Slice 4h: the location reconciliation surface (686-690) for
// the cashier. Same device auth and per-device limiter as the 4g cashier
// surface; the device's paired location is the scope. Registered before
// the router.use below that applies the credit_kiosk-only auth to the
// redeem/cash-out routes, like the other cashier routes above.
const reconController = require('../controllers/creditLocationReconciliationController');
router.get(
  '/cashier/reconciliation/summary',
  noStoreCreditResponse,
  cashierController.authenticateCashierKiosk,
  kioskDeviceLimiter,
  reconController.deviceGetSummary,
);
router.get(
  '/cashier/reconciliation/exceptions',
  noStoreCreditResponse,
  cashierController.authenticateCashierKiosk,
  kioskDeviceLimiter,
  reconController.deviceListExceptions,
);
router.get(
  '/cashier/reconciliation/exceptions/:exceptionId/annotations',
  noStoreCreditResponse,
  cashierController.authenticateCashierKiosk,
  kioskDeviceLimiter,
  reconController.deviceListAnnotations,
);
router.post(
  '/cashier/reconciliation/exceptions/:exceptionId/annotations',
  noStoreCreditResponse,
  cashierController.authenticateCashierKiosk,
  kioskDeviceLimiter,
  reconController.deviceAddAnnotation,
);
router.get(
  '/cashier/reconciliation/period-close',
  noStoreCreditResponse,
  cashierController.authenticateCashierKiosk,
  kioskDeviceLimiter,
  reconController.deviceGetPeriodClose,
);
router.post(
  '/cashier/reconciliation/period-close',
  noStoreCreditResponse,
  cashierController.authenticateCashierKiosk,
  kioskDeviceLimiter,
  reconController.deviceRecordPeriodClose,
);
router.get(
  '/cashier/reconciliation/export.csv',
  noStoreCreditResponse,
  cashierController.authenticateCashierKiosk,
  kioskDeviceLimiter,
  reconController.deviceExportCsv,
);

router.use(noStoreCreditResponse, cardController.authenticateCreditKiosk);

// Redeem an OxSteed Credit card at this restaurant's POS/kiosk (spend).
router.post('/redeem', kioskDeviceLimiter, cardController.kioskRedeemCard);

// Convert OxSteed Credit balance back to physical cash dispensed by this
// kiosk (the private, closed-loop "cash-out" flow).
router.post('/cash-out', kioskDeviceLimiter, cardController.kioskCashOut);

module.exports = router;
