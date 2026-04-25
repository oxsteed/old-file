const express = require('express');
const router = express.Router();
const adminConsultingController = require('../controllers/adminConsultingController');
const { requireAdmin } = require('../middleware/adminAuth');

router.get('/requests', requireAdmin, adminConsultingController.getConsultingRequests);
router.post('/assign', requireAdmin, adminConsultingController.assignConsultantToRequest);
router.patch('/requests/:session_id/status', requireAdmin, adminConsultingController.updateRequestStatus);
router.get('/consultants', requireAdmin, adminConsultingController.getAvailableConsultants);
router.post('/invoices/generate', requireAdmin, adminConsultingController.generateInvoice);
router.get('/dashboard-stats', requireAdmin, adminConsultingController.getDashboardStats);

module.exports = router;
