'use strict';

const router = require('express').Router();
const { authenticate } = require('../middleware/auth');
const controller = require('../controllers/oxsteedCreditController');

router.get('/account', authenticate, controller.getMyAccount);
router.get('/eligible-partners', authenticate, controller.getEligiblePartners);
router.get('/transactions', authenticate, controller.getMyTransactions);
router.get('/transactions/:transactionId', authenticate, controller.getMyTransaction);
router.post('/holds', authenticate, controller.createMyHold);
router.post('/holds/:holdId/release', authenticate, controller.releaseMyHold);
router.post('/transfers', authenticate, controller.transferMyCredit);
router.get('/disputes', authenticate, controller.listMyDisputes);
router.post('/disputes', authenticate, controller.openMyDispute);

module.exports = router;
