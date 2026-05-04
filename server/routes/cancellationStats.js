const express = require('express');
const router = express.Router();
const cancellationStatsController = require('../controllers/cancellationStatsController');
const { requireAuth } = require('../middleware/auth');

/**
 * GET /api/cancellation-stats/customer/:userId
 * Full cancellation statistics for a customer
 * Public endpoint - shows to helpers considering bidding
 */
router.get('/customer/:userId', cancellationStatsController.getCustomerCancellationStats);

/**
 * GET /api/cancellation-stats/customer/:userId/summary
 * Quick summary for bid form display
 * Shows reliability score and message
 */
router.get('/customer/:userId/summary', cancellationStatsController.getCustomerCancellationSummary);

/**
 * GET /api/cancellation-stats/helper/:userId
 * Full cancellation statistics for a helper's accepted jobs
 * Public endpoint - shows to customers considering this helper
 */
router.get('/helper/:userId', cancellationStatsController.getHelperCancellationStats);

/**
 * POST /api/cancellation-stats/refresh
 * Refresh materialized views (admin only or system token)
 * Called by cron job or manual trigger
 */
router.post('/refresh', requireAuth, cancellationStatsController.refreshCancellationStats);

module.exports = router;
