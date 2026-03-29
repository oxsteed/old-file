const router = require('express').Router();
const { authenticate } = require('../middleware/auth');
const { requireOnboardingStep, requireTier } = require('../middleware/helperOnboardingMiddleware');
const { createBid, getJobBids, getMyBids, updateBid, withdrawBid } = require('../controllers/bidController');

// Any authenticated user can view bids
router.get('/me', authenticate, getMyBids);
router.get('/job/:jobId', authenticate, getJobBids);
router.put('/:id', authenticate, updateBid);
router.post('/:id/withdraw', authenticate, withdrawBid);

// Creating a bid requires active onboarding + active/premium tier
router.post('/', authenticate, requireOnboardingStep('active'), requireTier('active'), createBid);

module.exports = router;
