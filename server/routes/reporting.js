/**
 * reporting.js
 * Routes for user reports and abuse reporting
 */

const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { requireAdmin, requirePermission } = require('../middleware/adminAuth');
const reportingController = require('../controllers/reportingController');

const router = express.Router();

// Public/Authenticated routes
router.post('/', requireAuth, reportingController.submitReport);
router.get('/my-reports', requireAuth, reportingController.getMyReports);

// Admin routes
router.get('/admin/all', requireAuth, requireAdmin, requirePermission('moderate_content'), reportingController.listReports);
router.get('/admin/:reportId', requireAuth, requireAdmin, requirePermission('moderate_content'), reportingController.getReportDetail);
router.patch('/admin/:reportId/status', requireAuth, requireAdmin, requirePermission('moderate_content'), reportingController.updateReportStatus);

module.exports = router;
