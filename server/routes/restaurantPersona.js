'use strict';
// Group 8 (items 351-450): restaurant owner/manager operations (/ops) and
// team member shift tools (/shift). Mounted at /api/restaurants. Every
// :restaurantId route runs the canonical restaurant gate; services re-resolve
// role, catalog permissions and store scope on each call.
const express = require('express');
const { authenticate } = require('../middleware/auth');
const { rejectImpersonated } = require('../middleware/rejectImpersonated');
const { requireRestaurantAccess, scopeExempt } = require('../middleware/scopeGates');
const { rctx } = require('../services/restaurantPersona/access');
const ops = require('../services/restaurantPersona/ownerService');
const team = require('../services/restaurantPersona/teamService');

const send = fn => async (req, res, next) => { res.set('Cache-Control', 'no-store'); try { const out = await fn(req); res.status(req.method === 'POST' && req.created ? 201 : 200).json(out); } catch (e) { next(e); } };
// Authenticated restaurant handler: c = live restaurant context.
const r = fn => send(async req => fn(await rctx(req.user.id, req.params.restaurantId), req));
const made = fn => async (c, req) => { req.created = true; return fn(c, req); };
const G = [authenticate, requireRestaurantAccess()];
const W = [authenticate, rejectImpersonated, requireRestaurantAccess()];

const router = express.Router();
const O = '/:restaurantId/ops';
// 353, 354, 396 readiness; 397 template
router.get(`${O}/locations/:locationId/readiness`, ...G, r((c, q) => ops.readiness(c, q.params.locationId)));
router.post(`${O}/locations/:locationId/readiness/:key`, ...W, r((c, q) => ops.setReadinessCheck(c, q.params.locationId, q.params.key, q.body)));
router.post(`${O}/locations/:locationId/launch`, ...W, r((c, q) => ops.launch(c, q.params.locationId)));
router.post(`${O}/locations/:locationId/copy-settings`, ...W, r((c, q) => ops.copySettings(c, q.params.locationId, q.body)));
// 370, 372, 374, 377 ops settings; 369 special hours
router.get(`${O}/locations/:locationId/settings`, ...G, r((c, q) => ops.opsSettings(c, q.params.locationId)));
router.patch(`${O}/locations/:locationId/settings`, ...W, r((c, q) => ops.updateOpsSettings(c, q.params.locationId, q.body)));
router.get(`${O}/locations/:locationId/special-hours`, ...G, r((c, q) => ops.specialHours(c, q.params.locationId)));
router.put(`${O}/locations/:locationId/special-hours`, ...W, r((c, q) => ops.setSpecialHours(c, q.params.locationId, q.body)));
router.delete(`${O}/special-hours/:id`, ...W, r((c, q) => ops.deleteSpecialHours(c, q.params.id)));
// 356, 358, 360 menu
router.post(`${O}/menu/import`, ...W, r((c, q) => ops.importMenu(c, q.body)));
router.get(`${O}/menu/scheduled`, ...G, r(c => ops.scheduledChanges(c)));
router.post(`${O}/menu/scheduled`, ...W, r(made((c, q) => ops.scheduleMenuChange(c, q.body))));
router.delete(`${O}/menu/scheduled/:id`, ...W, r((c, q) => ops.cancelMenuChange(c, q.params.id)));
router.get(`${O}/menu/history`, ...G, r((c, q) => ops.menuHistory(c, q.query)));
// 372, 375, 379, 386-389, 398 reports
router.get(`${O}/unclaimed-pickups`, ...G, r((c, q) => ops.unclaimed(c, q.query)));
router.post(`${O}/unclaimed-pickups/alert`, ...W, r(c => ops.alertUnclaimed(c)));
router.get(`${O}/cancellations`, ...G, r((c, q) => ops.cancellations(c, q.query)));
router.post(`${O}/cancellations/:orderId/follow-up`, ...W, r((c, q) => ops.followUpCancellation(c, q.params.orderId, q.body)));
router.get(`${O}/reports/dispatch-delays`, ...G, r((c, q) => ops.dispatchDelays(c, q.query)));
router.get(`${O}/reports/prep-trends`, ...G, r((c, q) => ops.prepTrends(c, q.query)));
router.get(`${O}/reports/unavailability`, ...G, r((c, q) => ops.unavailability(c, q.query)));
router.get(`${O}/reports/peak-load`, ...G, r((c, q) => ops.peakLoad(c, q.query)));
router.get(`${O}/reports/repeat-issues`, ...G, r((c, q) => ops.repeatIssues(c, q.query)));
router.get(`${O}/reports/capacity-forecast`, ...G, r((c, q) => ops.capacityForecast(c, q.query)));
// 391, 440, 442 equipment downtime
router.get(`${O}/downtime`, ...G, r((c, q) => ops.downtimeList(c, q.query)));
router.post(`${O}/downtime`, ...W, r(made((c, q) => ops.reportDowntime(c, q.body))));
router.post(`${O}/downtime/:id/restore`, ...W, r((c, q) => ops.restoreDowntime(c, q.params.id, q.body)));
// 392 transfers; 393-395 emergency closure
router.get(`${O}/transfers`, ...G, r(c => ops.transfers(c)));
router.post(`${O}/transfers`, ...W, r(made((c, q) => ops.requestTransfer(c, q.body))));
router.post(`${O}/transfers/:id/decision`, ...W, r((c, q) => ops.decideTransfer(c, q.params.id, q.body)));
router.post(`${O}/emergency-closures`, ...W, r(made((c, q) => ops.emergencyClose(c, q.body))));
router.get(`${O}/locations/:locationId/closure`, ...G, r((c, q) => ops.currentClosure(c, q.params.locationId)));
router.post(`${O}/locations/:locationId/closure/checks/:key`, ...W, r((c, q) => ops.setReopenCheck(c, q.params.locationId, q.params.key, q.body)));
router.post(`${O}/locations/:locationId/reopen`, ...W, r((c, q) => ops.reopen(c, q.params.locationId)));
// 431 kitchen ticket queue (D-440): open tickets with per-item stations.
router.get(`${O}/tickets`, ...G, r((c, q) => ops.kitchenTickets(c, q.query)));

const S = '/:restaurantId/shift';
// 401-405 start of shift
router.get(`${S}`, ...G, r(c => team.brief(c)));
router.post(`${S}/start`, ...W, r((c, q) => team.startShift(c, q.body)));
router.post(`${S}/station`, ...W, r((c, q) => team.assignStation(c, q.body)));
router.post(`${S}/readiness`, ...W, r((c, q) => team.acknowledgeReadiness(c, q.body)));
// 409, 432-438 tickets, stations, breaks
router.post(`${S}/print-batch`, ...W, r((c, q) => team.batchPrint(c, q.body)));
router.get(`${S}/orders/:orderId/ticket`, ...G, r((c, q) => team.ticketHistory(c, q.params.orderId)));
router.post(`${S}/orders/:orderId/handoff`, ...W, r(made((c, q) => team.handoff(c, q.params.orderId, q.body))));
router.post(`${S}/orders/:orderId/pack/:key`, ...W, r((c, q) => team.setPack(c, q.params.orderId, q.params.key, q.body)));
router.post(`${S}/break/start`, ...W, r(c => team.startBreak(c)));
router.post(`${S}/break/end`, ...W, r(c => team.endBreak(c)));
// 413-415, 448 stock notices
router.get(`${S}/stock-notices`, ...G, r((c, q) => team.stockNotices(c, q.query)));
router.post(`${S}/stock-notices`, ...W, r(made((c, q) => team.createStockNotice(c, q.body))));
router.patch(`${S}/stock-notices/:id`, ...W, r((c, q) => team.updateStockNotice(c, q.params.id, q.body)));
// 416-418 pickup
router.get(`${S}/orders/:orderId/label`, ...G, r((c, q) => team.packageLabel(c, q.params.orderId)));
router.post(`${S}/orders/:orderId/pickup-code`, ...W, r((c, q) => team.verifyPickupCode(c, q.params.orderId, q.body)));
router.get(`${S}/driver-arrivals`, ...G, r((c, q) => team.driverArrivals(c, q.query)));
// 421-425 order issues
router.get(`${S}/issues`, ...G, r((c, q) => team.issues(c, q.query)));
router.post(`${S}/orders/:orderId/issues`, ...W, r(made((c, q) => team.reportIssue(c, q.params.orderId, q.body))));
router.post(`${S}/issues/:id/escalate`, ...W, r((c, q) => team.escalateIssue(c, q.params.id)));
router.post(`${S}/issues/:id/resolve`, ...W, r((c, q) => team.resolveIssue(c, q.params.id, q.body)));
router.get(`${S}/late-orders`, ...G, r(c => team.lateOrders(c)));
// 441, 444, 445 incidents
router.get(`${S}/incidents`, ...G, r((c, q) => team.incidents(c, q.query)));
router.post(`${S}/incidents`, ...W, r(made((c, q) => team.createIncident(c, q.body))));
router.patch(`${S}/incidents/:id`, ...W, r((c, q) => team.updateIncident(c, q.params.id, q.body)));
// 446-449 end of shift
router.get(`${S}/end`, ...G, r(c => team.endShiftPreview(c)));
router.post(`${S}/end`, ...W, r((c, q) => team.endShift(c, q.body)));
// 450 manager view: access-change releases at the caller's stores.
router.get(`${S}/access-recovery`, ...G, r(c => team.accessRecovery(c)));

// 450 access-change recovery (no restaurant gate: the caller may have lost it)
router.get('/me/shift-access', authenticate, send(req => team.accessStatus(req.user.id)));
router.post('/me/shift-access/recover', authenticate, rejectImpersonated, send(req => team.recoverAccess(req.user.id)));
// 370, 377 public pickup info + slot availability; 425 customer answer
router.get('/:restaurantId/locations/:locationId/pickup-info', scopeExempt('public-storefront'), send(req => ops.pickupInfo(req.params.restaurantId, req.params.locationId)));
router.get('/:restaurantId/locations/:locationId/pickup-slots', scopeExempt('public-storefront'), send(req => ops.slots(req.params.restaurantId, req.params.locationId, req.query.date)));
router.post('/my/order-questions/:issueId', authenticate, rejectImpersonated, send(req => team.customerRespond({ userId: req.user.id }, req.params.issueId, req.body)));

module.exports = router;
