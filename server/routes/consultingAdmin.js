const express = require('express');
const router = express.Router();
const adminConsultingController = require('../controllers/adminConsultingController');
const { authenticate } = require('../middleware/auth');
const { requireAdmin } = require('../middleware/adminAuth');

// Admin-only routes
router.get('/requests', authenticate, requireAdmin, adminConsultingController.getConsultingRequests);
router.post('/assign', authenticate, requireAdmin, adminConsultingController.assignConsultantToRequest);
router.patch('/requests/:session_id/status', authenticate, requireAdmin, adminConsultingController.updateRequestStatus);
router.get('/consultants', authenticate, requireAdmin, adminConsultingController.getAvailableConsultants);
router.post('/invoices/generate', authenticate, requireAdmin, adminConsultingController.generateInvoice);
router.get('/dashboard-stats', authenticate, requireAdmin, adminConsultingController.getDashboardStats);

// Consulting sessions management routes
router.get('/sessions', authenticate, requireAdmin, adminConsultingController.listSessions);
router.get('/sessions/:id', authenticate, requireAdmin, adminConsultingController.getSessionDetail);
router.patch('/sessions/:id', authenticate, requireAdmin, adminConsultingController.updateSessionDetails);
router.patch('/sessions/:sessionId/complete', authenticate, requireAdmin, adminConsultingController.completeSession);
router.patch('/sessions/:sessionId/no-show', authenticate, requireAdmin, adminConsultingController.markNoShow);

module.exports = router;
