const express = require('express');
const router = express.Router();
const consultingController = require('../controllers/consultingController');
const { authenticate } = require('../middleware/auth');
const { generalLimiter } = require('../middleware/rateLimiter');
const { requireFeatureEnabled } = require('../middleware/featureFlags');

// Audit fix: Consulting is launch-hidden. Gate the API to match the UI.
const requireConsultingEnabled = requireFeatureEnabled('Consulting', 'CONSULTING_ENABLED', false);

// Public endpoints
router.post('/submit', generalLimiter, requireConsultingEnabled, consultingController.submitConsultingRequest);
router.get('/areas', generalLimiter, requireConsultingEnabled, consultingController.getAreasOfHelp);
router.get('/tiers', generalLimiter, requireConsultingEnabled, consultingController.getServiceTiers);

// Protected endpoints
router.get('/my-sessions', authenticate, consultingController.getUserConsultingSessions);
router.get('/:id', authenticate, consultingController.getConsultingSession);

module.exports = router;
