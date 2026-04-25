const express = require('express');
const router = express.Router();
const consultingAnalyticsController = require('../controllers/consultingAnalyticsController');
const { authenticate } = require('../middleware/auth');

// Public endpoints - analytics for Admins only
router.get('/platform-stats', authenticate, consultingAnalyticsController.getPlatformStats);
router.get('/consultants', consultingAnalyticsController.getConsultantsList);
router.get('/consultants/top', consultingAnalyticsController.getTopConsultants);
router.get('/consultants/:consultantId/performance', authenticate, consultingAnalyticsController.getConsultantPerformance);
router.get('/consultants/:consultantId/revenue', authenticate, consultingAnalyticsController.getConsultantRevenue);

router.get('/service-tiers', consultingAnalyticsController.getServiceTierAnalytics);
router.get('/conversion-funnel', authenticate, consultingAnalyticsController.getConversionFunnel);
router.get('/feedback-trends', authenticate, consultingAnalyticsController.getFeedbackTrends);

module.exports = router;
