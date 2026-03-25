const router = require('express').Router();
const { authenticate } = require('../middleware/auth');
const { createBid, getJobBids, getMyBids, updateBid, withdrawBid } = require('../controllers/bidController');

router.get('/me', authenticate, getMyBids);
router.post('/', authenticate, createBid);
router.get('/job/:jobId', authenticate, getJobBids);
router.put('/:id', authenticate, updateBid);
router.post('/:id/withdraw', authenticate, withdrawBid);

module.exports = router;
