const express = require('express');
const { authenticate } = require('../middleware/auth');
const { generalLimiter } = require('../middleware/rateLimiter');
const reviewsController = require('../controllers/reviewsController');

const router = express.Router();

// Rate limiting
router.use(generalLimiter);

// ── Customer endpoints ────────────────────────────────────────────────────────

// POST submit a review for a completed lead (authenticated customer only)
router.post('/:businessId/submit', authenticate, reviewsController.submitReview);

// DELETE a review (customer or business owner)
router.delete('/:reviewId', authenticate, reviewsController.deleteReview);

// ── Public endpoints (no authentication required) ────────────────────────────

// GET reviews for a business (public, paginated, with stats)
router.get('/:businessId', reviewsController.getBusinessReviews);

// GET review stats for a business (avg rating, distribution, total count)
router.get('/:businessId/stats', reviewsController.getReviewStats);

// ── Business owner endpoints ──────────────────────────────────────────────────

// PUT respond to a review (business owner only)
router.put('/:reviewId/respond', authenticate, reviewsController.respondToReview);

module.exports = router;
