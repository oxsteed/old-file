const express = require('express');
const router = express.Router();
const adminConsultingController = require('../controllers/adminConsultingController');
const { authenticate } = require('../middleware/auth');
const { requireAdmin, requirePermission } = require('../middleware/adminAuth');

const auth = [authenticate, requireAdmin];

// Dashboard & stats
router.get('/dashboard-stats', ...auth, adminConsultingController.getEnhancedDashboardStats);

// Requests management
router.get('/requests', ...auth, adminConsultingController.getConsultingRequests);
router.post('/requests/create', ...auth, adminConsultingController.createSessionManually);
router.patch('/requests/:id/status', ...auth, adminConsultingController.updateRequestStatusById);

// Consultant assignment
router.post('/assign', ...auth, adminConsultingController.assignConsultantToRequest);
router.get('/consultants', ...auth, adminConsultingController.getAvailableConsultants);

// Invoices & packages
// T25-F01: invoice generation creates records (write), so it requires the
// operations write grant, not the read-only view_financials.
router.post('/invoices/generate', ...auth, requirePermission('manage_operations'), adminConsultingController.generateInvoice);
router.post('/invoices/generate-manual', ...auth, requirePermission('manage_operations'), adminConsultingController.generateManualInvoice);
router.get('/invoices/:invoiceId/download', ...auth, requirePermission('view_financials'), adminConsultingController.downloadInvoice);
router.get('/invoices', ...auth, requirePermission('view_financials'), adminConsultingController.listInvoices);
router.get('/purchases', ...auth, requirePermission('view_financials'), adminConsultingController.listPurchases);
// T25-F01: package changes alter what customers pay; require the grant.
router.patch('/packages/:id', ...auth, requirePermission('manage_operations'), adminConsultingController.updatePackage);

// Sessions management
router.get('/sessions', ...auth, adminConsultingController.listSessions);
router.post('/sessions/create', ...auth, adminConsultingController.createSessionManually);
router.get('/sessions/:id', ...auth, adminConsultingController.getSessionDetail);
router.patch('/sessions/:id', ...auth, adminConsultingController.updateSessionDetails);
router.patch('/sessions/:sessionId/complete', ...auth, adminConsultingController.completeSession);
router.patch('/sessions/:sessionId/no-show', ...auth, adminConsultingController.markNoShow);
router.post('/sessions/:id/send-reminder', ...auth, adminConsultingController.sendSessionReminder);
router.post('/sessions/:id/send-followup', ...auth, adminConsultingController.sendSessionFollowUp);
router.post('/sessions/:id/send-invite', ...auth, adminConsultingController.sendSessionReminder);

module.exports = router;
