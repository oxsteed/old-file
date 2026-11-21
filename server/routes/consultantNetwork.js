const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { requireAdmin } = require('../middleware/adminAuth');
const controller = require('../controllers/consultantNetworkController');

router.get('/profile', authenticate, controller.getMyConsultantProfile);
router.put('/profile', authenticate, controller.upsertMyConsultantProfile);
router.get('/dashboard', authenticate, controller.getMyConsultantDashboard);
router.patch('/referrals/:requestId', authenticate, controller.updateMyReferral);

// Group 10 Slice A (501-510).
router.get('/readiness', authenticate, controller.getMyConsultantReadiness);
router.get('/pricing-summary', authenticate, controller.getMyConsultantPricingSummary);
router.get('/portfolio', authenticate, controller.listMyPortfolio);
router.post('/portfolio', authenticate, controller.createPortfolioItem);
router.put('/portfolio/:itemId', authenticate, controller.updatePortfolioItem);
router.delete('/portfolio/:itemId', authenticate, controller.deletePortfolioItem);
// Public specialty profile (506). No auth: only approved, active profiles
// are ever returned; anything else 404s.
router.get('/public/:userId', controller.getPublicConsultantProfile);
// Admin profile approval workflow (504).
router.get('/admin/profiles', authenticate, requireAdmin, controller.listConsultantProfilesForReview);
router.post('/admin/profiles/:userId/decision', authenticate, requireAdmin, controller.decideConsultantProfileApproval);

module.exports = router;
