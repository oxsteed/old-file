const router  = require('express').Router();
const { authenticate } = require('../middleware/auth');
const requireEmailVerified = require('../middleware/requireEmailVerified');
const requireTermsAcceptance = require('../middleware/requireTermsAcceptance');
const upload  = require('../middleware/upload');
const validateFileUpload = require('../middleware/validateFileUpload');
const { generalLimiter, jobEditLimiter, paymentsLimiter } = require('../middleware/rateLimiter');
const { requireFeatureEnabled } = require('../middleware/featureFlags');
const {
  getPaymentReauthorization,
  startPaymentReauthorization,
  confirmPaymentReauthorization,
} = require('../controllers/jobPaymentReauthorizationController');
const { rejectImpersonated } = require('../middleware/rejectImpersonated');
const checkRestrictions = require('../middleware/checkRestrictions');
const { errorHandler } = require('../middleware/errorHandler');

const {
  createJob, getJobs, getJob, getPublicJob, updateJob, patchJob, getJobRevisions,
  cancelJob, assignHelper, startJob, markJobArrived, markJobNoShow, requestJobChanges,
  completeJob, closeJob, getMyJobs, confirmJobAttendance,
} = require('../controllers/jobController');
const {
  raiseJobException, getJobExceptions, updateJobException,
} = require('../controllers/jobExceptionController');

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
// Review P2-7-F08: server-side terms gate (was client-side only).
router.post('/',       authenticate, requireEmailVerified, requireTermsAcceptance, checkRestrictions('job_posting'), upload.array('media', 10), validateFileUpload, createJob);
router.post('/assign', authenticate, rejectImpersonated, assignHelper);

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
// Change-order re-authorization (customer funds a price increase).
// See services/jobPaymentReauthorizationService.js.
const requirePaymentsEnabled = requireFeatureEnabled('Payments', 'FEATURE_PAYMENTS_ENABLED');
// OxSteed Credit collateral is not a Stripe payment, so only card steps need the payments flag.
const requireCardPaymentsEnabled = (req, res, next) => (req.body?.method === 'credit' ? next() : requirePaymentsEnabled(req, res, next));
// Review P2-7-F07: reauthorization starts a new payment authorization;
// honor admin checkout restrictions there too.
const reauthGuards = [authenticate, rejectImpersonated, checkRestrictions('checkout'), paymentsLimiter];
router.get('/:id/payment-reauthorization', authenticate, generalLimiter, getPaymentReauthorization);
router.post('/:id/payment-reauthorization', ...reauthGuards, requireCardPaymentsEnabled, startPaymentReauthorization);
router.post('/:id/payment-reauthorization/:attemptId/confirm', ...reauthGuards, requirePaymentsEnabled, confirmPaymentReauthorization);
// G1-B8: the job owner files a refund request and reads its status. The
// request always queues in the Money Approvals queue (job_refund,
// forceQueue); the requester can never approve or execute it.
const customerRefundRequests = require('../controllers/customerRefundRequestController');
router.post('/:id/refund-request', authenticate, rejectImpersonated, paymentsLimiter, customerRefundRequests.requestRefund);
router.get('/:id/refund-requests', authenticate, generalLimiter, customerRefundRequests.listRefundRequests);
router.post('/:id/cancel',    authenticate, cancelJob);
router.post('/:id/start',    authenticate, startJob);
// G-15: helper marks arrival (customer notified); either party marks a no-show.
// Group 4 rest (181): job-level reschedule proposals (jobs without an appointment).
const jobReschedule = require('../services/jobRescheduleService');
router.get('/:id/reschedule-proposals', authenticate, generalLimiter, async (req, res, next) => { try { res.json({ proposals: await jobReschedule.list(req.user.id, req.params.id) }); } catch (e) { next(e); } });
router.post('/:id/reschedule-proposals', authenticate, rejectImpersonated, jobEditLimiter, async (req, res, next) => { try { res.status(201).json({ proposal: await jobReschedule.propose(req.user.id, req.params.id, req.body) }); } catch (e) { next(e); } });
router.post('/:id/reschedule-proposals/:proposalId/respond', authenticate, rejectImpersonated, jobEditLimiter, async (req, res, next) => { try { res.json({ proposal: await jobReschedule.respond(req.user.id, req.params.id, req.params.proposalId, req.body) }); } catch (e) { next(e); } });
const jobChangeRequests = require('../services/jobChangeRequestService');
// Group 4 rest item 183: change requests for hired jobs without a work agreement.
router.get('/:id/change-requests', authenticate, async (req, res, next) => { try { res.json({ changeRequests: await jobChangeRequests.list(req.user.id, req.params.id) }); } catch (e) { next(e); } });
router.post('/:id/change-requests', authenticate, rejectImpersonated, jobEditLimiter, async (req, res, next) => { try { res.status(201).json({ changeRequest: await jobChangeRequests.propose(req.user.id, req.params.id, req.body) }); } catch (e) { next(e); } });
router.post('/:id/change-requests/:requestId/respond', authenticate, rejectImpersonated, jobEditLimiter, async (req, res, next) => { try { res.json({ changeRequest: await jobChangeRequests.respond(req.user.id, req.params.id, req.params.requestId, req.body) }); } catch (e) { next(e); } });
const jobHandback = require('../services/jobHandbackService');
// Group 4 rest item 184: the assigned helper hands a hired job back before it starts.
router.post('/:id/hand-back', authenticate, rejectImpersonated, jobEditLimiter, async (req, res, next) => { try { res.json({ handback: await jobHandback.handBack(req.user.id, req.params.id, req.body) }); } catch (e) { next(e); } });
router.post('/:id/arrive',   authenticate, markJobArrived);
router.post('/:id/attendance', authenticate, confirmJobAttendance);
// G5-5 (265): job exceptions, participant-scoped and manager-routed.
router.get('/:id/exceptions', authenticate, getJobExceptions);
router.post('/:id/exceptions', authenticate, raiseJobException);
router.patch('/:id/exceptions/:exceptionId', authenticate, updateJobException);
router.post('/:id/no-show',  authenticate, markJobNoShow);
// G-16: customer asks for changes on a completion request (rework, not a dispute).
router.post('/:id/request-changes', authenticate, requestJobChanges);
router.post('/:id/complete', authenticate, completeJob);
router.post('/:id/close',    authenticate, closeJob);

// Route-local JSON error handler for consistent API responses when this router
// is mounted without the global server error handler (tests, serverless, etc.).
router.use(errorHandler);

module.exports = router;
