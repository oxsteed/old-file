const { rejectImpersonated } = require('../middleware/rejectImpersonated');
const router = require('express').Router();
const { authenticate } = require('../middleware/auth');
const wa = require('../controllers/workAgreementController');
const upload = require('../middleware/upload');
const validateFileUpload = require('../middleware/validateFileUpload');
const { userUploadLimiter } = require('../middleware/rateLimiter');
const { requireHelperCapability } = require('../middleware/requireAccess');
const pool = require('../db');

async function requireAgreementHelperCapability(req, res, next) {
  try {
    let query = null;
    let value = null;
    if (req.params?.id) {
      query = 'SELECT helper_id FROM work_agreements WHERE id = $1';
      value = req.params.id;
    } else if (req.body?.jobId || req.body?.job_id) {
      query = 'SELECT assigned_helper_id AS helper_id FROM jobs WHERE id = $1';
      value = req.body.jobId || req.body.job_id;
    }
    if (!query) return next();
    const { rows } = await pool.query(query, [value]);
    if (rows[0] && String(rows[0].helper_id) === String(req.user?.id)) {
      return requireHelperCapability(req, res, next);
    }
    return next();
  } catch (err) {
    return next(err);
  }
}

// All routes require auth; the controller enforces party-only access
// (only the helper or customer on the agreement may act).

// Agreements
router.post('/draft', authenticate, requireAgreementHelperCapability, wa.draftAgreement);
router.get('/by-job/:jobId', authenticate, wa.getByJob);
router.post('/', authenticate, requireAgreementHelperCapability, wa.createAgreement);
router.get('/', authenticate, wa.listAgreements);
router.get('/:id', authenticate, wa.getAgreement);
router.post('/:id/versions', authenticate, requireAgreementHelperCapability, wa.createVersion);
router.post('/:id/complete', authenticate, requireAgreementHelperCapability, wa.completeAgreement);

// Signatures
router.post('/:id/sign', authenticate, requireAgreementHelperCapability, wa.signAgreement);
router.get('/:id/signatures', authenticate, wa.listSignatures);

// Change orders
router.post('/:id/change-orders', authenticate, requireAgreementHelperCapability, wa.proposeChangeOrder);
// Approval moves money (job price, card capture, Credit collateral): no impersonation.
router.post('/:id/change-orders/:coId/approve', authenticate, requireAgreementHelperCapability, rejectImpersonated, wa.approveChangeOrder);
router.post('/:id/change-orders/:coId/reject', authenticate, requireAgreementHelperCapability, rejectImpersonated, wa.rejectChangeOrder);

// Evidence
router.post('/:id/evidence', authenticate, requireAgreementHelperCapability, userUploadLimiter, upload.single('file'), validateFileUpload, wa.addEvidence);
router.get('/:id/evidence', authenticate, wa.listEvidence);

// Documents
router.post('/:id/documents', authenticate, requireAgreementHelperCapability, userUploadLimiter, upload.single('file'), validateFileUpload, wa.addDocument);
router.get('/:id/documents', authenticate, wa.listDocuments);

// Warranty claims (recorded only; the platform never adjudicates)
router.post('/:id/warranty-claims', authenticate, requireAgreementHelperCapability, wa.fileWarrantyClaim);
router.get('/:id/warranty-claims', authenticate, wa.listWarrantyClaims);
router.post('/:id/warranty-claims/:claimId/resolve', authenticate, requireAgreementHelperCapability, wa.resolveWarrantyClaim);

module.exports = router;
