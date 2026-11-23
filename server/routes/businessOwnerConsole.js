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

const claimRouter = express.Router();
// 201 listing claims (the service checks the claimant owns the business)
claimRouter.get('/listings', authenticate, h(async (req, res) => res.json(await claims.searchListings(req.query.q))));
claimRouter.get('/mine', authenticate, h(async (req, res) => res.json(await claims.listMine(req.user.id))));
claimRouter.post('/', authenticate, rejectImpersonated, h(async (req, res) => res.status(201).json(await claims.submit(req.user.id, req.body))));
claimRouter.post('/:claimId/withdraw', authenticate, rejectImpersonated, h(async (req, res) => res.json(await claims.withdraw(req.user.id, req.params.claimId))));

const meRouter = express.Router();
// 225 customer: own recent business visits and their issue status.
meRouter.get('/', authenticate, h(async (req, res) => res.json(await oversight.myVisits(req.user.id))));

module.exports = { router, claimRouter, meRouter };
