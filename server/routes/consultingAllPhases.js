const express = require('express');
const router = express.Router();
const consultingController = require('../controllers/allPhasesConsultingController');
const { authenticate } = require('../middleware/auth');
const { requireAdmin } = require('../middleware/adminAuth');
const { generalLimiter } = require('../middleware/rateLimiter');

// PHASE 1: Consultant Management (admin only)
router.post('/consultants', requireAdmin, consultingController.createConsultant);
router.get('/consultants', requireAdmin, consultingController.getConsultants);
router.put('/consultants/:id', requireAdmin, consultingController.updateConsultant);
router.post('/consultants/:id/availability', requireAdmin, consultingController.setConsultantAvailability);
router.post('/sessions/assign', requireAdmin, consultingController.assignConsultant);

// PHASE 2: Scheduling (admin only)
router.post('/sessions/:sessionId/schedule', requireAdmin, consultingController.scheduleSession);
router.post('/sessions/:sessionId/notes', requireAdmin, consultingController.addSessionNote);

// PHASE 3: Session Delivery & Progress (admin only)
router.patch('/sessions/:sessionId/phase', requireAdmin, consultingController.updateSessionPhase);
router.post('/sessions/:sessionId/deliverables', requireAdmin, consultingController.addDeliverable);
router.post('/sessions/:sessionId/action-items', requireAdmin, consultingController.addActionItem);

// PHASE 4: Pricing & Packages
router.get('/packages', generalLimiter, consultingController.getPackages);

// PHASE 5: Client Portal
router.get('/portal/dashboard', authenticate, consultingController.getPortalDashboard);

// PHASE 6: Feedback (client — ownership verified in controller)
router.post('/sessions/:sessionId/feedback', authenticate, consultingController.submitSessionFeedback);

// PHASE 7: Referrals & Analytics
router.post('/referral', authenticate, consultingController.createReferralLink);
router.get('/analytics', requireAdmin, consultingController.getAnalytics);

module.exports = router;
