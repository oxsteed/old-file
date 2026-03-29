const router = require('express').Router();
const { authenticate } = require('../middleware/auth');
const { requireCompletedHelperOnboarding } = require('../middleware/helperOnboardingMiddleware');
const { createBid, getJobBids, getMyBids, updateBid, withdrawBid } = require('../controllers/bidController');

// Any authenticated user can view bids
router.get('/me', authenticate, getMyBids);
router.get('/job/:jobId', authenticate, getJobBids);
router.put('/:id', authenticate, updateBid);
router.post('/:id/withdraw', authenticate, withdrawBid);

// Step 3: Creating a bid requires fully onboarded helper
router.post('/', authenticate, requireCompletedHelperOnboarding, createBid);

module.exports = router;
