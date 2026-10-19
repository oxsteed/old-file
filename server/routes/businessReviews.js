const express = require('express');
const { authenticate } = require('../middleware/auth');
const { generalLimiter } = require('../middleware/rateLimiter');
const reviewsController = require('../controllers/reviewsController');

const router = express.Router();
const { scopeExempt } = require('../middleware/scopeGates');

// Rate limiting
router.use(generalLimiter);

// ── Customer endpoints ────────────────────────────────────────────────────────

// POST submit a review for a completed lead (authenticated customer only)
router.post('/:businessId/submit', authenticate, scopeExempt('public-intake'), reviewsController.submitReview);

// DELETE a review (review author only; P2-8-F15)
router.delete('/:reviewId', authenticate, reviewsController.deleteReview);

// ── Public endpoints (no authentication required) ────────────────────────────

// GET reviews for a business (public, paginated, with stats)
router.get('/:businessId', scopeExempt('public-storefront'), reviewsController.getBusinessReviews);

// GET review stats for a business (avg rating, distribution, total count)
router.get('/:businessId/stats', scopeExempt('public-storefront'), reviewsController.getReviewStats);

// ── Business owner endpoints ──────────────────────────────────────────────────

// PUT respond to a review (business owner only)
router.put('/:reviewId/respond', authenticate, reviewsController.respondToReview);

module.exports = router;
