const express = require('express');
const router = express.Router();
const consultingController = require('../controllers/allPhasesConsultingController');
const { authenticate } = require('../middleware/auth');
const { requireAdmin } = require('../middleware/adminAuth');
const { generalLimiter } = require('../middleware/rateLimiter');

const adminAuth = [authenticate, requireAdmin];

// PHASE 1: Consultant Management (admin only)
router.post('/consultants', ...adminAuth, consultingController.createConsultant);
router.get('/consultants', ...adminAuth, consultingController.getConsultants);
router.put('/consultants/:id', ...adminAuth, consultingController.updateConsultant);
router.post('/consultants/:id/availability', ...adminAuth, consultingController.setConsultantAvailability);
router.post('/sessions/assign', ...adminAuth, consultingController.assignConsultant);

// PHASE 2: Scheduling
router.post('/sessions/:sessionId/schedule', ...adminAuth, consultingController.scheduleSession);
router.post('/sessions/:sessionId/notes', ...adminAuth, consultingController.addSessionNote);

// PHASE 3: Session Delivery & Progress
router.patch('/sessions/:sessionId/phase', ...adminAuth, consultingController.updateSessionPhase);
router.post('/sessions/:sessionId/deliverables', ...adminAuth, consultingController.addDeliverable);
router.post('/sessions/:sessionId/action-items', ...adminAuth, consultingController.addActionItem);

// PHASE 4: Pricing & Packages
router.get('/packages', generalLimiter, consultingController.getPackages);
router.post('/purchase', authenticate, consultingController.purchasePackage);

// PHASE 5: Client Portal
router.get('/portal/dashboard', authenticate, consultingController.getPortalDashboard);

// PHASE 6: Feedback
router.post('/sessions/:sessionId/feedback', authenticate, consultingController.submitSessionFeedback);

// PHASE 7: Referrals & Analytics
router.post('/referral', authenticate, consultingController.createReferralLink);
router.get('/analytics', ...adminAuth, consultingController.getAnalytics);

module.exports = router;
