const router = require('express').Router();
const { authenticate } = require('../middleware/auth');
const wa = require('../controllers/workAgreementController');

// All routes require auth; the controller enforces party-only access
// (only the helper or customer on the agreement may act).

// Agreements
router.post('/draft', authenticate, wa.draftAgreement);
router.post('/', authenticate, wa.createAgreement);
router.get('/', authenticate, wa.listAgreements);
router.get('/:id', authenticate, wa.getAgreement);
router.post('/:id/versions', authenticate, wa.createVersion);
router.post('/:id/complete', authenticate, wa.completeAgreement);

// Signatures
router.post('/:id/sign', authenticate, wa.signAgreement);
router.get('/:id/signatures', authenticate, wa.listSignatures);

// Change orders
router.post('/:id/change-orders', authenticate, wa.proposeChangeOrder);
router.post('/:id/change-orders/:coId/approve', authenticate, wa.approveChangeOrder);
router.post('/:id/change-orders/:coId/reject', authenticate, wa.rejectChangeOrder);

// Evidence
router.post('/:id/evidence', authenticate, wa.addEvidence);
router.get('/:id/evidence', authenticate, wa.listEvidence);

// Documents
router.post('/:id/documents', authenticate, wa.addDocument);
router.get('/:id/documents', authenticate, wa.listDocuments);

// Warranty claims (recorded only; the platform never adjudicates)
router.post('/:id/warranty-claims', authenticate, wa.fileWarrantyClaim);
router.get('/:id/warranty-claims', authenticate, wa.listWarrantyClaims);
router.post('/:id/warranty-claims/:claimId/resolve', authenticate, wa.resolveWarrantyClaim);

module.exports = router;
