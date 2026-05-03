const router = require('express').Router();
const { authenticate } = require('../middleware/auth');
const requireEmailVerified = require('../middleware/requireEmailVerified');
const { generalLimiter } = require('../middleware/rateLimiter');
const { requireOnboardingStep, requireTier } = require('../middleware/helperOnboardingMiddleware');
const { createBid, getJobBids, getMyBids, updateBid, withdrawBid, getRecentBids } = require('../controllers/bidController');

// Public route - no auth required (for homepage)
router.get('/recent', generalLimiter, getRecentBids);

// Any authenticated user can view bids
router.get('/me', authenticate, getMyBids);
router.get('/job/:jobId', authenticate, getJobBids);
router.put('/:id', authenticate, updateBid);
router.post('/:id/withdraw', authenticate, withdrawBid);

// Creating a bid requires email verification + active onboarding + pro tier (trial or paid)
router.post('/', authenticate, requireEmailVerified, requireOnboardingStep('active'), requireTier('pro'), createBid);

module.exports = router;
