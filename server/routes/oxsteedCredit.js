'use strict';

const router = require('express').Router();
const { authenticate } = require('../middleware/auth');
const { creditMutationLimiter, creditExportLimiter } = require('../middleware/rateLimiter');
const controller = require('../controllers/oxsteedCreditController');

router.get('/account', authenticate, controller.getMyAccount);
router.get('/eligible-partners', authenticate, controller.getEligiblePartners);
router.get('/statement.csv', authenticate, creditExportLimiter, controller.downloadMyStatement);
router.get('/statement', authenticate, controller.getMyStatement);
router.get('/transactions', authenticate, controller.getMyTransactions);
router.get('/transactions/:transactionId', authenticate, controller.getMyTransaction);
router.post('/holds', authenticate, creditMutationLimiter, controller.createMyHold);
router.post('/holds/:holdId/release', authenticate, creditMutationLimiter, controller.releaseMyHold);
router.post('/transfers', authenticate, creditMutationLimiter, controller.transferMyCredit);
router.get('/disputes', authenticate, controller.listMyDisputes);
router.post('/disputes', authenticate, creditMutationLimiter, controller.openMyDispute);

module.exports = router;
