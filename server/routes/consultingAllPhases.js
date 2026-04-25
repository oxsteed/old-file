const express = require('express');
const router = express.Router();
const consultingController = require('../controllers/allPhasesConsultingController');
const { authenticate } = require('../middleware/auth');
const { generalLimiter } = require('../middleware/rateLimiter');

// PHASE 1: Consultant Management (admin only)
router.post('/consultants', authenticate, consultingController.createConsultant);
router.get('/consultants', authenticate, consultingController.getConsultants);
router.put('/consultants/:id', authenticate, consultingController.updateConsultant);
router.post('/consultants/:id/availability', authenticate, consultingController.setConsultantAvailability);
router.post('/sessions/assign', authenticate, consultingController.assignConsultant);

// PHASE 2: Scheduling
router.post('/sessions/:sessionId/schedule', authenticate, consultingController.scheduleSession);
router.post('/sessions/:sessionId/notes', authenticate, consultingController.addSessionNote);

// PHASE 3: Session Delivery & Progress
router.patch('/sessions/:sessionId/phase', authenticate, consultingController.updateSessionPhase);
router.post('/sessions/:sessionId/deliverables', authenticate, consultingController.addDeliverable);
router.post('/sessions/:sessionId/action-items', authenticate, consultingController.addActionItem);

// PHASE 4: Pricing & Packages
router.get('/packages', generalLimiter, consultingController.getPackages);
router.post('/purchase', authenticate, consultingController.purchasePackage);

// PHASE 5: Client Portal
router.get('/portal/dashboard', authenticate, consultingController.getPortalDashboard);

// PHASE 6: Feedback
router.post('/sessions/:sessionId/feedback', authenticate, consultingController.submitSessionFeedback);

// PHASE 7: Referrals & Analytics
router.post('/referral', authenticate, consultingController.createReferralLink);
router.get('/analytics', authenticate, consultingController.getAnalytics);

module.exports = router;
