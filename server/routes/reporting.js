/**
 * reporting.js
 * Routes for user reports and abuse reporting
 */

const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { requireAdmin } = require('../middleware/adminAuth');
const reportingController = require('../controllers/reportingController');

const router = express.Router();

// Public/Authenticated routes
router.post('/', requireAuth, reportingController.submitReport);
router.get('/my-reports', requireAuth, reportingController.getMyReports);

// Admin routes
router.get('/admin/all', requireAuth, requireAdmin, reportingController.listReports);
router.get('/admin/:reportId', requireAuth, requireAdmin, reportingController.getReportDetail);
router.patch('/admin/:reportId/status', requireAuth, requireAdmin, reportingController.updateReportStatus);

module.exports = router;
