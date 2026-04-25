const express = require('express');
const router = express.Router();
const adminConsultingController = require('../controllers/adminConsultingController');
const { authenticate } = require('../middleware/auth');

// Admin-only routes (add requireAdmin middleware in implementation)
router.get('/requests', authenticate, adminConsultingController.getConsultingRequests);
router.post('/assign', authenticate, adminConsultingController.assignConsultantToRequest);
router.patch('/requests/:session_id/status', authenticate, adminConsultingController.updateRequestStatus);
router.get('/consultants', authenticate, adminConsultingController.getAvailableConsultants);
router.post('/invoices/generate', authenticate, adminConsultingController.generateInvoice);
router.get('/dashboard-stats', authenticate, adminConsultingController.getDashboardStats);

module.exports = router;
