const router = require('express').Router();
const authenticate = require('../middleware/authenticate');
const { createJob, getJobs, getJob, updateJob, cancelJob, assignHelper, startJob, completeJob, getMyJobs } = require('../controllers/jobController');

// Protected - specific routes before parameterized
router.get('/me/list', authenticate, getMyJobs);
router.post('/', authenticate, createJob);
router.post('/assign', authenticate, assignHelper);

// Public
router.get('/', getJobs);
router.get('/:id', getJob);

// Protected - parameterized
router.put('/:id', authenticate, updateJob);
router.post('/:id/cancel', authenticate, cancelJob);
router.post('/:id/start', authenticate, startJob);
router.post('/:id/complete', authenticate, completeJob);

module.exports = router;
