const router      = require('express').Router();
const { authenticate } = require('../middleware/auth');
const { requireAdmin, requirePermission } = require('../middleware/adminAuth');
const { rejectImpersonated } = require('../middleware/rejectImpersonated');
const disputeCtrl = require('../controllers/disputeController');
const adminDisputeCtrl = require('../controllers/disputeAdminController');
const upload      = require('../middleware/upload');
const validateFileUpload = require('../middleware/validateFileUpload');
const { requireHelperCapability } = require('../middleware/requireAccess');
const db = require('../db');

async function requireDisputeHelperCapability(req, res, next) {
  try {
    const jobId = req.params?.jobId || req.body?.jobId || req.body?.job_id;
    const disputeId = req.params?.disputeId;
    const query = jobId
      ? 'SELECT assigned_helper_id FROM jobs WHERE id = $1'
      : disputeId
        ? `SELECT j.assigned_helper_id
             FROM disputes d JOIN jobs j ON j.id = d.job_id
            WHERE d.id = $1`
        : null;
    const value = jobId || disputeId;
    if (!query || !value) return next();
    const { rows } = await db.query(query, [value]);
    if (rows[0] && String(rows[0].assigned_helper_id) === String(req.user?.id)) {
      return requireHelperCapability(req, res, next);
    }
    return next();
  } catch (err) {
    return next(err);
  }
}

// User: open and manage own disputes
router.post('/',
  authenticate,
  requireDisputeHelperCapability,
  (req, res, next) => {
    req.params.jobId = req.body.jobId || req.body.job_id;
    return disputeCtrl.openDispute(req, res, next);
  }
);

router.post('/jobs/:jobId',
  authenticate,
  requireDisputeHelperCapability,
  disputeCtrl.openDispute
);

router.get('/my',
  authenticate,
  disputeCtrl.getMyDisputes
);

// Admin routes must precede the generic /:disputeId route. Express matches
// routes in declaration order, so leaving these below /:disputeId would make
// /admin/all look like a customer request for disputeId="admin".
router.get('/admin/all',
  authenticate,
  requireAdmin, requirePermission('manage_disputes'),
  adminDisputeCtrl.getAllDisputes
);

router.post('/admin/:disputeId/review',
  authenticate,
  requireAdmin, requirePermission('manage_disputes'),
  adminDisputeCtrl.startReview
);

// P3-2-F20: path back from under_review to open.
router.post('/admin/:disputeId/reopen',
  authenticate,
  requireAdmin, requirePermission('manage_disputes'),
  adminDisputeCtrl.reopenDispute
);

// ADM-040: resolving with a refund moves money via Stripe; impersonated
// sessions are blocked.
router.post('/admin/:disputeId/resolve',
  authenticate,
  requireAdmin,
  rejectImpersonated,
  requirePermission('issue_refunds'),
  adminDisputeCtrl.resolveDispute
);

router.get('/:disputeId',
  authenticate,
  disputeCtrl.getDispute
);

router.post('/:disputeId/evidence',
  authenticate,
  requireDisputeHelperCapability,
  upload.array('files', 5),
  validateFileUpload,
  disputeCtrl.submitEvidence
);

router.post('/:disputeId/messages',
  authenticate,
  requireDisputeHelperCapability,
  disputeCtrl.sendDisputeMessage
);

module.exports = router;
