const router = require('express').Router();
const { authenticate } = require('../middleware/auth');
const ctrl = require('../controllers/householdController');

// Group 2 (Household delegate, items 51-100). All routes authenticate;
// the controller re-checks the live delegation row on every call, so
// revocation and expiry close access immediately.
router.post('/delegations', authenticate, ctrl.inviteDelegation);
router.get('/delegations', authenticate, ctrl.listDelegations);
router.get('/invitations', authenticate, ctrl.listInvitations);
router.get('/delegations/:id', authenticate, ctrl.getDelegation);
router.post('/delegations/:id/accept', authenticate, ctrl.acceptDelegation);
router.post('/delegations/accept-by-token', authenticate, ctrl.acceptDelegationByToken);
router.post('/delegations/:id/decline', authenticate, ctrl.declineDelegation);
router.post('/delegations/:id/revoke', authenticate, ctrl.revokeDelegation);
router.post('/delegations/:id/renew', authenticate, ctrl.renewDelegation);
router.post('/delegations/:id/remind', authenticate, ctrl.remindDelegation);
router.post('/delegations/:id/coordinator', authenticate, ctrl.setCoordinator);
router.post('/delegations/:id/substitute', authenticate, ctrl.setSubstituteCoordinator);
router.post('/delegations/:id/handoff', authenticate, ctrl.handoffDelegation);
router.post('/delegations/:id/handoff-acknowledge', authenticate, ctrl.acknowledgeHandoff);
router.get('/delegations/:id/activity', authenticate, ctrl.getDelegationActivity);
router.get('/delegations/:id/scope-preview', authenticate, ctrl.getScopePreview);
router.get('/delegations/:id/closure-receipt', authenticate, ctrl.getClosureReceipt);
router.post('/delegations/:id/reinvite', authenticate, ctrl.reinviteDelegation);

router.get('/calendar', authenticate, ctrl.getCalendar);
router.post('/calendar/handoff', authenticate, ctrl.handoffCalendar);
router.post('/visits/reassign', authenticate, ctrl.reassignVisits);
router.post('/visits/:bookingId/remind', authenticate, ctrl.remindVisit);
router.post('/visits/:bookingId/availability', authenticate, ctrl.submitAvailability);
router.get('/visits/:bookingId/availability', authenticate, ctrl.getAvailability);
router.get('/visits/:bookingId/prep', authenticate, ctrl.getPrep);
router.put('/visits/:bookingId/prep', authenticate, ctrl.updatePrep);
router.post('/visits/:bookingId/prep/confirm-readiness', authenticate, ctrl.confirmReadiness);
router.post('/visits/:bookingId/prep/handoff', authenticate, ctrl.handoffPrep);
router.post('/visits/:bookingId/prep/handoff-acknowledge', authenticate, ctrl.acknowledgePrepHandoff);
router.post('/visits/:bookingId/supplies/remind', authenticate, ctrl.remindSupplies);
router.post('/visits/:bookingId/summary', authenticate, ctrl.shareVisitSummary);
router.post('/visits/:bookingId/replacement-request', authenticate, ctrl.requestReplacement);
router.post('/visits/:bookingId/missed-followup', authenticate, ctrl.missedFollowup);
router.post('/visits/:bookingId/unavailable', authenticate, ctrl.markUnavailable);
router.post('/visits/:bookingId/emergency-fallback', authenticate, ctrl.emergencyFallback);
router.get('/visits/:bookingId/cancellation-preview', authenticate, ctrl.cancellationPreview);

router.get('/templates', authenticate, ctrl.listTemplates);
router.post('/templates', authenticate, ctrl.createTemplate);
router.put('/templates/:id', authenticate, ctrl.updateTemplate);
router.delete('/templates/:id', authenticate, ctrl.deleteTemplate);
router.get('/templates/:id/prefill', authenticate, ctrl.prefillTemplate);

router.post('/spending-approvals', authenticate, ctrl.createSpendingApproval);
router.get('/spending-approvals', authenticate, ctrl.listSpendingApprovals);
router.post('/spending-approvals/:id/decide', authenticate, ctrl.decideSpendingApproval);

router.get('/tasks', authenticate, ctrl.listTasks);
router.post('/tasks', authenticate, ctrl.createTask);
router.put('/tasks/:id', authenticate, ctrl.updateTask);
router.post('/tasks/:id/complete', authenticate, ctrl.completeTask);
router.get('/tasks/triage', authenticate, ctrl.triageTasks);
router.get('/tasks/history', authenticate, ctrl.taskHistory);

router.get('/documents', authenticate, ctrl.listDocuments);
router.post('/documents', authenticate, ctrl.createDocument);
router.post('/documents/:id/forward', authenticate, ctrl.forwardDocument);

router.get('/history-export', authenticate, ctrl.historyExport);

router.get('/contacts', authenticate, ctrl.listContacts);
router.post('/contacts', authenticate, ctrl.createContact);
router.put('/contacts/:id', authenticate, ctrl.updateContact);
router.post('/contacts/:id/archive', authenticate, ctrl.archiveContact);
router.delete('/contacts/:id', authenticate, ctrl.deleteContact);

router.get('/addresses', authenticate, ctrl.listSharedAddresses);

module.exports = router;
