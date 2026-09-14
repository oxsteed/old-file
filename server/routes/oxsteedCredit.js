'use strict';

const router = require('express').Router();
const { authenticate, requireRole } = require('../middleware/auth');
const { creditMutationLimiter, creditExportLimiter } = require('../middleware/rateLimiter');
const controller = require('../controllers/oxsteedCreditController');

function noStoreCreditResponse(_req, res, next) {
  res.set('Cache-Control', 'private, no-store');
  res.set('Pragma', 'no-cache');
  next();
}

router.use(authenticate, requireRole('customer'), noStoreCreditResponse);

router.get('/account', controller.getMyAccount);
router.post('/conversions', creditMutationLimiter, controller.convertMyCredit);
router.get('/conversion-quotes/:quoteId', controller.getAdminCurrencyQuote);
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

module.exports = router;
