const router      = require('express').Router();
const { authenticate, requireRole } = require('../middleware/auth');
const { requireAdmin } = require('../middleware/adminAuth');
const reviewCtrl  = require('../controllers/reviewController');

// Public
router.get('/users/:userId',          reviewCtrl.getUserReviews);
router.get('/user/:userId',          reviewCtrl.getUserReviews);

// Authenticated
router.post('/jobs/:jobId',
  authenticate,
  reviewCtrl.submitReview
);

router.get('/jobs/:jobId/eligibility',
  authenticate,
  reviewCtrl.getReviewEligibility
);

router.put('/:id/respond',
  authenticate,
  reviewCtrl.respondToReview
);

// Admin only
router.put('/:id/hide',
  authenticate,
  requireAdmin,
  reviewCtrl.adminHideReview
);

module.exports = router;
