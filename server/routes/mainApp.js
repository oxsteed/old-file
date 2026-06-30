'use strict';

const express = require('express');
const router = express.Router();
const { authenticate, optionalAuth } = require('../middleware/auth');
const ctrl = require('../controllers/mainAppController');

router.get('/home', optionalAuth, ctrl.getHomeDashboard);
router.get('/activity', authenticate, ctrl.getActivityFeed);
router.get('/profile-summary', authenticate, ctrl.getProfileSummary);
router.get('/business-hub', authenticate, ctrl.getBusinessHub);
router.get('/billing', authenticate, ctrl.getBillingHub);
router.get('/transactions', authenticate, ctrl.getTransactionHistory);
router.get('/payouts/summary', authenticate, ctrl.getPayoutSummary);
router.post('/payouts', authenticate, ctrl.requestPayout);
router.post('/payouts/:requestId/cancel', authenticate, ctrl.cancelPayoutRequest);
router.get('/payment-requests', authenticate, ctrl.listPaymentRequests);
router.post('/payment-requests', authenticate, ctrl.createPaymentRequest);
router.get('/referrals', authenticate, ctrl.getReferralDashboard);
router.get('/promos', authenticate, ctrl.getPromoWallet);
router.post('/promos/redeem', authenticate, ctrl.redeemPromoCode);
router.get('/disputes', authenticate, ctrl.getDisputeRefunds);
router.post('/disputes', authenticate, ctrl.createDisputeRefund);
router.get('/service-packages', optionalAuth, ctrl.getServicePackages);
router.get('/service-availability', optionalAuth, ctrl.getServiceAvailability);
router.get('/reviews/received', authenticate, ctrl.getReceivedReviews);
router.get('/earnings', authenticate, ctrl.getHelperEarningsDashboard);
router.get('/tax-documents', authenticate, ctrl.getTaxDocuments);
router.post('/data-export', authenticate, ctrl.requestDataExport);
router.post('/support-reports', authenticate, ctrl.createSupportReport);

module.exports = router;
