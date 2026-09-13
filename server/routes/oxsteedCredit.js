'use strict';

const router = require('express').Router();
const { authenticate, requireRole } = require('../middleware/auth');
const { creditMutationLimiter, creditExportLimiter } = require('../middleware/rateLimiter');
const controller = require('../controllers/oxsteedCreditController');

router.use(authenticate, requireRole('customer'));

router.get('/account', controller.getMyAccount);
router.get('/accounts', controller.getMyAccounts);
router.get('/holds', controller.listMyHolds);
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
