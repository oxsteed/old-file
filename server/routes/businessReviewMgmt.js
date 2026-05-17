const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const requireBusinessAccess = require('../middleware/requireBusinessAccess');
const ctrl = require('../controllers/businessReviewManagementController');

router.get ('/:businessId/reviews-manage',                         requireAuth, requireBusinessAccess({ minRole: 'any' }),     ctrl.listReviews);
router.post('/:businessId/reviews-manage/:reviewId/reply',         requireAuth, requireBusinessAccess({ minRole: 'any' }),     ctrl.replyToReview);
router.delete('/:businessId/reviews-manage/:reviewId/reply',       requireAuth, requireBusinessAccess({ minRole: 'any' }),     ctrl.deleteReply);
router.post('/:businessId/review-requests',                        requireAuth, requireBusinessAccess({ minRole: 'any' }),     ctrl.sendReviewRequest);
router.get ('/:businessId/review-requests',                        requireAuth, requireBusinessAccess({ minRole: 'any' }),     ctrl.listReviewRequests);

module.exports = router;
