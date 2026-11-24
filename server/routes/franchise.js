const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { requireAdmin, requirePermission } = require('../middleware/adminAuth');
const { generalLimiter } = require('../middleware/rateLimiter');
const { requireFeatureEnabled } = require('../middleware/featureFlags');
const { requireFranchiseCapability } = require('../middleware/requireAccess');
const upload = require('../middleware/upload');
const validateFileUpload = require('../middleware/validateFileUpload');

// Audit fix: Franchise is launch-hidden. Gate the API to match the UI.
// Default on since the all-launch flip (2026-11-04); explicit
// FRANCHISE_ENABLED=false still 503s. Admin routes below stay ungated
// by design (admin auth + granular permissions).
const requireFranchiseEnabled = requireFeatureEnabled('Franchise', 'FRANCHISE_ENABLED', true);
const {
  createFranchiseApplication,
  listMyFranchiseApplications,
  listFranchiseApplications,
  getFranchiseApplication,
  updateFranchiseApplication,
  addFranchiseNote,
  updateChecklistItem,
  upsertFranchiseAgreement,
  signFranchiseAgreement,
  recordFranchiseFeeCollection,
  activateFranchiseStore,
  getMyFranchiseApplication,
  proposeInterviewSlot,
  updateInterviewSlot,
  bookInterviewSlot,
  cancelInterviewBooking,
  uploadApplicationDocument,
  reviewApplicationDocument,
  addApplicantFollowupMessage,
  addAdminFollowupMessage,
  acknowledgeResponsibilityItem,
  respondToTerritoryOffer,
  addTerritoryArea,
  removeTerritoryArea,
  addLaunchPlanStep,
  updateLaunchPlanStep,
  removeLaunchPlanStep,
  updateLaunchPlanStepStatus,
} = require('../controllers/franchiseController');

const {
  getTerritoryStats,
  getTerritoryHelpers,
} = require('../controllers/franchiseTerritoryController');

router.post('/applications', generalLimiter, requireFranchiseEnabled, createFranchiseApplication);
router.get('/my-applications',     authenticate, requireFranchiseEnabled, listMyFranchiseApplications);
// Group 12 Slice 3a: applicant detail + interview booking + document
// upload + follow-up replies, all scoped to the applicant's own application.
router.get('/my-applications/:id', authenticate, requireFranchiseEnabled, getMyFranchiseApplication);
router.post('/my-applications/:id/interviews/:slotId/book', authenticate, requireFranchiseEnabled, bookInterviewSlot);
router.post('/my-applications/:id/interviews/:slotId/cancel', authenticate, requireFranchiseEnabled, cancelInterviewBooking);
router.post('/my-applications/:id/documents', authenticate, requireFranchiseEnabled, upload.single('file'), validateFileUpload, uploadApplicationDocument);
router.post('/my-applications/:id/followup', authenticate, requireFranchiseEnabled, addApplicantFollowupMessage);
// Group 12 Slice 3b (608): the operator acknowledges one responsibility
// item on their own application.
router.post('/my-applications/:id/responsibilities/:itemId/acknowledge', authenticate, requireFranchiseEnabled, acknowledgeResponsibilityItem);
// Group 12 Slice 3b (606): the operator accepts or declines a territory
// offer on their own application.
router.post('/my-applications/:id/acceptance', authenticate, requireFranchiseEnabled, respondToTerritoryOffer);
// Group 12 Slice 3b (609): the operator updates one launch plan step's
// status on their own application.
router.post('/my-applications/:id/launch-plan/:stepId/status', authenticate, requireFranchiseEnabled, updateLaunchPlanStepStatus);
router.get('/territory-stats',     authenticate, requireFranchiseEnabled, requireFranchiseCapability, getTerritoryStats);
router.get('/territory-helpers',   authenticate, requireFranchiseEnabled, requireFranchiseCapability, getTerritoryHelpers);

router.get('/applications', authenticate, requireAdmin, requirePermission('manage_operations'), listFranchiseApplications);
router.get('/applications/:id', authenticate, requireAdmin, requirePermission('manage_operations'), getFranchiseApplication);
router.patch('/applications/:id', authenticate, requireAdmin, requirePermission('manage_operations'), updateFranchiseApplication);
router.post('/applications/:id/notes', authenticate, requireAdmin, requirePermission('manage_operations'), addFranchiseNote);
router.patch('/applications/:id/checklist/:itemId', authenticate, requireAdmin, requirePermission('manage_operations'), updateChecklistItem);
// Group 12 Slice 3a: HQ interview slots, document review, follow-up replies.
router.post('/applications/:id/interviews', authenticate, requireAdmin, requirePermission('manage_operations'), proposeInterviewSlot);
router.patch('/applications/:id/interviews/:slotId', authenticate, requireAdmin, requirePermission('manage_operations'), updateInterviewSlot);
router.patch('/applications/:id/documents/:docId', authenticate, requireAdmin, requirePermission('manage_operations'), reviewApplicationDocument);
router.post('/applications/:id/followup', authenticate, requireAdmin, requirePermission('manage_operations'), addAdminFollowupMessage);
// Group 12 Slice 3b (607): HQ manages the structured boundary area list.
router.post('/applications/:id/areas', authenticate, requireAdmin, requirePermission('manage_operations'), addTerritoryArea);
router.delete('/applications/:id/areas/:areaId', authenticate, requireAdmin, requirePermission('manage_operations'), removeTerritoryArea);
// Group 12 Slice 3b (609): HQ manages the territory launch plan steps.
router.post('/applications/:id/launch-plan', authenticate, requireAdmin, requirePermission('manage_operations'), addLaunchPlanStep);
router.patch('/applications/:id/launch-plan/:stepId', authenticate, requireAdmin, requirePermission('manage_operations'), updateLaunchPlanStep);
router.delete('/applications/:id/launch-plan/:stepId', authenticate, requireAdmin, requirePermission('manage_operations'), removeLaunchPlanStep);
router.put('/applications/:id/agreement', authenticate, requireAdmin, requirePermission('manage_operations'), upsertFranchiseAgreement);
// Review P2-9-F09: the applicant signs from their own account (admins cannot
// assert the applicant's signature). Authenticated, not admin-gated.
router.post('/applications/:id/agreement/sign', authenticate, requireFranchiseEnabled, signFranchiseAgreement);
// Review P2-9-F07: record initial-fee collection (or waiver) so activation can
// fail closed until the fee is accounted for.
router.post('/applications/:id/agreement/collect-fee', authenticate, requireAdmin, requirePermission('manage_operations'), recordFranchiseFeeCollection);
router.post('/applications/:id/activate-store', authenticate, requireAdmin, requirePermission('manage_operations'), activateFranchiseStore);

module.exports = router;
