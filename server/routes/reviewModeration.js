/**
 * reviewModeration.js
 * Routes for review reporting and moderation
 */

const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { requireAdmin } = require('../middleware/adminAuth');
const ctrl = require('../controllers/reviewModerationController');

// ── Public/Authenticated: Report a review ──────────────────────
router.post('/reviews/:reviewId/report', requireAuth, ctrl.reportReview);
router.get('/reviews/my-reports', requireAuth, ctrl.getMyReports);

// ── Admin: Manage review reports ──────────────────────────────
router.get('/admin/reviews/reports', requireAuth, requireAdmin, ctrl.listReports);
router.get('/admin/reviews/reports/:reportId', requireAuth, requireAdmin, ctrl.getReportDetail);
router.put('/admin/reviews/reports/:reportId/resolve', requireAuth, requireAdmin, ctrl.resolveReport);
router.get('/admin/reviews/stats', requireAuth, requireAdmin, ctrl.getModerationStats);

module.exports = router;
