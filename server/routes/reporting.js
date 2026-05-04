/**
 * reporting.js
 * Routes for user reports and abuse reporting
 */

const express = require('express');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const reportingController = require('../controllers/reportingController');

const router = express.Router();

// Public/Authenticated routes
router.post('/', requireAuth, reportingController.submitReport);
router.get('/my-reports', requireAuth, reportingController.getMyReports);

// Admin routes
router.get('/admin/all', requireAdmin, reportingController.listReports);
router.get('/admin/:reportId', requireAdmin, reportingController.getReportDetail);
router.patch('/admin/:reportId/status', requireAdmin, reportingController.updateReportStatus);

module.exports = router;
