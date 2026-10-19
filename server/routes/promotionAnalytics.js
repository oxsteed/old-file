'use strict';

const express = require('express');
const { authenticate, optionalAuth } = require('../middleware/auth');
const { generalLimiter } = require('../middleware/rateLimiter');
const ctrl = require('../controllers/promotionAnalyticsController');

const router = express.Router();

// Helper-owned Growth Center analytics (the caller's own events only).
router.post('/share', authenticate, generalLimiter, ctrl.recordHelperShare);
router.get('/performance', authenticate, ctrl.getHelperPerformance);
// Public landing beacon from tracked links (helper or business profiles).
router.post('/visit', optionalAuth, generalLimiter, ctrl.recordVisit);

module.exports = router;
