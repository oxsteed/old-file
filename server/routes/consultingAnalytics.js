const express = require('express');
const router = express.Router();
const consultingAnalyticsController = require('../controllers/consultingAnalyticsController');
const { authenticate } = require('../middleware/auth');
const { requireAdmin, requirePermission } = require('../middleware/adminAuth');

// All consulting analytics routes are admin-only.
// Business intelligence (consultant performance, revenue, conversion funnels,
// feedback trends, service tier analytics) must not leak to unauthenticated users.
router.use(authenticate, requireAdmin, requirePermission('manage_operations'));

router.get('/platform-stats', consultingAnalyticsController.getPlatformStats);
router.get('/consultants', consultingAnalyticsController.getConsultantsList);
router.get('/consultants/top', consultingAnalyticsController.getTopConsultants);
router.get('/consultants/:consultantId/performance', consultingAnalyticsController.getConsultantPerformance);
router.get('/consultants/:consultantId/revenue', requirePermission('view_financials'), consultingAnalyticsController.getConsultantRevenue);
router.get('/service-tiers', consultingAnalyticsController.getServiceTierAnalytics);
router.get('/conversion-funnel', consultingAnalyticsController.getConversionFunnel);
router.get('/feedback-trends', consultingAnalyticsController.getFeedbackTrends);

module.exports = router;
