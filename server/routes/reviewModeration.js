/**
 * reviewModeration.js
 * Routes for review reporting and moderation
 */

const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { requireAdmin, requirePermission } = require('../middleware/adminAuth');
const ctrl = require('../controllers/reviewModerationController');

// ── Public/Authenticated: Report a review ──────────────────────
router.post('/reviews/:reviewId/report', requireAuth, ctrl.reportReview);
router.get('/reviews/my-reports', requireAuth, ctrl.getMyReports);

// ── Admin: Manage review reports ──────────────────────────────
router.get('/admin/reviews/reports', requireAuth, requireAdmin, requirePermission('moderate_content'), ctrl.listReports);
router.get('/admin/reviews/reports/:reportId', requireAuth, requireAdmin, requirePermission('moderate_content'), ctrl.getReportDetail);
router.put('/admin/reviews/reports/:reportId/resolve', requireAuth, requireAdmin, requirePermission('moderate_content'), ctrl.resolveReport);
router.get('/admin/reviews/stats', requireAuth, requireAdmin, requirePermission('moderate_content'), ctrl.getModerationStats);

module.exports = router;
