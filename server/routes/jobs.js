const router  = require('express').Router();
const { authenticate } = require('../middleware/auth');
const upload  = require('../middleware/upload');
const { generalLimiter } = require('../middleware/rateLimiter');

const {
  createJob, getJobs, getJob, updateJob,
  cancelJob, assignHelper, startJob, completeJob, closeJob, getMyJobs,
} = require('../controllers/jobController');

const { getDraft, saveDraft, deleteDraft } = require('../controllers/draftController');

// ── Draft (must be before /:id) ───────────────────────────────────────────────
router.get('/draft',    authenticate, getDraft);
router.put('/draft',    authenticate, saveDraft);
router.delete('/draft', authenticate, deleteDraft);

// ── Protected specific routes ─────────────────────────────────────────────────
router.get('/me/list', authenticate, getMyJobs);
router.post('/',       authenticate, upload.array('media', 10), createJob);
router.post('/assign', authenticate, assignHelper);

// ── Public ────────────────────────────────────────────────────────────────────
router.get('/',     generalLimiter, getJobs);
router.get('/:id',  generalLimiter, getJob);

// ── Protected parameterized ───────────────────────────────────────────────────
router.put('/:id',           authenticate, updateJob);
router.post('/:id/cancel',   authenticate, cancelJob);
router.post('/:id/start',    authenticate, startJob);
router.post('/:id/complete', authenticate, completeJob);
router.post('/:id/close',    authenticate, closeJob);

module.exports = router;
