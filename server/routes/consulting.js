const express = require('express');
const router = express.Router();
const consultingController = require('../controllers/consultingController');
const { authenticate } = require('../middleware/auth');
const { generalLimiter } = require('../middleware/rateLimiter');

// Public endpoints
router.post('/submit', generalLimiter, consultingController.submitConsultingRequest);
router.get('/areas', generalLimiter, consultingController.getAreasOfHelp);
router.get('/tiers', generalLimiter, consultingController.getServiceTiers);

// Protected endpoints
router.get('/my-sessions', authenticate, consultingController.getUserConsultingSessions);
router.get('/:id', authenticate, consultingController.getConsultingSession);

module.exports = router;
