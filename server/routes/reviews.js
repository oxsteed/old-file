const router      = require('express').Router();
const { authenticate } = require('../middleware/auth');
const { requireAdmin, requirePermission } = require('../middleware/adminAuth');
const { errorHandler } = require('../middleware/errorHandler');
const reviewCtrl = require('../controllers/reviewController');

// Public
router.get('/users/:userId', reviewCtrl.getUserReviews);

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
  requireAdmin, requirePermission('moderate_content'),
  reviewCtrl.adminHideReview
);

// Route-local JSON error handler for consistent API responses when this router
// is mounted without the global server error handler (tests, serverless, etc.).
router.use(errorHandler);

module.exports = router;
