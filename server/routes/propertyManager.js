'use strict';
// Group 7 (items 301-350): property manager console. Mounted at
// /api/businesses (business-scoped) and /api/me/property (owner/occupant).
// Owner/manager members administer; other members act only through an
// active property assignment, re-checked in the service on every call.
const express = require('express');
const { authenticate } = require('../middleware/auth');
const requireBusinessAccess = require('../middleware/requireBusinessAccess');
const { rejectImpersonated } = require('../middleware/rejectImpersonated');
const portfolio = require('../services/propertyManager/portfolioService');
const work = require('../services/propertyManager/workService');
const upkeep = require('../services/propertyManager/upkeepService');

const h = fn => async (req, res, next) => { res.set('Cache-Control', 'no-store'); try { const out = await fn(req, res); if (!res.headersSent) res.status(req.method === 'POST' && req.created ? 201 : 200).json(out); } catch (e) { next(e); } };
const member = [authenticate, requireBusinessAccess({ minRole: 'employee' })];
const memberW = [authenticate, rejectImpersonated, requireBusinessAccess({ minRole: 'employee' })];
const admin = [authenticate, requireBusinessAccess({ minRole: 'manager' })];
const adminW = [authenticate, rejectImpersonated, requireBusinessAccess({ minRole: 'manager' })];
const B = req => req.business.id; const U = req => req.user.id; const R = req => req.businessRole;
const made = fn => async (req, res) => { req.created = true; return fn(req, res); };

const router = express.Router();
const P = '/:businessId/properties';
// 301-305 portfolio
router.get(`${P}`, ...member, h(req => portfolio.portfolio(B(req), U(req), R(req), { archived: req.query.archived === '1' })));
router.get(`${P}/mine`, ...member, h(req => portfolio.mine(B(req), U(req))));
router.post(`${P}`, ...adminW, h(made(req => portfolio.createProperty(B(req), U(req), req.body))));
router.get(`${P}/p/:propertyId`, ...member, h(req => portfolio.profile(B(req), req.params.propertyId, U(req), R(req))));
router.patch(`${P}/p/:propertyId`, ...adminW, h(req => portfolio.updateProperty(B(req), req.params.propertyId, req.body)));
router.post(`${P}/p/:propertyId/archive`, ...adminW, h(req => portfolio.archive(B(req), req.params.propertyId, U(req), req.body)));
router.post(`${P}/p/:propertyId/restore`, ...adminW, h(req => portfolio.restore(B(req), req.params.propertyId)));
router.post(`${P}/p/:propertyId/units`, ...adminW, h(made(req => portfolio.addUnit(B(req), req.params.propertyId, req.body))));
router.post(`${P}/p/:propertyId/common-areas`, ...adminW, h(made(req => portfolio.addArea(B(req), req.params.propertyId, req.body))));
router.delete(`${P}/common-areas/:areaId`, ...adminW, h(req => portfolio.archiveArea(B(req), req.params.areaId)));
// 306-310 delegation
router.post(`${P}/p/:propertyId/assignments`, ...adminW, h(made(req => portfolio.assign(B(req), req.params.propertyId, U(req), req.body))));
router.delete(`${P}/assignments/:assignmentId`, ...adminW, h(req => portfolio.endAssignment(B(req), req.params.assignmentId, U(req))));
router.get(`${P}/access-review`, ...admin, h(req => portfolio.accessReview(B(req))));
router.post(`${P}/assignments/:assignmentId/review`, ...adminW, h(req => portfolio.reviewAssignment(B(req), req.params.assignmentId, U(req), req.body)));
// 314 duplicates, 316-320 approvals / quotes / vendors / work orders
router.get(`${P}/requests/:requestId/duplicates`, ...member, h(req => work.duplicates(B(req), req.params.requestId, U(req), R(req))));
router.post(`${P}/requests/:requestId/duplicate`, ...memberW, h(req => work.linkDuplicate(B(req), req.params.requestId, U(req), R(req), req.body)));
router.post(`${P}/requests/:requestId/approval`, ...adminW, h(req => work.requestApproval(B(req), req.params.requestId, U(req), R(req), req.body)));
router.get(`${P}/requests/:requestId/quotes`, ...admin, h(req => work.quotes(B(req), req.params.requestId, U(req), R(req))));
router.post(`${P}/requests/:requestId/quotes`, ...adminW, h(made(req => work.addQuote(B(req), req.params.requestId, U(req), R(req), req.body))));
router.post(`${P}/quotes/:quoteId/select`, ...adminW, h(req => work.selectQuote(B(req), req.params.quoteId, U(req))));
router.get(`${P}/vendors`, ...member, h(req => work.vendors(B(req), req.query)));
router.post(`${P}/vendors`, ...adminW, h(made(req => work.createVendor(B(req), U(req), req.body))));
router.patch(`${P}/vendors/:vendorId`, ...adminW, h(req => work.updateVendor(B(req), req.params.vendorId, req.body)));
router.get(`${P}/work-orders`, ...admin, h(req => work.workOrders(B(req), req.query)));
router.post(`${P}/requests/:requestId/work-orders`, ...adminW, h(made(req => work.issueWorkOrder(B(req), req.params.requestId, U(req), R(req), req.body))));
router.post(`${P}/work-orders/:workOrderId/close`, ...adminW, h(req => work.closeWorkOrder(B(req), req.params.workOrderId, U(req), req.body)));
// 321-325 entry + keys
router.get(`${P}/requests/:requestId/entry`, ...member, h(req => work.getEntry(B(req), req.params.requestId, U(req), R(req))));
router.put(`${P}/requests/:requestId/entry`, ...memberW, h(req => work.saveEntry(B(req), req.params.requestId, U(req), R(req), req.body)));
router.post(`${P}/requests/:requestId/entry/notify`, ...memberW, h(req => work.notifyOccupant(B(req), req.params.requestId, U(req), R(req))));
router.get(`${P}/p/:propertyId/keys`, ...member, h(req => work.keys(B(req), req.params.propertyId, U(req), R(req))));
router.post(`${P}/p/:propertyId/keys`, ...adminW, h(made(req => work.addKey(B(req), req.params.propertyId, req.body))));
for (const action of ['check_out', 'return', 'lost']) router.post(`${P}/keys/:keyId/${action.replace('_', '-')}`, ...memberW, h(req => work.keyAction(B(req), req.params.keyId, U(req), R(req), action, req.body)));
// 326-330 prevention
router.get(`${P}/calendar`, ...member, h(req => upkeep.calendar(B(req), U(req), R(req), req.query)));
router.post(`${P}/p/:propertyId/schedules`, ...adminW, h(made(req => upkeep.createSchedule(B(req), req.params.propertyId, U(req), req.body))));
router.patch(`${P}/schedules/:scheduleId`, ...memberW, h(req => upkeep.updateSchedule(B(req), req.params.scheduleId, U(req), R(req), req.body)));
router.post(`${P}/schedules/:scheduleId/done`, ...memberW, h(req => upkeep.completeSchedule(B(req), req.params.scheduleId, U(req), R(req), req.body)));
router.post(`${P}/schedules/:scheduleId/book`, ...memberW, h(req => upkeep.bookOccurrence(B(req), req.params.scheduleId, U(req), R(req))));
router.get(`${P}/alerts`, ...member, h(req => upkeep.alerts(B(req), U(req), R(req))));
router.post(`${P}/alerts/notify`, ...adminW, h(req => upkeep.alerts(B(req), U(req), R(req), { notifyNow: true })));
// 331-335 turnover
router.get(`${P}/turnovers`, ...member, h(req => upkeep.turnoverBoard(B(req), U(req), R(req))));
router.post(`${P}/p/:propertyId/turnovers`, ...adminW, h(made(req => upkeep.startTurnover(B(req), req.params.propertyId, U(req), req.body))));
router.post(`${P}/turnovers/:turnoverId/steps/:step`, ...memberW, h(req => upkeep.updateStep(B(req), req.params.turnoverId, req.params.step, U(req), R(req), req.body)));
router.post(`${P}/turnovers/:turnoverId/close`, ...adminW, h(req => upkeep.closeTurnover(B(req), req.params.turnoverId, U(req), R(req), req.body)));
// 336-340 costs
router.get(`${P}/costs`, ...admin, h(req => upkeep.costs(B(req), req.query)));
router.post(`${P}/costs/alerts`, ...adminW, h(req => upkeep.budgetAlerts(B(req), req.query)));
router.get(`${P}/p/:propertyId/unit-spend`, ...admin, h(req => upkeep.unitSpend(B(req), req.params.propertyId, U(req), R(req), req.query)));
router.get(`${P}/invoices`, ...admin, h(req => upkeep.invoices(B(req), req.query)));
router.post(`${P}/invoices`, ...adminW, h(made(req => upkeep.addInvoice(B(req), U(req), req.body))));
router.post(`${P}/invoices/:invoiceId/decision`, ...adminW, h(req => upkeep.decideInvoice(B(req), req.params.invoiceId, U(req), req.body)));
// 341-345 incidents
router.post(`${P}/requests/:requestId/emergency`, ...memberW, h(req => work.routeEmergency(B(req), req.params.requestId, U(req), R(req))));
router.get(`${P}/p/:propertyId/incidents`, ...member, h(req => work.incidents(B(req), req.params.propertyId, U(req), R(req))));
router.post(`${P}/p/:propertyId/incidents`, ...memberW, h(made(req => work.createIncident(B(req), req.params.propertyId, U(req), R(req), req.body))));
router.patch(`${P}/incidents/:incidentId`, ...memberW, h(req => work.updateIncident(B(req), req.params.incidentId, U(req), R(req), req.body)));
router.post(`${P}/incidents/:incidentId/evidence`, ...memberW, h(req => work.addEvidence(B(req), req.params.incidentId, U(req), R(req), req.body)));
router.post(`${P}/incidents/:incidentId/share`, ...adminW, h(req => work.shareWithOwner(B(req), req.params.incidentId, U(req), R(req))));
// 346-350 transfer
router.get(`${P}/p/:propertyId/handover`, ...admin, h(req => portfolio.handoverExport(B(req), req.params.propertyId)));
router.post(`${P}/p/:propertyId/reassign`, ...adminW, h(req => portfolio.reassign(B(req), req.params.propertyId, U(req), req.body)));
router.post(`${P}/p/:propertyId/notify-occupants`, ...adminW, h(req => portfolio.notifyOccupants(B(req), req.params.propertyId, U(req))));
router.post(`${P}/p/:propertyId/revoke`, ...adminW, h(req => portfolio.revokeAccess(B(req), req.params.propertyId, U(req), req.body)));

// Property owner (317, 345) and occupant (323) surfaces; scoped to req.user.
const meRouter = express.Router();
meRouter.get('/approvals', authenticate, h(req => work.approvalInbox(U(req))));
meRouter.post('/approvals/:requestId', authenticate, rejectImpersonated, h(req => work.decideApproval(U(req), req.params.requestId, req.body)));
meRouter.get('/incidents', authenticate, h(req => work.ownerIncidents(U(req))));
meRouter.get('/entry/:requestId', authenticate, h(req => work.occupantEntry(U(req), req.params.requestId)));
meRouter.post('/entry/:requestId/window', authenticate, rejectImpersonated, h(req => work.selectWindow(U(req), req.params.requestId, req.body)));

module.exports = { router, meRouter };
