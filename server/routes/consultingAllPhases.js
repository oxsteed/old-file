const express = require('express');
const router = express.Router();
const consultingController = require('../controllers/allPhasesConsultingController');
const { authenticate } = require('../middleware/auth');
const { requireAdmin, requirePermission } = require('../middleware/adminAuth');

const adminAuth = [authenticate, requireAdmin, requirePermission('manage_operations')];

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
// Weekly self-audit 2026-11-04 item 8: the GET /packages registration
// that used to sit here was unreachable (consultingPayment mounts first
// on the same path, and the web client calls that handler). The shadowed
// registration is deleted; the live GET lives in consultingPayment.js.
router.post('/purchase', authenticate, consultingController.purchasePackage);

// PHASE 5: Client Portal
router.get('/portal/dashboard', authenticate, consultingController.getPortalDashboard);

// PHASE 6: Feedback
router.post('/sessions/:sessionId/feedback', authenticate, consultingController.submitSessionFeedback);

// PHASE 7: Referrals & Analytics
router.post('/referral', authenticate, consultingController.createReferralLink);
router.get('/analytics', ...adminAuth, consultingController.getAnalytics);

module.exports = router;
