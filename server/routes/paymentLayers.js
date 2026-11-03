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
router.post('/cashout/stepup-challenges', authenticate, rejectImpersonated, paymentsLimiter, ctrl.issueCashoutStepup);
router.post('/cashout/:id/cancel', authenticate, rejectImpersonated, paymentsLimiter, ctrl.cancelCashout);
// Verified payout destinations (micro-deposit / one-time code, 3-day cooling-off).
router.get('/payout-destinations', authenticate, ctrl.listPayoutDestinations);
router.post('/payout-destinations', authenticate, rejectImpersonated, paymentsLimiter, ctrl.addPayoutDestination);
router.post('/payout-destinations/:id/verify', authenticate, rejectImpersonated, paymentsLimiter, ctrl.verifyPayoutDestination);
router.delete('/payout-destinations/:id', authenticate, rejectImpersonated, paymentsLimiter, ctrl.removePayoutDestination);

router.get('/privacy/erasure', authenticate, ctrl.getErasureStatus);
router.post('/privacy/erasure', authenticate, rejectImpersonated, ctrl.requestErasure);

// Licence readiness §7/§8/§10 (controllers/creditLicenceConsumerController).
const licence = require('../controllers/creditLicenceConsumerController');
router.post('/privacy/erasure/credit-disposition', authenticate, rejectImpersonated, paymentsLimiter, licence.chooseErasureDisposition);
router.get('/credit/disclosures', generalLimiter, licence.getDisclosures);
router.get('/credit/disclosures/mine', authenticate, licence.getDisclosures);
router.post('/credit/disclosures/accept', authenticate, rejectImpersonated, generalLimiter, licence.acceptDisclosures);
router.get('/credit/wage-consent', authenticate, licence.getWageConsent);
router.post('/credit/wage-consent', authenticate, rejectImpersonated, generalLimiter, licence.grantWageConsent);
router.post('/credit/wage-consent/withdraw', authenticate, rejectImpersonated, generalLimiter, licence.withdrawWageConsent);
router.get('/credit/wind-down', generalLimiter, licence.getWindDownStatus);
router.get('/credit/wind-down/mine', authenticate, licence.getMyWindDownStatus);
router.get('/cashout/disputes', authenticate, licence.listCashoutDisputes);
router.post('/cashout/:id/dispute', authenticate, rejectImpersonated, paymentsLimiter, licence.openCashoutDispute);

router.use(errorHandler);

module.exports = router;
