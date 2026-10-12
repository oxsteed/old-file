const router  = require('express').Router();
const { authenticate } = require('../middleware/auth');
const requireEmailVerified = require('../middleware/requireEmailVerified');
const upload  = require('../middleware/upload');
const validateFileUpload = require('../middleware/validateFileUpload');
const { generalLimiter, jobEditLimiter } = require('../middleware/rateLimiter');
const { rejectImpersonated } = require('../middleware/rejectImpersonated');
const checkRestrictions = require('../middleware/checkRestrictions');
const { errorHandler } = require('../middleware/errorHandler');

const {
  createJob, getJobs, getJob, getPublicJob, updateJob, patchJob, getJobRevisions,
  cancelJob, assignHelper, startJob, completeJob, closeJob, getMyJobs,
} = require('../controllers/jobController');

const { getDraft, saveDraft, deleteDraft } = require('../controllers/draftController');

// ── Draft (must be before /:id) ───────────────────────────────────────────────
router.get('/draft',    authenticate, getDraft);
router.put('/draft',    authenticate, saveDraft);
router.delete('/draft', authenticate, deleteDraft);

// ── Protected specific routes ─────────────────────────────────────────────────
router.get('/me/list', authenticate, getMyJobs);
router.get('/:id/appointment', authenticate, async (req, res, next) => {
  try {
    const db = require('../db');
    const { rows } = await db.query(
      `SELECT
         id,
         COALESCE(scheduled_start_at, scheduled_date) AS start_time,
         scheduled_end_at AS end_time,
         scheduled_date,
         scheduled_time
       FROM jobs
       WHERE id = $1
         AND deleted_at IS NULL
         AND (client_id = $2 OR assigned_helper_id = $2)
       LIMIT 1`,
      [req.params.id, req.user.id]
    );
    return res.json({ data: rows[0] || null });
  } catch (err) {
    next(err);
  }
});
// checkRestrictions('job_posting') blocks customers with active job-posting restrictions
router.post('/',       authenticate, requireEmailVerified, checkRestrictions('job_posting'), upload.array('media', 10), validateFileUpload, createJob);
router.post('/assign', authenticate, assignHelper);

// ── Public ────────────────────────────────────────────────────────────────────
router.get('/',            generalLimiter, getJobs);
router.get('/public/:id',  generalLimiter, getPublicJob);
router.get('/:id',         authenticate, generalLimiter, getJob);

// ── Protected parameterized ───────────────────────────────────────────────────
// Edits: PATCH is JSON Merge Patch with a required If-Match/expected_version;
// PUT keeps the legacy partial-update contract. Impersonated sessions and
// restricted posters cannot edit. See docs/job-editing.md.
const jobEditGuards = [authenticate, rejectImpersonated, jobEditLimiter, checkRestrictions('job_posting')];
router.patch('/:id',         ...jobEditGuards, patchJob);
router.put('/:id',           ...jobEditGuards, updateJob);
router.get('/:id/revisions', authenticate, generalLimiter, getJobRevisions);
router.post('/:id/cancel',    authenticate, cancelJob);
router.post('/:id/start',    authenticate, startJob);
router.post('/:id/complete', authenticate, completeJob);
router.post('/:id/close',    authenticate, closeJob);

// Route-local JSON error handler for consistent API responses when this router
// is mounted without the global server error handler (tests, serverless, etc.).
router.use(errorHandler);

module.exports = router;
