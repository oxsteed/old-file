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
  addLocation,
  addLocationMilestone,
  updateLocationMilestone,
  removeLocationMilestone,
  updateLocationMilestoneStatus,
  assignOpeningTeamMember,
  removeOpeningTeamMember,
  assignOpeningTeamMemberAsAdmin,
  removeOpeningTeamMemberAsAdmin,
  submitReadinessReview,
  upsertLocationService,
  upsertLocationServiceAsAdmin,
  launchLocation,
  launchLocationAsAdmin,
  confirmOpening,
  createTerritoryInvitation,
  createTerritoryInvitationAsAdmin,
  cancelTerritoryInvitation,
  cancelTerritoryInvitationAsAdmin,
  respondToTerritoryInvitation,
  assignLocationManagerAsAdmin,
  removeLocationManagerAsAdmin,
  assignTraining,
  assignTrainingAsAdmin,
  completeTrainingAssignment,
  completeTrainingAssignmentAsAdmin,
  removeTrainingAssignment,
  removeTrainingAssignmentAsAdmin,
  getTerritoryCoverage,
  getTerritoryCoverageAsAdmin,
  postAnnouncementAsAdmin,
  deleteAnnouncementAsAdmin,
  markAnnouncementRead,
  curateFranchiseStandard,
  curateFranchiseStandardWide,
  listFranchiseStandardsWide,
  removeFranchiseStandard,
  removeFranchiseStandardWide,
  acknowledgeFranchiseStandard,
  publishFranchiseStandardVersion,
  publishFranchiseStandardVersionWide,
  remindFranchiseStandard,
  remindFranchiseStandardWide,
  uploadFranchiseBrandAsset,
  uploadFranchiseBrandAssetWide,
  listFranchiseBrandAssetsWide,
  deleteFranchiseBrandAsset,
  deleteFranchiseBrandAssetWide,
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
// Group 12 Slice 3c (611): the operator updates one location milestone's
// status on their own application.
router.post('/my-applications/:id/locations/:locationId/milestones/:milestoneId/status', authenticate, requireFranchiseEnabled, updateLocationMilestoneStatus);
// Group 12 Slice 3c (612): the operator designates/removes opening-team
// members on their own application.
router.post('/my-applications/:id/opening-team', authenticate, requireFranchiseEnabled, assignOpeningTeamMember);
router.delete('/my-applications/:id/opening-team/:memberId', authenticate, requireFranchiseEnabled, removeOpeningTeamMember);
// Group 12 Slice 3c (614): the operator updates a location's service
// availability checklist and launches a location on their own application.
router.post('/my-applications/:id/locations/:locationId/services', authenticate, requireFranchiseEnabled, upsertLocationService);
router.post('/my-applications/:id/locations/:locationId/launch', authenticate, requireFranchiseEnabled, launchLocation);
// Group 12 Slice 3c (615): the operator confirms a location opened on
// their own application — the record that completes the launch.
router.post('/my-applications/:id/locations/:locationId/confirm-opening', authenticate, requireFranchiseEnabled, confirmOpening);
// Group 12 Slice 3d (616): territory-scoped invitations — the operator
// invites by email, cancels an outstanding invite; the invitee answers
// by token and their account email must match the invited email.
router.post('/my-applications/:id/invitations', authenticate, requireFranchiseEnabled, createTerritoryInvitation);
router.post('/my-applications/:id/invitations/:inviteId/cancel', authenticate, requireFranchiseEnabled, cancelTerritoryInvitation);
router.post('/invitations/:token/respond', authenticate, requireFranchiseEnabled, respondToTerritoryInvitation);
// Group 12 Slice 3d (618): territory-scoped training distribution —
// the operator assigns, completes (assignee or operator), and removes.
router.post('/my-applications/:id/training', authenticate, requireFranchiseEnabled, assignTraining);
router.post('/my-applications/:id/training/:assignmentId/complete', authenticate, requireFranchiseEnabled, completeTrainingAssignment);
router.delete('/my-applications/:id/training/:assignmentId', authenticate, requireFranchiseEnabled, removeTrainingAssignment);
// Group 12 Slice 3d (619): territory coverage planning — read-only
// rollup over the linked business's staff shifts.
router.get('/my-applications/:id/coverage', authenticate, requireFranchiseEnabled, getTerritoryCoverage);
// Group 12 Slice 3d (620): the operator reads the HQ announcement feed
// and marks items read (idempotent).
router.post('/my-applications/:id/announcements/:announcementId/read', authenticate, requireFranchiseEnabled, markAnnouncementRead);
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
// Group 12 Slice 3c (611): HQ manages locations and their launch milestones.
router.post('/applications/:id/locations', authenticate, requireAdmin, requirePermission('manage_operations'), addLocation);
router.post('/applications/:id/locations/:locationId/milestones', authenticate, requireAdmin, requirePermission('manage_operations'), addLocationMilestone);
router.patch('/applications/:id/locations/:locationId/milestones/:milestoneId', authenticate, requireAdmin, requirePermission('manage_operations'), updateLocationMilestone);
router.delete('/applications/:id/locations/:locationId/milestones/:milestoneId', authenticate, requireAdmin, requirePermission('manage_operations'), removeLocationMilestone);
// Group 12 Slice 3c (612): HQ designates/removes opening-team members.
router.post('/applications/:id/opening-team', authenticate, requireAdmin, requirePermission('manage_operations'), assignOpeningTeamMemberAsAdmin);
router.delete('/applications/:id/opening-team/:memberId', authenticate, requireAdmin, requirePermission('manage_operations'), removeOpeningTeamMemberAsAdmin);
// Group 12 Slice 3c (613): HQ records a formal readiness review — the
// only path that moves readiness to `ready`.
router.post('/applications/:id/readiness-review', authenticate, requireAdmin, requirePermission('manage_operations'), submitReadinessReview);
// Group 12 Slice 3c (614): HQ updates a location's service availability
// checklist and launches a location.
router.post('/applications/:id/locations/:locationId/services', authenticate, requireAdmin, requirePermission('manage_operations'), upsertLocationServiceAsAdmin);
router.post('/applications/:id/locations/:locationId/launch', authenticate, requireAdmin, requirePermission('manage_operations'), launchLocationAsAdmin);
// Group 12 Slice 3d (616): HQ invites to the territory and cancels
// outstanding invites.
router.post('/applications/:id/invitations', authenticate, requireAdmin, requirePermission('manage_operations'), createTerritoryInvitationAsAdmin);
router.post('/applications/:id/invitations/:inviteId/cancel', authenticate, requireAdmin, requirePermission('manage_operations'), cancelTerritoryInvitationAsAdmin);
// Group 12 Slice 3d (617): HQ assigns and removes a location manager
// (HQ-only; the operator sees the manager on the location).
router.post('/applications/:id/locations/:locationId/manager', authenticate, requireAdmin, requirePermission('manage_operations'), assignLocationManagerAsAdmin);
router.delete('/applications/:id/locations/:locationId/manager', authenticate, requireAdmin, requirePermission('manage_operations'), removeLocationManagerAsAdmin);
// Group 12 Slice 3d (618): HQ assigns, completes, and removes training.
router.post('/applications/:id/training', authenticate, requireAdmin, requirePermission('manage_operations'), assignTrainingAsAdmin);
router.post('/applications/:id/training/:assignmentId/complete', authenticate, requireAdmin, requirePermission('manage_operations'), completeTrainingAssignmentAsAdmin);
router.delete('/applications/:id/training/:assignmentId', authenticate, requireAdmin, requirePermission('manage_operations'), removeTrainingAssignmentAsAdmin);
// Group 12 Slice 3d (619): HQ reads the territory coverage rollup.
router.get('/applications/:id/coverage', authenticate, requireAdmin, requirePermission('manage_operations'), getTerritoryCoverageAsAdmin);
// Group 12 Slice 3d (620): HQ posts and removes territory announcements.
router.post('/applications/:id/announcements', authenticate, requireAdmin, requirePermission('manage_operations'), postAnnouncementAsAdmin);
router.delete('/applications/:id/announcements/:announcementId', authenticate, requireAdmin, requirePermission('manage_operations'), deleteAnnouncementAsAdmin);
// Group 12 Slice 3e (622): a territory member acknowledges a standard's
// current version with a drawn e-signature (multipart PNG, SOP pattern).
router.post('/my-applications/:id/standards/:standardId/acknowledge', authenticate, requireFranchiseEnabled, upload.single('signature'), validateFileUpload, acknowledgeFranchiseStandard);
// Group 12 Slice 3e (621): HQ curates the franchise standards library —
// Learn guides as franchise-wide or per-territory standards.
router.get('/standards', authenticate, requireAdmin, requirePermission('manage_operations'), listFranchiseStandardsWide);
router.post('/standards', authenticate, requireAdmin, requirePermission('manage_operations'), curateFranchiseStandardWide);
router.delete('/standards/:standardId', authenticate, requireAdmin, requirePermission('manage_operations'), removeFranchiseStandardWide);
router.post('/applications/:id/standards', authenticate, requireAdmin, requirePermission('manage_operations'), curateFranchiseStandard);
router.delete('/applications/:id/standards/:standardId', authenticate, requireAdmin, requirePermission('manage_operations'), removeFranchiseStandard);
// Group 12 Slice 3e (622): HQ publishes a new version of a standard —
// the policy-change event 622 acknowledges and 625 reminds about.
router.post('/applications/:id/standards/:standardId/version', authenticate, requireAdmin, requirePermission('manage_operations'), publishFranchiseStandardVersion);
router.post('/standards/:standardId/version', authenticate, requireAdmin, requirePermission('manage_operations'), publishFranchiseStandardVersionWide);
// Group 12 Slice 3e (625): HQ manually re-sends the policy change
// reminder for one standard, now — an explicit HQ action that bypasses
// the daily 24h dedupe.
router.post('/applications/:id/standards/:standardId/remind', authenticate, requireAdmin, requirePermission('manage_operations'), remindFranchiseStandard);
router.post('/standards/:standardId/remind', authenticate, requireAdmin, requirePermission('manage_operations'), remindFranchiseStandardWide);
// Group 12 Slice 3e (623): HQ uploads and removes brand assets —
// per territory or franchise-wide — through the vault upload path.
router.get('/brand-assets', authenticate, requireAdmin, requirePermission('manage_operations'), listFranchiseBrandAssetsWide);
router.post('/brand-assets', authenticate, requireAdmin, requirePermission('manage_operations'), upload.single('file'), validateFileUpload, uploadFranchiseBrandAssetWide);
router.delete('/brand-assets/:assetId', authenticate, requireAdmin, requirePermission('manage_operations'), deleteFranchiseBrandAssetWide);
router.post('/applications/:id/brand-assets', authenticate, requireAdmin, requirePermission('manage_operations'), upload.single('file'), validateFileUpload, uploadFranchiseBrandAsset);
router.delete('/applications/:id/brand-assets/:assetId', authenticate, requireAdmin, requirePermission('manage_operations'), deleteFranchiseBrandAsset);
router.put('/applications/:id/agreement', authenticate, requireAdmin, requirePermission('manage_operations'), upsertFranchiseAgreement);
// Review P2-9-F09: the applicant signs from their own account (admins cannot
// assert the applicant's signature). Authenticated, not admin-gated.
router.post('/applications/:id/agreement/sign', authenticate, requireFranchiseEnabled, signFranchiseAgreement);
// Review P2-9-F07: record initial-fee collection (or waiver) so activation can
// fail closed until the fee is accounted for.
router.post('/applications/:id/agreement/collect-fee', authenticate, requireAdmin, requirePermission('manage_operations'), recordFranchiseFeeCollection);
router.post('/applications/:id/activate-store', authenticate, requireAdmin, requirePermission('manage_operations'), activateFranchiseStore);

module.exports = router;
