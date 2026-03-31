// Job routes with media upload support
const router = require('express').Router();
const { authenticate } = require('../middleware/auth');
const upload = require('../middleware/upload');
const { createJob, getJobs, getJob, updateJob, cancelJob, assignHelper, startJob, completeJob, closeJob, getMyJobs } = require('../controllers/jobController');

// Protected — specific routes before parameterized
router.get('/me/list', authenticate, getMyJobs);
router.post('/', authenticate, upload.array('media', 10), createJob);
router.post('/assign', authenticate, assignHelper);

// Public
router.get('/', getJobs);
router.get('/:id', getJob);

// Protected — parameterized
router.put('/:id', authenticate, updateJob);
router.post('/:id/cancel', authenticate, cancelJob);
router.post('/:id/start', authenticate, startJob);
router.post('/:id/complete', authenticate, completeJob);

router.post('/:id/close', authenticate, closeJob);

module.exports = router;
