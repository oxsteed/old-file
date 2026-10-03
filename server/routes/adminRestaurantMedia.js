'use strict';

// Admin routes for restaurant Media tab flags (mounted at /api/admin/restaurant-media).
//
// Admin-only, and every action needs the explicit moderate_content grant
// (super-admin bypasses the grant but NOT the audit trail, which is keyed on
// admin identity). Mirrors the Learn admin video-flag review
// (routes/learn.js + learnController adminListVideoFlags et al).

const router = require('express').Router();
const { requireAdmin, requirePermission } = require('../middleware/adminAuth');
const { errorHandler } = require('../middleware/errorHandler');
const ctrl = require('../controllers/restaurantMediaController');

router.use(requireAdmin);

const contentGate = requirePermission('moderate_content');

router.get('/flags', contentGate, ctrl.adminListMediaFlags);
router.post('/flags/:flagId/review', contentGate, ctrl.adminReviewMediaFlag);

router.use(errorHandler);

module.exports = router;
