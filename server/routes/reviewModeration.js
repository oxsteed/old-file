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
// reviewType comes from the body ('product' default); the convenience
// routes below pin it for business, food and job reviews so clients do not
// have to know the discriminator.
const reportWithType = (reviewType) => (req, res, next) => {
  req.body = { ...(req.body || {}), reviewType: req.body?.reviewType || reviewType };
  return ctrl.reportReview(req, res, next);
};
router.post('/reviews/:reviewId/report', requireAuth, ctrl.reportReview);
router.post('/business-reviews/:reviewId/report', requireAuth, reportWithType('business'));
router.post('/food/reviews/:reviewId/report', requireAuth, reportWithType('food'));
// P2-8-F18: job reviews (the `reviews` table) can be reported in-app too.
router.post('/job-reviews/:reviewId/report', requireAuth, reportWithType('job'));
router.get('/reviews/my-reports', requireAuth, ctrl.getMyReports);

// ── Admin: Manage review reports ──────────────────────────────
router.get('/admin/reviews/reports', requireAuth, requireAdmin, requirePermission('moderate_content'), ctrl.listReports);
router.get('/admin/reviews/reports/:reportId', requireAuth, requireAdmin, requirePermission('moderate_content'), ctrl.getReportDetail);
router.put('/admin/reviews/reports/:reportId/resolve', requireAuth, requireAdmin, requirePermission('moderate_content'), ctrl.resolveReport);
router.get('/admin/reviews/stats', requireAuth, requireAdmin, requirePermission('moderate_content'), ctrl.getModerationStats);

module.exports = router;
