'use strict';

const router = require('express').Router();
const { authenticate, requireRole } = require('../middleware/auth');
const { creditMutationLimiter, creditExportLimiter } = require('../middleware/rateLimiter');
const controller = require('../controllers/oxsteedCreditController');
const cardController = require('../controllers/oxsteedCreditCardController');
const topupController = require('../controllers/oxsteedCreditTopupController');

function noStoreCreditResponse(_req, res, next) {
  res.set('Cache-Control', 'private, no-store');
  res.set('Pragma', 'no-cache');
  next();
}

router.use(authenticate, requireRole('customer'), noStoreCreditResponse);

router.get('/account', controller.getMyAccount);
router.post('/conversions', creditMutationLimiter, controller.convertMyCredit);
router.get('/conversion-quotes/:quoteId', controller.getMyCurrencyQuote);
router.get('/limits', controller.getMyCreditLimits);
router.get('/accounts', controller.getMyAccounts);
router.get('/status', controller.getMyCreditStatus);
router.get('/holds', controller.listMyHolds);
router.get('/eligibility', controller.getCustomerEligibility);
router.get('/eligible-partners', controller.getEligiblePartners);
router.get('/statement.csv', creditExportLimiter, controller.downloadMyStatement);
router.get('/statement', controller.getMyStatement);
router.get('/transactions', controller.getMyTransactions);
router.get('/transactions/:transactionId', controller.getMyTransaction);
router.post('/holds', creditMutationLimiter, controller.createMyHold);
router.post('/holds/:holdId/release', creditMutationLimiter, controller.releaseMyHold);
router.post('/transfers', creditMutationLimiter, controller.transferMyCredit);
router.get('/disputes', controller.listMyDisputes);
router.post('/disputes', creditMutationLimiter, controller.openMyDispute);

// Stripe top-ups (fiat money IN): create a top-up intent and read its status.
router.post('/topups', creditMutationLimiter, topupController.createTopup);
router.get('/topups/:id', topupController.getTopup);

// OxSteed Credit card ecosystem: issuance, activation, lifecycle, and PIN
// management. Redemption/cash-out happen from device-authenticated kiosk
// routes (see routes/oxsteedCreditKiosk.js), not here.
router.get('/cards', cardController.listMyCards);
router.post('/cards/virtual', creditMutationLimiter, cardController.issueMyVirtualCard);
router.post('/cards/physical', creditMutationLimiter, cardController.requestMyPhysicalCard);
router.post('/cards/:cardId/activate', creditMutationLimiter, cardController.activateMyCard);
router.post('/cards/:cardId/freeze', creditMutationLimiter, cardController.freezeMyCard);
router.post('/cards/:cardId/unfreeze', creditMutationLimiter, cardController.unfreezeMyCard);
router.post('/cards/:cardId/report-lost', creditMutationLimiter, cardController.reportMyCardLost);
router.post('/cards/:cardId/pin', creditMutationLimiter, cardController.setMyCardPin);

module.exports = router;
