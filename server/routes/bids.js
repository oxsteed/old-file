const router = require('express').Router();
const { authenticate } = require('../middleware/auth');
const requireEmailVerified = require('../middleware/requireEmailVerified');
const { generalLimiter } = require('../middleware/rateLimiter');
const { requireOnboardingStep, requireTier } = require('../middleware/helperOnboardingMiddleware');
const checkRestrictions = require('../middleware/checkRestrictions');
const { errorHandler } = require('../middleware/errorHandler');
const { createBid, getBid, getJobBids, getMyBids, updateBid, withdrawBid, getRecentBids } = require('../controllers/bidController');

// Public route - no auth required (for homepage)
router.get('/recent', generalLimiter, getRecentBids);

// Any authenticated user can view bids
router.get('/me', authenticate, getMyBids);
router.get('/job/:jobId', authenticate, getJobBids);
router.get('/:id', authenticate, getBid);
router.put('/:id', authenticate, updateBid);
router.post('/:id/withdraw', authenticate, withdrawBid);

// Creating a bid requires email verification + active onboarding + pro tier (trial or paid)
// checkRestrictions('bidding') blocks helpers with active bidding restrictions
router.post('/', authenticate, requireEmailVerified, requireOnboardingStep('active'), requireTier('pro'), checkRestrictions('bidding'), createBid);

// Route-local JSON error handler for consistent API responses when this router
// is mounted without the global server error handler (tests, serverless, etc.).
router.use(errorHandler);

module.exports = router;
