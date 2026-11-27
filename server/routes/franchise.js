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
  listApplicationActivity,
  getDocumentDownloadUrl,
  getBrandAssetDownloadUrl,
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
  getTerritoryInvitationByToken,
  assignLocationManagerAsAdmin,
  removeLocationManagerAsAdmin,
  assignTraining,
  assignTrainingAsAdmin,
  listTrainingModules,
  listTrainingModulesAsAdmin,
  completeTrainingAssignment,
  completeTrainingAssignmentAsAdmin,
  removeTrainingAssignment,
  removeTrainingAssignmentAsAdmin,
  getTerritoryCoverage,
  getTerritoryCoverageAsAdmin,
  getExceptionSummary,
  getExceptionSummaryAsAdmin,
  getLocationHealth,
  getLocationHealthAsAdmin,
  listTerritoryTickets,
  listTerritoryTicketsAsAdmin,
  createPolicyQuestion,
  listPolicyQuestions,
  listPolicyQuestionsAsAdmin,
  publishOpsSlotAsAdmin,
  bookOpsSlot,
  cancelOpsBooking,
  confirmOpsSlotAsAdmin,
  completeOpsSlotAsAdmin,
  cancelOpsSlotAsAdmin,
  listOpsAppointments,
  listOpsAppointmentsAsAdmin,
  escalateTraining,
  escalateTrainingAsAdmin,
  listTrainingEscalations,
  listTrainingEscalationsAsAdmin,
  resolveTrainingEscalationAsAdmin,
  listTerritoryCases,
  listTerritoryCasesAsAdmin,
  getSupportHistory,
  getSupportHistoryAsAdmin,
  getCoverageTrend,
  getCoverageTrendAsAdmin,
  linkTicketToTerritory,
  linkTicketToTerritoryAsAdmin,
  unlinkTicketFromTerritory,
  unlinkTicketFromTerritoryAsAdmin,
  escalateTicket,
  escalateTicketAsAdmin,
  listEscalations,
  listEscalationsAsAdmin,
  setRemediation,
  setRemediationAsAdmin,
  listRemediations,
  listRemediationsAsAdmin,
  listMyRemediations,
  createCorrectiveAction,
  createCorrectiveActionAsAdmin,
  listCorrectiveActions,
  listCorrectiveActionsAsAdmin,
  updateCorrectiveActionStatus,
  updateCorrectiveActionStatusAsAdmin,
  uploadActionEvidence,
  uploadActionEvidenceAsAdmin,
  listActionEvidence,
  listActionEvidenceAsAdmin,
  reviewCorrectiveActionAsAdmin,
  getExceptionResolution,
  getExceptionResolutionAsAdmin,
  createCandidateLocation,
  createCandidateLocationAsAdmin,
  getCandidateLocations,
  getCandidateLocationsAsAdmin,
  updateCandidateLocation,
  updateCandidateLocationAsAdmin,
  deleteCandidateLocation,
  deleteCandidateLocationAsAdmin,
  getTerritoryCapacity,
  getTerritoryCapacityAsAdmin,
  setCapacityTargetAsAdmin,
  getTrainingPlanner,
  getTrainingPlannerAsAdmin,
  getLaunchDependencies,
  getLaunchDependenciesAsAdmin,
  createExpansionNote,
  getExpansionNotes,
  getExpansionNotesAsAdmin,
  updateExpansionNote,
  deleteExpansionNote,
  listMyHandoffs,
  createHandoff,
  getHandoffs,
  getHandoffsAsAdmin,
  getHandoff,
  getHandoffAsAdmin,
  cancelHandoff,
  cancelHandoffAsAdmin,
  reviewHandoffAsAdmin,
  listHandoffTransfers,
  listHandoffTransfersAsAdmin,
  createContactDirectoryEntry,
  getContactDirectory,
  getContactDirectoryAsAdmin,
  updateContactDirectoryEntry,
  deleteContactDirectoryEntry,
  removeTerritoryAccessAsAdmin,
  listAccessRemovalsAsAdmin,
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

router.post('/applications', authenticate, generalLimiter, requireFranchiseEnabled, createFranchiseApplication);
router.get('/my-applications',     authenticate, requireFranchiseEnabled, listMyFranchiseApplications);
// Group 12 Slice 3a: applicant detail + interview booking + document
// upload + follow-up replies, all scoped to the applicant's own application.
router.get('/my-applications/:id', authenticate, requireFranchiseEnabled, getMyFranchiseApplication);
router.get('/my-applications/:id/activity', authenticate, requireFranchiseEnabled, listApplicationActivity);
router.get('/my-applications/:id/documents/:docId/download-url', authenticate, requireFranchiseEnabled, (req, res) => getDocumentDownloadUrl(req, res));
router.get('/my-applications/:id/brand-assets/:assetId/download-url', authenticate, requireFranchiseEnabled, (req, res) => getBrandAssetDownloadUrl(req, res));
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
// G12-A1 (D-640): the accept page loads the invite by token — public,
// token-gated, the same pattern as the booking status page.
router.get('/invitations/:token', getTerritoryInvitationByToken);
// Group 12 Slice 3d (618): territory-scoped training distribution —
// the operator assigns, completes (assignee or operator), and removes.
router.post('/my-applications/:id/training', authenticate, requireFranchiseEnabled, assignTraining);
router.post('/my-applications/:id/training/:assignmentId/complete', authenticate, requireFranchiseEnabled, completeTrainingAssignment);
router.delete('/my-applications/:id/training/:assignmentId', authenticate, requireFranchiseEnabled, removeTrainingAssignment);
// G12-A5 (D-649): the catalogue behind the assign form — active
// modules of the linked business's restaurants.
router.get('/my-applications/:id/training-modules', authenticate, requireFranchiseEnabled, listTrainingModules);
// Group 12 Slice 3d (619): territory coverage planning — read-only
// rollup over the linked business's staff shifts.
router.get('/my-applications/:id/coverage', authenticate, requireFranchiseEnabled, getTerritoryCoverage);
// Group 12 Slice 3f (628): the service exception summary — the
// territory's support tickets aggregated (D-327) — and the link/unlink
// endpoints that attach a ticket to the territory.
router.get('/my-applications/:id/exceptions', authenticate, requireFranchiseEnabled, getExceptionSummary);
// Group 12 Slice 3f (627): the per-location health view — status, KPIs,
// and compliance per location inside the territory (D-328).
router.get('/my-applications/:id/location-health', authenticate, requireFranchiseEnabled, getLocationHealth);
// Group 12 Slice 3f (629): the territory ticket queue — the territory's
// open support requests, filterable by status and location (D-329).
router.get('/my-applications/:id/support-tickets', authenticate, requireFranchiseEnabled, listTerritoryTickets);
// Group 12 Slice 3f (630): the territory coverage trend — coverage %
// by day and by week over time, from the linked business's shifts (D-330).
router.get('/my-applications/:id/coverage-trend', authenticate, requireFranchiseEnabled, getCoverageTrend);
// Group 12 Slice 3j (650): the franchise support history — the full
// chronological history of the territory's support interactions,
// derived from the existing records, readable by the operator and HQ.
router.get('/my-applications/:id/support-history', authenticate, requireFranchiseEnabled, getSupportHistory);
// Group 12 Slice 3j (649): the territory case tracker — the
// territory's cases (tickets, policy questions, training escalations,
// handoffs) in one view, filterable by status, type, and location.
router.get('/my-applications/:id/cases', authenticate, requireFranchiseEnabled, listTerritoryCases);
// Group 12 Slice 3j (648): training escalation — the operator (or HQ)
// escalates a training issue/gap to HQ with the training context
// attached; one live escalation per training item.
router.post('/my-applications/:id/training-escalations', authenticate, requireFranchiseEnabled, escalateTraining);
router.get('/my-applications/:id/training-escalations', authenticate, requireFranchiseEnabled, listTrainingEscalations);
// Group 12 Slice 3j (647): dedicated HQ operations appointments — the
// operator books a published slot for their territory; HQ confirms or
// cancels; never the consulting flow (D-300).
router.get('/my-applications/:id/ops-appointments', authenticate, requireFranchiseEnabled, listOpsAppointments);
router.post('/my-applications/:id/ops-appointments/:slotId/book', authenticate, requireFranchiseEnabled, bookOpsSlot);
router.post('/my-applications/:id/ops-appointments/:slotId/cancel', authenticate, requireFranchiseEnabled, cancelOpsBooking);
// Group 12 Slice 3j (646): franchise-scoped policy questions — the
// operator asks a policy question tied to the territory (and optionally
// a standard); HQ answers in-thread on the ticket. A policy question IS
// a ticket with category 'policy_question', never a parallel inbox.
router.post('/my-applications/:id/policy-questions', authenticate, requireFranchiseEnabled, createPolicyQuestion);
router.get('/my-applications/:id/policy-questions', authenticate, requireFranchiseEnabled, listPolicyQuestions);
router.post('/my-applications/:id/support-tickets/:ticketId/link', authenticate, requireFranchiseEnabled, linkTicketToTerritory);
router.post('/my-applications/:id/support-tickets/:ticketId/unlink', authenticate, requireFranchiseEnabled, unlinkTicketFromTerritory);
// Group 12 Slice 3g (631): territory-scoped escalation — the operator
// escalates a linked exception with a reason; HQ sees the queue.
router.post('/my-applications/:id/support-tickets/:ticketId/escalate', authenticate, requireFranchiseEnabled, escalateTicket);
router.get('/my-applications/:id/escalations', authenticate, requireFranchiseEnabled, listEscalations);
// Group 12 Slice 3g (632): franchise remediation assignment — the
// operator assigns a territory member as the remediation owner for a
// linked exception, with a due date; the owner sees their assignments.
router.post('/my-applications/:id/support-tickets/:ticketId/remediation', authenticate, requireFranchiseEnabled, setRemediation);
router.get('/my-applications/:id/remediations', authenticate, requireFranchiseEnabled, listRemediations);
router.get('/my-remediations', authenticate, requireFranchiseEnabled, listMyRemediations);
// Group 12 Slice 3g (633): franchise corrective-action checklist —
// create/list/update per linked exception, open -> in_progress ->
// resolved -> verified, server-enforced.
router.post('/my-applications/:id/support-tickets/:ticketId/corrective-actions', authenticate, requireFranchiseEnabled, createCorrectiveAction);
router.get('/my-applications/:id/support-tickets/:ticketId/corrective-actions', authenticate, requireFranchiseEnabled, listCorrectiveActions);
router.get('/my-applications/:id/corrective-actions', authenticate, requireFranchiseEnabled, listCorrectiveActions);
router.post('/my-applications/:id/corrective-actions/:actionId/status', authenticate, requireFranchiseEnabled, updateCorrectiveActionStatus);
// Group 12 Slice 3g (634): evidence submission — file evidence attached
// to a corrective action through the vault upload path.
router.post('/my-applications/:id/corrective-actions/:actionId/evidence', authenticate, requireFranchiseEnabled, upload.single('file'), validateFileUpload, uploadActionEvidence);
router.get('/my-applications/:id/corrective-actions/:actionId/evidence', authenticate, requireFranchiseEnabled, listActionEvidence);
// Group 12 Slice 3g (635): resolution review — the per-exception
// resolution state, derived from ticket + corrective-action state.
router.get('/my-applications/:id/resolution', authenticate, requireFranchiseEnabled, getExceptionResolution);
// Group 12 Slice 3h (640): expansion readiness notes — the operator
// records readiness notes per territory or location; HQ reads them
// alongside its own admin fields.
router.get('/my-applications/:id/expansion-notes', authenticate, requireFranchiseEnabled, getExpansionNotes);
router.post('/my-applications/:id/expansion-notes', authenticate, requireFranchiseEnabled, createExpansionNote);
router.patch('/my-applications/:id/expansion-notes/:noteId', authenticate, requireFranchiseEnabled, updateExpansionNote);
router.delete('/my-applications/:id/expansion-notes/:noteId', authenticate, requireFranchiseEnabled, deleteExpansionNote);
// Group 12 Slice 3h (639): the launch dependency overview — per-location
// dependencies with blocked/blocking status, derived from existing state.
router.get('/my-applications/:id/launch-dependencies', authenticate, requireFranchiseEnabled, getLaunchDependencies);
// Group 12 Slice 3h (638): the training resource planner — who needs
// what training by when, derived from assignments, roster, and Learn.
router.get('/my-applications/:id/training-planner', authenticate, requireFranchiseEnabled, getTrainingPlanner);
// Group 12 Slice 3h (637): the territory capacity view — a structured
// per-area capacity view (no map), derived from territory data.
router.get('/my-applications/:id/capacity', authenticate, requireFranchiseEnabled, getTerritoryCapacity);
// Group 12 Slice 3h (636): the candidate location tracker — the
// operator proposes locations inside the territory, HQ reviews them.
router.get('/my-applications/:id/candidate-locations', authenticate, requireFranchiseEnabled, getCandidateLocations);
router.post('/my-applications/:id/candidate-locations', authenticate, requireFranchiseEnabled, createCandidateLocation);
router.patch('/my-applications/:id/candidate-locations/:candidateId', authenticate, requireFranchiseEnabled, updateCandidateLocation);
router.delete('/my-applications/:id/candidate-locations/:candidateId', authenticate, requireFranchiseEnabled, deleteCandidateLocation);
// Group 12 Slice 3i (641-645): operator transition — one handoff flow.
// The outgoing operator initiates (641); HQ approves or rejects; only
// approval transfers open issues (642) and records (644) and revokes the
// outgoing operator's access (645). The contact directory (643) is
// operator-maintained; HQ reads the same directory.
router.get('/my-handoffs', authenticate, requireFranchiseEnabled, listMyHandoffs);
router.post('/my-applications/:id/handoffs', authenticate, requireFranchiseEnabled, createHandoff);
router.get('/my-applications/:id/handoffs', authenticate, requireFranchiseEnabled, getHandoffs);
router.get('/my-applications/:id/handoffs/:handoffId', authenticate, requireFranchiseEnabled, getHandoff);
router.post('/my-applications/:id/handoffs/:handoffId/cancel', authenticate, requireFranchiseEnabled, cancelHandoff);
router.get('/my-applications/:id/handoffs/:handoffId/transfers', authenticate, requireFranchiseEnabled, listHandoffTransfers);
router.get('/my-applications/:id/contact-directory', authenticate, requireFranchiseEnabled, getContactDirectory);
router.post('/my-applications/:id/contact-directory', authenticate, requireFranchiseEnabled, createContactDirectoryEntry);
router.patch('/my-applications/:id/contact-directory/:entryId', authenticate, requireFranchiseEnabled, updateContactDirectoryEntry);
router.delete('/my-applications/:id/contact-directory/:entryId', authenticate, requireFranchiseEnabled, deleteContactDirectoryEntry);
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
// G12-A11 (D-656): HQ's on-click document download mint, matching the
// operator endpoint — the bundle's read-time URL is 600s and stale.
router.get('/applications/:id/documents/:docId/download-url', authenticate, requireAdmin, requirePermission('manage_operations'), (req, res) => getDocumentDownloadUrl(req, res, { asAdmin: true }));
router.get('/applications/:id/brand-assets/:assetId/download-url', authenticate, requireAdmin, requirePermission('manage_operations'), (req, res) => getBrandAssetDownloadUrl(req, res, { asAdmin: true }));
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
router.get('/applications/:id/training-modules', authenticate, requireAdmin, requirePermission('manage_operations'), listTrainingModulesAsAdmin);
// Group 12 Slice 3d (619): HQ reads the territory coverage rollup.
router.get('/applications/:id/coverage', authenticate, requireAdmin, requirePermission('manage_operations'), getTerritoryCoverageAsAdmin);
// Group 12 Slice 3f (628): HQ reads the exception summary and links or
// unlinks any ticket to the territory.
router.get('/applications/:id/exceptions', authenticate, requireAdmin, requirePermission('manage_operations'), getExceptionSummaryAsAdmin);
// Group 12 Slice 3f (627): HQ reads the per-location health view.
router.get('/applications/:id/location-health', authenticate, requireAdmin, requirePermission('manage_operations'), getLocationHealthAsAdmin);
// Group 12 Slice 3f (629): HQ reads the per-territory ticket queue.
// Group 12 Slice 3j (650): HQ reads the per-territory support history.
router.get('/applications/:id/support-history', authenticate, requireAdmin, requirePermission('manage_operations'), getSupportHistoryAsAdmin);
// Group 12 Slice 3j (649): HQ reads the per-territory case tracker.
router.get('/applications/:id/cases', authenticate, requireAdmin, requirePermission('manage_operations'), listTerritoryCasesAsAdmin);
// Group 12 Slice 3j (648): HQ reads the per-territory training
// escalation queue, escalates a gap itself, and resolves escalations.
router.get('/applications/:id/training-escalations', authenticate, requireAdmin, requirePermission('manage_operations'), listTrainingEscalationsAsAdmin);
router.post('/applications/:id/training-escalations', authenticate, requireAdmin, requirePermission('manage_operations'), escalateTrainingAsAdmin);
router.post('/applications/:id/training-escalations/:escalationId/resolve', authenticate, requireAdmin, requirePermission('manage_operations'), resolveTrainingEscalationAsAdmin);
// Group 12 Slice 3j (647): HQ publishes dedicated operations slots
// and moves them through confirm/complete/cancel.
router.get('/applications/:id/ops-appointments', authenticate, requireAdmin, requirePermission('manage_operations'), listOpsAppointmentsAsAdmin);
router.post('/applications/:id/ops-appointments', authenticate, requireAdmin, requirePermission('manage_operations'), publishOpsSlotAsAdmin);
router.post('/applications/:id/ops-appointments/:slotId/confirm', authenticate, requireAdmin, requirePermission('manage_operations'), confirmOpsSlotAsAdmin);
router.post('/applications/:id/ops-appointments/:slotId/complete', authenticate, requireAdmin, requirePermission('manage_operations'), completeOpsSlotAsAdmin);
router.post('/applications/:id/ops-appointments/:slotId/cancel', authenticate, requireAdmin, requirePermission('manage_operations'), cancelOpsSlotAsAdmin);
// Group 12 Slice 3j (646): HQ reads the per-territory policy-question
// queue — the same list the operator sees — and answers in-thread.
router.get('/applications/:id/policy-questions', authenticate, requireAdmin, requirePermission('manage_operations'), listPolicyQuestionsAsAdmin);
router.get('/applications/:id/support-tickets', authenticate, requireAdmin, requirePermission('manage_operations'), listTerritoryTicketsAsAdmin);
// Group 12 Slice 3f (630): HQ reads the territory coverage trend.
router.get('/applications/:id/coverage-trend', authenticate, requireAdmin, requirePermission('manage_operations'), getCoverageTrendAsAdmin);
router.post('/applications/:id/support-tickets/:ticketId/link', authenticate, requireAdmin, requirePermission('manage_operations'), linkTicketToTerritoryAsAdmin);
router.post('/applications/:id/support-tickets/:ticketId/unlink', authenticate, requireAdmin, requirePermission('manage_operations'), unlinkTicketFromTerritoryAsAdmin);
// Group 12 Slice 3g (631): HQ escalates a linked exception and reads the
// per-territory escalation queue.
router.post('/applications/:id/support-tickets/:ticketId/escalate', authenticate, requireAdmin, requirePermission('manage_operations'), escalateTicketAsAdmin);
router.get('/applications/:id/escalations', authenticate, requireAdmin, requirePermission('manage_operations'), listEscalationsAsAdmin);
// Group 12 Slice 3g (632): HQ assigns the remediation owner for a linked
// exception and reads the territory's remediations.
router.post('/applications/:id/support-tickets/:ticketId/remediation', authenticate, requireAdmin, requirePermission('manage_operations'), setRemediationAsAdmin);
router.get('/applications/:id/remediations', authenticate, requireAdmin, requirePermission('manage_operations'), listRemediationsAsAdmin);
// Group 12 Slice 3g (633): HQ creates, lists, and moves franchise
// corrective actions; only HQ verifies.
router.post('/applications/:id/support-tickets/:ticketId/corrective-actions', authenticate, requireAdmin, requirePermission('manage_operations'), createCorrectiveActionAsAdmin);
router.get('/applications/:id/support-tickets/:ticketId/corrective-actions', authenticate, requireAdmin, requirePermission('manage_operations'), listCorrectiveActionsAsAdmin);
router.get('/applications/:id/corrective-actions', authenticate, requireAdmin, requirePermission('manage_operations'), listCorrectiveActionsAsAdmin);
router.post('/applications/:id/corrective-actions/:actionId/status', authenticate, requireAdmin, requirePermission('manage_operations'), updateCorrectiveActionStatusAsAdmin);
// Group 12 Slice 3g (634): HQ uploads and reads evidence on a
// corrective action.
router.post('/applications/:id/corrective-actions/:actionId/evidence', authenticate, requireAdmin, requirePermission('manage_operations'), upload.single('file'), validateFileUpload, uploadActionEvidenceAsAdmin);
router.get('/applications/:id/corrective-actions/:actionId/evidence', authenticate, requireAdmin, requirePermission('manage_operations'), listActionEvidenceAsAdmin);
// Group 12 Slice 3i (641/642/644/645): HQ reviews a pending handoff
// (approve executes the transfer; reject needs a reason), reads the
// transfer log, cancels a pending handoff, and reads the contact
// directory. HQ also removes a territory member's access explicitly,
// with an audit entry (645).
router.get('/applications/:id/handoffs', authenticate, requireAdmin, requirePermission('manage_operations'), getHandoffsAsAdmin);
router.get('/applications/:id/handoffs/:handoffId', authenticate, requireAdmin, requirePermission('manage_operations'), getHandoffAsAdmin);
router.post('/applications/:id/handoffs/:handoffId/review', authenticate, requireAdmin, requirePermission('manage_operations'), reviewHandoffAsAdmin);
router.post('/applications/:id/handoffs/:handoffId/cancel', authenticate, requireAdmin, requirePermission('manage_operations'), cancelHandoffAsAdmin);
router.get('/applications/:id/handoffs/:handoffId/transfers', authenticate, requireAdmin, requirePermission('manage_operations'), listHandoffTransfersAsAdmin);
router.get('/applications/:id/contact-directory', authenticate, requireAdmin, requirePermission('manage_operations'), getContactDirectoryAsAdmin);
router.post('/applications/:id/access-removals', authenticate, requireAdmin, requirePermission('manage_operations'), removeTerritoryAccessAsAdmin);
router.get('/applications/:id/access-removals', authenticate, requireAdmin, requirePermission('manage_operations'), listAccessRemovalsAsAdmin);
// Group 12 Slice 3h (640): HQ reads the operator's expansion readiness
// notes alongside its own admin readiness fields.
router.get('/applications/:id/expansion-notes', authenticate, requireAdmin, requirePermission('manage_operations'), getExpansionNotesAsAdmin);
// Group 12 Slice 3h (639): HQ reads the launch dependency overview.
router.get('/applications/:id/launch-dependencies', authenticate, requireAdmin, requirePermission('manage_operations'), getLaunchDependenciesAsAdmin);
// Group 12 Slice 3h (638): HQ reads the training resource planner.
router.get('/applications/:id/training-planner', authenticate, requireAdmin, requirePermission('manage_operations'), getTrainingPlannerAsAdmin);
// Group 12 Slice 3h (637): HQ reads the capacity view and sets the
// target location count per structured boundary area.
router.get('/applications/:id/capacity', authenticate, requireAdmin, requirePermission('manage_operations'), getTerritoryCapacityAsAdmin);
router.post('/applications/:id/capacity-targets', authenticate, requireAdmin, requirePermission('manage_operations'), setCapacityTargetAsAdmin);
// Group 12 Slice 3h (636): HQ reads, proposes, and reviews candidate
// locations for the territory.
router.get('/applications/:id/candidate-locations', authenticate, requireAdmin, requirePermission('manage_operations'), getCandidateLocationsAsAdmin);
router.post('/applications/:id/candidate-locations', authenticate, requireAdmin, requirePermission('manage_operations'), createCandidateLocationAsAdmin);
router.patch('/applications/:id/candidate-locations/:candidateId', authenticate, requireAdmin, requirePermission('manage_operations'), updateCandidateLocationAsAdmin);
router.delete('/applications/:id/candidate-locations/:candidateId', authenticate, requireAdmin, requirePermission('manage_operations'), deleteCandidateLocationAsAdmin);
// Group 12 Slice 3g (635): HQ reviews a resolved corrective action
// (accept = verified, reject = back to in_progress with a reason) and
// reads the per-exception resolution state.
router.post('/applications/:id/corrective-actions/:actionId/review', authenticate, requireAdmin, requirePermission('manage_operations'), reviewCorrectiveActionAsAdmin);
router.get('/applications/:id/resolution', authenticate, requireAdmin, requirePermission('manage_operations'), getExceptionResolutionAsAdmin);
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
