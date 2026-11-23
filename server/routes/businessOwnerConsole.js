'use strict';
// Groups 5-6 (items 201-300): business owner console and team member work
// routes. Mounted at /api/businesses (business-scoped) and
// /api/business-listing-claims (claimant-scoped). Every route resolves the
// live business, membership and permission server-side; persona labels and
// client state grant nothing.
const express = require('express');
const { authenticate } = require('../middleware/auth');
const requireBusinessAccess = require('../middleware/requireBusinessAccess');
const requirePermission = require('../middleware/requirePermission');
const { rejectImpersonated } = require('../middleware/rejectImpersonated');
const { scopeExempt } = require('../middleware/scopeGates');
const launch = require('../services/businessOwner/launchService');
const claims = require('../services/businessOwner/listingClaimService');
const oversight = require('../services/businessOwner/oversightService');
const policies = require('../services/businessOwner/policyService');
const finance = require('../services/businessOwner/financeService');
const expansion = require('../services/businessOwner/expansionService');
const continuity = require('../services/businessOwner/continuityService');
const performance = require('../services/businessOwner/performanceService');
const workStart = require('../services/businessOwner/workStartService');
const workJobs = require('../services/businessOwner/workJobsService');
const workComms = require('../services/businessOwner/workCommsService');
const workOutcomes = require('../services/businessOwner/workOutcomesService');
const workLeave = require('../services/businessOwner/workLeaveService');
const { requireFinanceRead, requireFinanceWrite } = require('../middleware/requireBusinessFinance');

const h = fn => async (req, res, next) => { res.set('Cache-Control', 'no-store'); try { await fn(req, res); } catch (e) { next(e); } };
const biz = (minRole, perm) => [authenticate, requireBusinessAccess({ minRole }), ...(perm ? [requirePermission(perm)] : [])];
const write = (minRole, perm) => [authenticate, rejectImpersonated, requireBusinessAccess({ minRole }), ...(perm ? [requirePermission(perm)] : [])];

const router = express.Router();
// 203-205 launch status + checklists
router.get('/:businessId/owner/launch-readiness', ...biz('manager', 'business.view'), h(async (req, res) => res.json(await launch.readiness(req.business.id))));
// 207, 210 offerings: regional rules and pause controls
router.get('/:businessId/owner/offerings', ...biz('manager', 'business.edit_profile'), h(async (req, res) => res.json(await launch.offerings(req.business.id))));
router.put('/:businessId/owner/services/:serviceId/regions', ...write('manager', 'business.edit_profile'), h(async (req, res) => res.json(await launch.setRegions(req.business.id, req.user.id, req.params.serviceId, req.body))));
router.post('/:businessId/owner/services/:serviceId/pause', ...write('manager', 'business.edit_profile'), h(async (req, res) => res.json(await launch.pause(req.business.id, req.user.id, req.params.serviceId, req.body))));
router.post('/:businessId/owner/services/:serviceId/resume', ...write('manager', 'business.edit_profile'), h(async (req, res) => res.json(await launch.resume(req.business.id, req.user.id, req.params.serviceId, req.body))));

// 217, 218, 220 oversight
router.get('/:businessId/owner/open-assignments', ...biz('manager', 'jobs.assign'), h(async (req, res) => res.json(await oversight.openAssignments(req.business.id))));
router.get('/:businessId/owner/schedule-heatmap', ...biz('manager', 'calendar.view_all'), h(async (req, res) => res.json(await oversight.heatmap(req.business.id, req.query))));
router.get('/:businessId/owner/handoff-timeline', ...biz('manager', 'team.view'), h(async (req, res) => res.json(await oversight.handoffTimeline(req.business.id, req.query))));
// 222 repeat service records
router.get('/:businessId/owner/repeat-customers', ...biz('manager', 'customers.view_all'), h(async (req, res) => res.json(await oversight.repeatRecords(req.business.id))));
// 225 service issue review (business side); customer side below is reporter-scoped
router.get('/:businessId/owner/service-issues', ...biz('manager', 'bookings.manage'), h(async (req, res) => res.json(await oversight.issueQueue(req.business.id, req.query))));
router.patch('/:businessId/owner/service-issues/:issueId', ...write('manager', 'bookings.manage'), h(async (req, res) => res.json(await oversight.updateIssue(req.business.id, req.user.id, req.params.issueId, req.body))));
router.get('/:businessId/appointments/:appointmentId/service-issues/mine', authenticate, scopeExempt('customer-self-service'), h(async (req, res) => res.json(await oversight.myIssues(req.user.id, req.params.appointmentId))));
router.post('/:businessId/appointments/:appointmentId/service-issues', authenticate, scopeExempt('customer-self-service'), rejectImpersonated, h(async (req, res) => res.status(201).json(await oversight.reportIssue(req.user.id, req.params.businessId, req.params.appointmentId, req.body))));

// 226-228 policies (owner edits; approvers act on pending items)
router.get('/:businessId/owner/policies', ...biz('manager', 'business.view'), h(async (req, res) => res.json(await policies.read(req.business.id))));
router.put('/:businessId/owner/policies', ...write('owner'), h(async (req, res) => res.json(await policies.update(req.business.id, req.user.id, req.body))));
router.post('/:businessId/owner/quotes/:quoteId/approve', ...write('manager', 'quotes.approve_discounts'), h(async (req, res) => res.json(await policies.approveQuote(req.business.id, req.user.id, req.params.quoteId))));
router.post('/:businessId/owner/expenses/:expenseId/decision', ...write('manager', 'payouts.manage'), h(async (req, res) => res.json(await policies.decideExpense(req.business.id, req.user.id, req.params.expenseId, req.body))));

// 231-234 finance (finance-read codes see; payouts.manage reconciles; invoices.create edits categories)
const finRead = [authenticate, requireBusinessAccess({ minRole: 'any' }), requireFinanceRead()];
const finWrite = code => [authenticate, rejectImpersonated, requireBusinessAccess({ minRole: 'any' }), requireFinanceWrite(code)];
router.get('/:businessId/owner/invoice-overview', ...finRead, h(async (req, res) => res.json(await finance.invoiceOverview(req.business.id))));
router.get('/:businessId/owner/refund-tracker', ...finRead, h(async (req, res) => res.json(await finance.refundTracker(req.business.id))));
router.get('/:businessId/owner/payout-reconciliation', ...finRead, h(async (req, res) => res.json(await finance.reconciliation(req.business.id))));
router.post('/:businessId/owner/payout-deposits', ...finWrite('payouts.manage'), h(async (req, res) => res.status(201).json(await finance.recordDeposit(req.business.id, req.user.id, req.body))));
router.delete('/:businessId/owner/payout-deposits/:depositId', ...finWrite('payouts.manage'), h(async (req, res) => res.json(await finance.deleteDeposit(req.business.id, req.params.depositId))));
router.get('/:businessId/owner/expense-categories', ...finRead, h(async (req, res) => res.json(await finance.listCategories(req.business.id))));
router.post('/:businessId/owner/expense-categories', ...finWrite('invoices.create'), h(async (req, res) => res.status(201).json(await finance.saveCategory(req.business.id, req.user.id, req.body))));
router.put('/:businessId/owner/expense-categories/:categoryId', ...finWrite('invoices.create'), h(async (req, res) => res.json(await finance.saveCategory(req.business.id, req.user.id, req.body, req.params.categoryId))));

// 236-240 expansion (locations: business.manage_locations; planning: analytics.view_ops)
router.get('/:businessId/owner/locations', ...biz('manager', 'business.view'), h(async (req, res) => res.json(await expansion.listLocations(req.business.id))));
router.post('/:businessId/owner/locations', ...write('manager', 'business.manage_locations'), h(async (req, res) => res.status(201).json(await expansion.createLocation(req.business.id, req.user.id, req.body))));
router.put('/:businessId/owner/locations/:locationId', ...write('manager', 'business.manage_locations'), h(async (req, res) => res.json(await expansion.updateLocation(req.business.id, req.user.id, req.params.locationId, req.body))));
router.post('/:businessId/owner/locations/:locationId/:action(launch|pause|close)', ...write('manager', 'business.manage_locations'), h(async (req, res) => res.json(await expansion.setStatus(req.business.id, req.user.id, req.params.locationId, req.params.action, req.body))));
router.post('/:businessId/owner/locations/:locationId/checklist', ...write('manager', 'business.manage_locations'), h(async (req, res) => res.status(201).json(await expansion.addChecklistItem(req.business.id, req.params.locationId, req.body))));
router.patch('/:businessId/owner/locations/:locationId/checklist/:itemId', ...write('manager', 'business.manage_locations'), h(async (req, res) => res.json(await expansion.setChecklistItem(req.business.id, req.user.id, req.params.locationId, req.params.itemId, req.body))));
router.get('/:businessId/owner/territory', ...biz('manager', 'customers.view_all'), h(async (req, res) => res.json(await expansion.territory(req.business.id))));
router.get('/:businessId/owner/capacity', ...biz('manager', 'calendar.view_all'), h(async (req, res) => res.json(await expansion.capacity(req.business.id, req.query))));
router.get('/:businessId/owner/staffing-forecast', ...biz('manager', 'calendar.view_all'), h(async (req, res) => res.json(await expansion.seasonalForecast(req.business.id))));

// 241-245 continuity (ownership and deputy are owner-only; recipient responds as a manager)
router.get('/:businessId/owner/ownership-transfer', ...biz('manager'), h(async (req, res) => res.json(await continuity.transferState(req.business.id, req.user.id))));
router.post('/:businessId/owner/ownership-transfer', ...write('owner', 'owner.transfer'), h(async (req, res) => res.status(201).json(await continuity.requestTransfer(req.business.id, req.user.id, req.body))));
router.post('/:businessId/owner/ownership-transfer/:transferId/cancel', ...write('owner', 'owner.transfer'), h(async (req, res) => res.json(await continuity.cancelTransfer(req.business.id, req.user.id, req.params.transferId))));
router.post('/:businessId/ownership-transfer/:transferId/:answer(accept|decline)', ...write('manager'), h(async (req, res) => res.json(await continuity.respondTransfer(req.business.id, req.user.id, req.params.transferId, req.params.answer === 'accept'))));
router.get('/:businessId/owner/deputy', ...biz('manager', 'team.view'), h(async (req, res) => res.json(await continuity.deputyState(req.business.id))));
router.post('/:businessId/owner/deputy', ...write('owner'), h(async (req, res) => res.status(201).json(await continuity.designateDeputy(req.business.id, req.user.id, req.body))));
router.delete('/:businessId/owner/deputy', ...write('owner'), h(async (req, res) => res.json(await continuity.endDeputy(req.business.id, req.user.id))));
router.get('/:businessId/owner/work-transition', ...biz('manager', 'jobs.assign'), h(async (req, res) => res.json(await continuity.workPreview(req.business.id, req.query.from))));
router.post('/:businessId/owner/work-transition', ...write('manager', 'jobs.assign'), h(async (req, res) => res.json(await continuity.transitionWork(req.business.id, req.user.id, req.body))));
router.get('/:businessId/owner/departed-members', ...biz('manager', 'team.view'), h(async (req, res) => res.json(await continuity.departed(req.business.id))));
router.patch('/:businessId/owner/departed-members/:recordId', ...write('owner'), h(async (req, res) => res.json(await continuity.setFormerAccess(req.business.id, req.user.id, req.params.recordId, req.body))));
router.get('/:businessId/owner/closure-checklist', ...biz('owner'), h(async (req, res) => res.json(await continuity.closureChecklist(req.business.id))));
router.put('/:businessId/owner/closure-plan', ...write('owner', 'owner.delete_business'), h(async (req, res) => res.json(await continuity.saveClosurePlan(req.business.id, req.user.id, req.body))));

// 246-250 performance (operations: analytics.view_ops; money: analytics.view_financial)
router.get('/:businessId/owner/reports/quote-acceptance', ...biz('manager', 'analytics.view_ops'), h(async (req, res) => res.json(await performance.quoteAcceptance(req.business.id, req.query))));
router.get('/:businessId/owner/reports/utilization', ...biz('manager', 'analytics.view_ops'), h(async (req, res) => res.json(await performance.utilization(req.business.id, req.query))));
router.get('/:businessId/owner/reports/quality', ...biz('manager', 'analytics.view_ops'), h(async (req, res) => res.json(await performance.qualityTrends(req.business.id))));
router.get('/:businessId/owner/reports/costs', ...biz('manager', 'analytics.view_financial'), h(async (req, res) => res.json(await performance.costSnapshots(req.business.id, req.query))));
router.post('/:businessId/owner/reports/costs/snapshots', ...write('manager', 'analytics.view_financial'), h(async (req, res) => res.status(201).json(await performance.takeSnapshot(req.business.id, req.user.id, req.body))));
router.get('/:businessId/owner/reports/recurring', ...biz('manager', 'analytics.view_financial'), h(async (req, res) => res.json(await performance.recurringRevenue(req.business.id))));

// 252-260 team member start + dispatch (any active member; managers for the boards)
const ctx = req => ({ role: req.businessRole, permissions: req.permissions });
router.get('/:businessId/work/me', ...biz('any', 'business.view'), h(async (req, res) => res.json(await workStart.overview(req.business.id, req.user.id, ctx(req)))));
router.get('/:businessId/work/onboarding', ...biz('any', 'business.view'), h(async (req, res) => res.json(await workStart.onboarding(req.business.id, req.user.id))));
router.get('/:businessId/work/access-check', ...biz('any'), h(async (req, res) => res.json(await workStart.accessCheck(req.business.id, req.user.id, ctx(req), req.query.code))));
router.get('/:businessId/work/permission-requests', ...biz('any'), h(async (req, res) => res.json(await workStart.myPermissionRequests(req.business.id, req.user.id))));
router.post('/:businessId/work/permission-requests', ...write('any'), h(async (req, res) => res.status(201).json(await workStart.requestPermission(req.business.id, req.user.id, ctx(req), req.body))));
router.post('/:businessId/work/permission-requests/:requestId/cancel', ...write('any'), h(async (req, res) => res.json(await workStart.cancelPermissionRequest(req.business.id, req.user.id, req.params.requestId))));
router.get('/:businessId/owner/permission-requests', ...biz('manager', 'team.assign_permissions'), h(async (req, res) => res.json(await workStart.permissionQueue(req.business.id))));
router.post('/:businessId/owner/permission-requests/:requestId/decision', ...write('manager', 'team.assign_permissions'), h(async (req, res) => res.json(await workStart.decidePermission(req.business.id, req.user.id, ctx(req), req.params.requestId, req.body))));
router.get('/:businessId/work/queue', ...biz('any', 'business.view'), h(async (req, res) => res.json(await workStart.queue(req.business.id, req.user.id))));
router.post('/:businessId/work/queue/:appointmentId/claim', ...write('any', 'business.view'), h(async (req, res) => res.json(await workStart.claim(req.business.id, req.user.id, ctx(req), req.params.appointmentId))));
router.post('/:businessId/work/appointments/:appointmentId/release', ...write('any', 'business.view'), h(async (req, res) => res.json(await workStart.release(req.business.id, req.user.id, req.params.appointmentId, req.body))));
router.post('/:businessId/work/appointments/:appointmentId/dispatch', ...write('any', 'business.view'), h(async (req, res) => res.json(await workStart.respondDispatch(req.business.id, req.user.id, req.params.appointmentId, req.body))));
router.get('/:businessId/work/conflicts', ...biz('any', 'business.view'), h(async (req, res) => res.json(await workStart.conflicts(req.business.id, req.user.id))));
router.get('/:businessId/owner/appointments/:appointmentId/matches', ...biz('manager', 'jobs.assign'), h(async (req, res) => res.json(await workStart.matches(req.business.id, req.params.appointmentId))));
router.get('/:businessId/owner/dispatch', ...biz('manager', 'jobs.assign'), h(async (req, res) => res.json(await workStart.dispatchBoard(req.business.id))));

// 261-270, 286-290 jobs, crews and blockers
const A = '/:businessId/work/appointments/:appointmentId';
router.get('/:businessId/work/board', ...biz('any', 'business.view'), h(async (req, res) => res.json(await workJobs.board(req.business.id, req.user.id))));
router.get(`${A}/checklist`, ...biz('any', 'business.view'), h(async (req, res) => res.json(await workJobs.checklist(req.business.id, req.user.id, ctx(req), req.params.appointmentId))));
router.post(`${A}/checklist`, ...write('any', 'business.view'), h(async (req, res) => res.status(201).json(await workJobs.addChecklistItem(req.business.id, req.user.id, ctx(req), req.params.appointmentId, req.body))));
router.patch(`${A}/checklist/:itemId`, ...write('any', 'business.view'), h(async (req, res) => res.json(await workJobs.setChecklistItem(req.business.id, req.user.id, ctx(req), req.params.appointmentId, req.params.itemId, req.body))));
router.get('/:businessId/owner/service-checklists', ...biz('manager', 'jobs.edit'), h(async (req, res) => res.json(await workJobs.serviceChecklists(req.business.id))));
router.put('/:businessId/owner/services/:serviceId/checklist', ...write('manager', 'jobs.edit'), h(async (req, res) => res.json(await workJobs.setServiceChecklist(req.business.id, req.user.id, req.params.serviceId, req.body))));
router.get(`${A}/progress`, ...biz('any', 'business.view'), h(async (req, res) => res.json(await workJobs.progress(req.business.id, req.user.id, ctx(req), req.params.appointmentId))));
router.post(`${A}/progress`, ...write('any', 'business.view'), h(async (req, res) => res.status(201).json(await workJobs.addProgress(req.business.id, req.user.id, req.params.appointmentId, req.body))));
router.get('/:businessId/work/exceptions', ...biz('any'), h(async (req, res) => res.json(await workJobs.myExceptions(req.business.id, req.user.id))));
router.post('/:businessId/work/exceptions', ...write('any'), h(async (req, res) => res.status(201).json(await workJobs.raiseException(req.business.id, req.user.id, ctx(req), req.body))));
router.post('/:businessId/work/exceptions/:exceptionId/escalate', ...write('any'), h(async (req, res) => res.json(await workJobs.escalate(req.business.id, req.user.id, req.params.exceptionId))));
router.patch('/:businessId/work/exceptions/:exceptionId', ...write('any'), h(async (req, res) => res.json(await workJobs.updateException(req.business.id, req.user.id, ctx(req), req.params.exceptionId, req.body))));
router.get('/:businessId/owner/exceptions', ...biz('manager', 'jobs.view_all'), h(async (req, res) => res.json(await workJobs.exceptionQueue(req.business.id, req.query))));
router.get('/:businessId/work/crews', ...biz('any', 'business.view'), h(async (req, res) => res.json(await workJobs.crews(req.business.id))));
router.post('/:businessId/owner/crews', ...write('manager', 'jobs.assign'), h(async (req, res) => res.status(201).json(await workJobs.saveCrew(req.business.id, req.user.id, req.body))));
router.put('/:businessId/owner/crews/:crewId', ...write('manager', 'jobs.assign'), h(async (req, res) => res.json(await workJobs.saveCrew(req.business.id, req.user.id, req.body, req.params.crewId))));
router.get(`${A}/crew`, ...biz('any', 'business.view'), h(async (req, res) => res.json(await workJobs.appointmentCrew(req.business.id, req.user.id, ctx(req), req.params.appointmentId))));
router.put('/:businessId/owner/appointments/:appointmentId/crew', ...write('manager', 'jobs.assign'), h(async (req, res) => res.json(await workJobs.allocateCrew(req.business.id, req.user.id, req.params.appointmentId, req.body))));
router.patch(`${A}/crew/:memberId`, ...write('any', 'business.view'), h(async (req, res) => res.json(await workJobs.setCrewTask(req.business.id, req.user.id, req.params.appointmentId, req.params.memberId, req.body))));
router.post(`${A}/attendance`, ...write('any', 'business.view'), h(async (req, res) => res.json(await workJobs.respondAttendance(req.business.id, req.user.id, req.params.appointmentId, req.body))));
router.get(`${A}/documents`, ...biz('any', 'business.view'), h(async (req, res) => res.json(await workJobs.documents(req.business.id, req.user.id, ctx(req), req.params.appointmentId))));
router.post('/:businessId/owner/appointments/:appointmentId/documents', ...write('manager', 'jobs.edit'), h(async (req, res) => res.status(201).json(await workJobs.addDocument(req.business.id, req.user.id, req.params.appointmentId, req.body))));
router.delete('/:businessId/owner/appointment-documents/:documentId', ...write('manager', 'jobs.edit'), h(async (req, res) => res.json(await workJobs.removeDocument(req.business.id, req.params.documentId))));

// 273-275, 277, 280 handoffs, mentions, inbox, coverage, day view
router.get(`${A}/handoff`, ...biz('any', 'business.view'), h(async (req, res) => res.json(await workComms.handoff(req.business.id, req.user.id, ctx(req), req.params.appointmentId))));
router.post(`${A}/handoff/ack`, ...write('any', 'business.view'), h(async (req, res) => res.json(await workComms.acknowledgeHandoff(req.business.id, req.user.id, req.params.appointmentId))));
router.post(`${A}/team-notes`, ...write('any', 'business.view'), h(async (req, res) => res.status(201).json(await workComms.addNote(req.business.id, req.user.id, ctx(req), req.params.appointmentId, req.body))));
router.get('/:businessId/work/inbox', ...biz('any'), h(async (req, res) => res.json(await workComms.inbox(req.business.id, req.user.id))));
router.post('/:businessId/work/inbox/seen', ...write('any'), h(async (req, res) => res.json(await workComms.markInboxSeen(req.business.id, req.user.id, req.body))));
router.get('/:businessId/work/coverage', ...biz('any', 'business.view'), h(async (req, res) => res.json(await workComms.coverage(req.business.id, req.user.id, ctx(req)))));
router.post('/:businessId/work/shifts/:shiftId/coverage', ...write('any', 'business.view'), h(async (req, res) => res.status(201).json(await workComms.requestCoverage(req.business.id, req.user.id, req.params.shiftId, req.body))));
router.post('/:businessId/work/coverage/:requestId/claim', ...write('any', 'business.view'), h(async (req, res) => res.json(await workComms.claimCoverage(req.business.id, req.user.id, req.params.requestId))));
router.post('/:businessId/work/coverage/:requestId/cancel', ...write('any'), h(async (req, res) => res.json(await workComms.cancelCoverage(req.business.id, req.user.id, req.params.requestId))));
router.post('/:businessId/owner/coverage/:requestId/decision', ...write('manager'), h(async (req, res) => res.json(await workComms.decideCoverage(req.business.id, req.user.id, req.params.requestId, req.body))));
router.get('/:businessId/work/day', ...biz('any', 'business.view'), h(async (req, res) => res.json(await workComms.day(req.business.id, req.user.id, req.query))));

// 281-285 outcomes
router.get(`${A}/completion`, ...biz('any', 'business.view'), h(async (req, res) => res.json(await workOutcomes.completion(req.business.id, req.user.id, ctx(req), req.params.appointmentId))));
router.put(`${A}/completion`, ...write('any', 'business.view'), h(async (req, res) => res.json(await workOutcomes.saveCompletion(req.business.id, req.user.id, ctx(req), req.params.appointmentId, req.body))));
router.get(`${A}/materials`, ...biz('any', 'business.view'), h(async (req, res) => res.json(await workOutcomes.materials(req.business.id, req.user.id, ctx(req), req.params.appointmentId))));
router.post(`${A}/materials`, ...write('any', 'business.view'), h(async (req, res) => res.status(201).json(await workOutcomes.addMaterial(req.business.id, req.user.id, ctx(req), req.params.appointmentId, req.body))));
router.delete('/:businessId/work/materials/:materialId', ...write('any', 'business.view'), h(async (req, res) => res.json(await workOutcomes.removeMaterial(req.business.id, req.user.id, ctx(req), req.params.materialId))));
router.get(`${A}/assignment-history`, ...biz('any', 'business.view'), h(async (req, res) => res.json(await workOutcomes.assignmentHistory(req.business.id, req.user.id, ctx(req), req.params.appointmentId))));
router.get('/:businessId/work/feedback', ...biz('any', 'business.view'), h(async (req, res) => res.json(await workOutcomes.myFeedback(req.business.id, req.user.id))));
router.get('/:businessId/owner/feedback-followups', ...biz('manager'), h(async (req, res) => res.json(await workOutcomes.feedbackQueue(req.business.id, req.user.id, ctx(req), req.query))));
router.patch('/:businessId/owner/feedback-followups/:followupId', ...write('manager'), h(async (req, res) => res.json(await workOutcomes.updateFollowup(req.business.id, req.user.id, ctx(req), req.params.followupId, req.body))));

// 291-300 continuity and leaving a scope
router.get('/:businessId/work/handovers', ...biz('any', 'business.view'), h(async (req, res) => res.json(await workLeave.handovers(req.business.id, req.user.id))));
router.post('/:businessId/work/handovers', ...write('any', 'business.view'), h(async (req, res) => res.status(201).json(await workLeave.createHandover(req.business.id, req.user.id, req.body))));
router.post('/:businessId/work/handovers/:handoverId/ack', ...write('any', 'business.view'), h(async (req, res) => res.json(await workLeave.acknowledgeHandover(req.business.id, req.user.id, req.params.handoverId))));
router.post('/:businessId/owner/team-tasks/:taskId/owner', ...write('manager', 'jobs.assign'), h(async (req, res) => res.json(await workLeave.replaceTaskOwner(req.business.id, req.user.id, req.params.taskId, req.body))));
router.post('/:businessId/work/tasks/transfer', ...write('any', 'business.view'), h(async (req, res) => res.json(await workLeave.transferUnfinished(req.business.id, req.user.id, req.body))));
router.get('/:businessId/work/tasks/:taskId/history', ...biz('any', 'business.view'), h(async (req, res) => res.json(await workLeave.taskHistory(req.business.id, req.user.id, ctx(req), req.params.taskId))));
router.get('/:businessId/work/delegations', ...biz('any', 'business.view'), h(async (req, res) => res.json(await workLeave.delegations(req.business.id, req.user.id))));
router.post('/:businessId/work/delegations', ...write('any', 'business.view'), h(async (req, res) => res.status(201).json(await workLeave.proposeDelegation(req.business.id, req.user.id, req.body))));
router.post('/:businessId/work/delegations/:delegationId/respond', ...write('any', 'business.view'), h(async (req, res) => res.json(await workLeave.respondDelegation(req.business.id, req.user.id, req.params.delegationId, req.body))));
router.get('/:businessId/work/end-of-shift', ...biz('any', 'business.view'), h(async (req, res) => res.json(await workLeave.endOfShift(req.business.id, req.user.id))));
router.put('/:businessId/work/end-of-shift', ...write('any', 'business.view'), h(async (req, res) => res.json(await workLeave.saveEndOfShift(req.business.id, req.user.id, req.body))));
router.get('/:businessId/work/leave-preview', ...biz('any'), h(async (req, res) => res.json(await workLeave.leavePreview(req.business.id, req.user.id))));
router.post('/:businessId/work/leave', ...write('any'), h(async (req, res) => res.json(await workLeave.leave(req.business.id, req.user.id, req.body))));

const claimRouter = express.Router();
// 201 listing claims (the service checks the claimant owns the business)
claimRouter.get('/listings', authenticate, h(async (req, res) => res.json(await claims.searchListings(req.query.q))));
claimRouter.get('/mine', authenticate, h(async (req, res) => res.json(await claims.listMine(req.user.id))));
claimRouter.post('/', authenticate, rejectImpersonated, h(async (req, res) => res.status(201).json(await claims.submit(req.user.id, req.body))));
claimRouter.post('/:claimId/withdraw', authenticate, rejectImpersonated, h(async (req, res) => res.json(await claims.withdraw(req.user.id, req.params.claimId))));

const meRouter = express.Router();
// 225 customer: own recent business visits and their issue status.
meRouter.get('/', authenticate, h(async (req, res) => res.json(await oversight.myVisits(req.user.id))));

const formerRouter = express.Router();
formerRouter.get('/', authenticate, h(async (req, res) => res.json(await continuity.myFormerWorkplaces(req.user.id))));

module.exports = { router, claimRouter, meRouter, formerRouter };
