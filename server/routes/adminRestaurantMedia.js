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
const videoCtrl = require('../controllers/restaurantMediaVideoController');

router.use(requireAdmin);

const contentGate = requirePermission('moderate_content');

router.get('/flags', contentGate, ctrl.adminListMediaFlags);
// The flag-review endpoint also accepts a DMCA takedown: {action:'remove',
// takedownReason:'dmca'} routes to the video pipeline's DMCA handler, which
// hides the media, records 'DMCA takedown' on the review and in the audit
// trail. Every other action goes through the standard review controller.
router.post('/flags/:flagId/review', contentGate, (req, res, next) => {
  if (String(req.body?.action) === 'remove' && String(req.body?.takedownReason) === 'dmca') {
    return videoCtrl.adminDmcaTakedownReview(req, res, next);
  }
  return ctrl.adminReviewMediaFlag(req, res, next);
});

router.use(errorHandler);

module.exports = router;
