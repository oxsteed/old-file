const router = require('express').Router();
const authenticate = require('../middleware/authenticate');
const { createReview, getUserReviews, getJobReviews, getMyReviews, flagReview } = require('../controllers/reviewController');

router.post('/', authenticate, createReview);
router.get('/me', authenticate, getMyReviews);
router.get('/user/:user_id', getUserReviews);
router.get('/job/:job_id', getJobReviews);
router.post('/:id/flag', authenticate, flagReview);

module.exports = router;
