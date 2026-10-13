'use strict';

const router = require('express').Router();
const { authenticate } = require('../middleware/auth');
const { requireAdmin, requireSuperAdmin, requirePermission } = require('../middleware/adminAuth');
const { paymentsLimiter, generalLimiter } = require('../middleware/rateLimiter');
const { rejectImpersonated } = require('../middleware/rejectImpersonated');
const checkRestrictions = require('../middleware/checkRestrictions');
const { errorHandler } = require('../middleware/errorHandler');
const ctrl = require('../controllers/paymentLayersController');

router.get('/config', generalLimiter, ctrl.getConfig);

router.get('/admin/country-policies', requireAdmin, requirePermission('view_financials'), ctrl.adminListPolicies);
router.put('/admin/country-policies/:code', requireSuperAdmin, ctrl.adminUpdatePolicy);
router.get('/admin/payout-partners', requireAdmin, requirePermission('view_financials'), ctrl.adminListPartners);

router.get('/jobs/:id/options', authenticate, ctrl.getPaymentOptions);
router.post('/jobs/:id/credit-quote', authenticate, rejectImpersonated, paymentsLimiter, ctrl.createCreditQuote);

router.get('/jobs/:id/rail-switch', authenticate, ctrl.getRailSwitch);
router.post('/jobs/:id/rail-switch', authenticate, rejectImpersonated, paymentsLimiter, ctrl.requestRailSwitch);
router.post('/jobs/:id/rail-switch/:requestId/respond', authenticate, rejectImpersonated, paymentsLimiter, ctrl.respondRailSwitch);

router.get('/jobs/:id/offline-payment', authenticate, ctrl.getOfflinePayment);
router.post('/jobs/:id/offline-payment/confirm', authenticate, rejectImpersonated, ctrl.confirmOfflinePayment);

router.get('/jobs/:id/tips', authenticate, ctrl.listTips);
router.post('/jobs/:id/tips/quote', authenticate, ctrl.quoteTip);
// Review P2-7-F07: tips initiate a payment; honor checkout restrictions.
router.post('/jobs/:id/tips', authenticate, rejectImpersonated, checkRestrictions('checkout'), paymentsLimiter, ctrl.createTip);

router.get('/cashout/eligibility', authenticate, ctrl.getCashoutEligibility);
router.get('/cashout', authenticate, ctrl.listCashouts);
router.post('/cashout', authenticate, rejectImpersonated, paymentsLimiter, ctrl.requestCashout);

router.get('/privacy/erasure', authenticate, ctrl.getErasureStatus);
router.post('/privacy/erasure', authenticate, rejectImpersonated, ctrl.requestErasure);

router.use(errorHandler);

module.exports = router;
