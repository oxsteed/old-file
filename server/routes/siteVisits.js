const express = require('express');
const router = express.Router();
const siteVisitController = require('../controllers/siteVisitController');
const { optionalAuth, authenticate } = require('../middleware/auth');
const { requireAdmin, requirePermission } = require('../middleware/adminAuth');
const { generalLimiter } = require('../middleware/rateLimiter');

// Public pageview beacon. Rate-limited; never requires auth, but attributes
// the visit to the signed-in user when a valid Bearer token is supplied.
router.post('/pageview', generalLimiter, optionalAuth, siteVisitController.recordPageview);

// Admin visitor history. Privacy-sensitive (visitor locations), so it needs
// the dedicated grant; super-admins hold every grant implicitly.
router.use('/admin', authenticate, requireAdmin, requirePermission('view_visitor_analytics'));
router.get('/admin/visitors', siteVisitController.listVisits);
router.get('/admin/visitors/summary', siteVisitController.getSummary);

module.exports = router;
