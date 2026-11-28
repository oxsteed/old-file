'use strict';

const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { rejectImpersonated } = require('../middleware/rejectImpersonated');
const { requireInternalLogisticsWorkspace } = require('../middleware/requireInternalLogisticsWorkspace');
const controller = require('../controllers/localDeliveryController');
const proofController = require('../controllers/localDeliveryProofController');
const itemPhotoController = require('../controllers/localDeliveryItemPhotoController');
const trackingOpsController = require('../controllers/deliveryTrackingOpsController');
const trackingLinkController = require('../controllers/deliveryTrackingLinkController');
const upload = require('../middleware/upload');
const validateFileUpload = require('../middleware/validateFileUpload');
const { authenticatedLimiter, generalLimiter, strictLimiter, deliveryPublicEstimateLimiter } = require('../middleware/rateLimiter');
const { verifyCaptcha, captchaClientConfig } = require('../middleware/verifyCaptcha');
const checkRestrictions = require('../middleware/checkRestrictions');

const router = express.Router();
router.use(authenticatedLimiter);

router.post('/quote', requireAuth, controller.quote);
router.post('/estimate', requireAuth, controller.estimate);
// Signed-out instant estimate: strict per-IP limit, bot-check hook (off until
// CAPTCHA_ENABLED), no auth, nothing stored.
router.get('/public/captcha-config', generalLimiter, (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ success: true, captcha: captchaClientConfig() });
});
router.post('/public/estimate', deliveryPublicEstimateLimiter, verifyCaptcha, controller.publicEstimate);
router.post('/jobs', requireAuth, controller.create);
router.get('/jobs', requireAuth, controller.list);
router.get('/jobs/:id', requireAuth, controller.get);
// Review P2-7-F07: checkout surfaces honor admin checkout restrictions.
router.post('/jobs/:id/checkout', strictLimiter, requireAuth, rejectImpersonated, checkRestrictions('checkout'), controller.createBaseCheckout);
router.post('/jobs/:id/proof-upload', requireAuth, rejectImpersonated, proofController.uploadGuard, upload.single('image'), validateFileUpload, proofController.upload);
// Item photos: customer-uploaded pictures of the item, after posting and
// before pickup. Separate from the proof-photo path (see
// localDeliveryItemPhotoController).
router.post('/jobs/:id/item-photo', requireAuth, rejectImpersonated, itemPhotoController.uploadGuard, upload.single('image'), validateFileUpload, itemPhotoController.upload);
router.get('/jobs/:id/item-photos', requireAuth, itemPhotoController.list);
router.post('/jobs/:id/proof-pin', requireAuth, rejectImpersonated, proofController.rotatePin);
router.get('/jobs/:id/proofs/:proofId', requireAuth, proofController.download);
router.post('/jobs/:id/claim', requireAuth, rejectImpersonated, controller.claim);
// Group 9 Slice F (items 488-490/494): the per-shipment exception
// summary, the authorized document list, the OxSteed delivery
// receipt, and the driver dispute flow. Same /delivery router as the
// other job routes, not a tenant route.
router.get('/jobs/:id/exceptions', requireAuth, controller.getJobExceptions);
router.get('/jobs/:id/documents', requireAuth, controller.listJobDocuments);
router.get('/jobs/:id/receipt', requireAuth, controller.downloadJobReceipt);
router.post('/jobs/:id/disputes', requireAuth, rejectImpersonated, controller.createDispute);
router.get('/jobs/:id/disputes', requireAuth, controller.listJobDisputes);
// Group 9 Slice C (item 462): the multi-stop sequence. List is readable
// by any authorized reader (marketplace drivers get the masked
// projection); adding is the shipper before pickup, reordering and
// completing are the assigned driver. Same /delivery router as the
// other job routes, not a tenant route.
router.get('/jobs/:id/stops', requireAuth, controller.listStops);
router.post('/jobs/:id/stops', requireAuth, rejectImpersonated, controller.addStop);
router.post('/jobs/:id/stops/reorder', requireAuth, rejectImpersonated, controller.reorderStops);
router.post('/jobs/:id/stops/:stopId/complete', requireAuth, rejectImpersonated, controller.completeStop);
// Group 9 partials Wave 2 Batch O (462/464, G9-A13, D-543): the driver
// note on a stop — route notes are no longer view-only.
router.post('/jobs/:id/stops/:stopId/note', requireAuth, rejectImpersonated, controller.updateStopNote);
// Group 9 partials Wave 2 Batch O (469, G9-A10, D-545): the free
// waiting notice, alongside the chargeable waiting extra.
router.post('/jobs/:id/waiting-notices', requireAuth, rejectImpersonated, controller.createWaitingNotice);
// Group 9 partials Wave 2 Batch O (470/475, G9-A7, D-547): the driver
// resume after ops ack, and the redelivery-attempt request (475,
// G9-A11, D-548) with ops-or-shipper review.
router.post('/jobs/:id/resume', requireAuth, rejectImpersonated, controller.resumeDelivery);
router.post('/jobs/:id/redelivery-requests', requireAuth, rejectImpersonated, controller.requestRedelivery);
router.patch('/jobs/:id/redelivery-requests/:requestId', requireAuth, rejectImpersonated, controller.reviewRedelivery);
// Group 9 Slice B (item 460): a driver passes on a marketplace offer
// with a reason code. Advisory only; it never blocks claiming.
router.post('/jobs/:id/decline', requireAuth, rejectImpersonated, controller.decline);
// P2-4-F10: self-serve driver onboarding (profile starts pending ops approval).
router.post('/driver-profile', requireAuth, rejectImpersonated, controller.selfServeDriverOnboarding);
router.patch('/driver-profile', requireAuth, rejectImpersonated, controller.updateOwnDriverProfile);
router.get('/driver-profile', requireAuth, controller.getDriverProfile);
// Item 12: the driver toggles their own availability flag.
router.patch('/driver-profile/availability', requireAuth, rejectImpersonated, controller.setDriverAvailability);
// Group 9 Slice A: assignment readiness checklist (455) reuses the server
// readiness gate read-only; no jobId checks the profile itself.
router.get('/driver-profile/readiness', requireAuth, controller.getDriverReadiness);
// Group 9 Slice A: driver-owned vehicles (452) and documents (453).
router.get('/driver-vehicles', requireAuth, controller.listDriverVehicles);
router.post('/driver-vehicles', requireAuth, rejectImpersonated, controller.createDriverVehicle);
router.patch('/driver-vehicles/:vehicleId', requireAuth, rejectImpersonated, controller.updateDriverVehicle);
router.delete('/driver-vehicles/:vehicleId', requireAuth, rejectImpersonated, controller.deleteDriverVehicle);
router.post('/driver-vehicles/:vehicleId/activate', requireAuth, rejectImpersonated, controller.activateDriverVehicle);
router.get('/driver-documents', requireAuth, controller.listDriverDocuments);
router.post('/driver-documents', requireAuth, rejectImpersonated, controller.createDriverDocument);
router.patch('/driver-documents/:documentId', requireAuth, rejectImpersonated, controller.updateDriverDocument);
router.delete('/driver-documents/:documentId', requireAuth, rejectImpersonated, controller.deleteDriverDocument);
// P2-4-F04: driver payout lifecycle (accrue on delivery; ops approves/pays).
router.get('/driver-payouts', requireAuth, controller.listDriverPayouts);
// Group 14 Slice 5j (747, D-790): single-payout detail read.
router.get('/driver-payouts/:payoutId', requireAuth, controller.getDriverPayout);
// Group 9 Slice F (items 494/495): the driver's own disputes and
// weekly work reports. Same /delivery router, not a tenant route.
router.get('/driver-disputes', requireAuth, controller.listMyDisputes);
router.get('/weekly-report', requireAuth, controller.listMyWeeklyReports);
router.get('/weekly-report/:id', requireAuth, controller.getMyWeeklyReport);
router.get('/weekly-report/:id/download', requireAuth, controller.downloadMyWeeklyReport);
// Group 9 Slice G (item 500): driver shifts and shift closeout.
// Same /delivery router as the weekly reports, not a tenant route.
router.post('/driver-shifts', requireAuth, rejectImpersonated, controller.startDriverShift);
router.get('/driver-shifts/open', requireAuth, controller.getOpenDriverShift);
router.get('/driver-shifts', requireAuth, controller.listDriverShifts);
router.get('/driver-shifts/:id', requireAuth, controller.getDriverShift);
router.post('/driver-shifts/:id/closeout', requireAuth, rejectImpersonated, controller.closeDriverShift);
router.patch('/jobs/:id/status', requireAuth, rejectImpersonated, controller.updateStatus);
router.post('/jobs/:id/issues', requireAuth, rejectImpersonated, controller.createIssue);
router.post('/jobs/:id/extras', requireAuth, rejectImpersonated, controller.createExtra);
router.post('/jobs/:id/reschedule-requests', requireAuth, rejectImpersonated, controller.requestReschedule);
router.post('/jobs/:id/return-requests', requireAuth, rejectImpersonated, controller.requestReturn);
router.patch('/extras/:extraId', requireAuth, rejectImpersonated, controller.reviewExtra);
router.post('/extras/:extraId/checkout', strictLimiter, requireAuth, rejectImpersonated, checkRestrictions('checkout'), controller.createExtraCheckout);
router.post('/payments/:paymentId/sync', requireAuth, rejectImpersonated, controller.syncExtraPayment);
router.post('/extras/:extraId/payment-sync', requireAuth, rejectImpersonated, controller.syncExtraPayment);

const requireOperationsWorkspace = requireInternalLogisticsWorkspace('operations');
router.post('/internal/payments/:paymentId/refund', requireAuth, rejectImpersonated, requireOperationsWorkspace, controller.refundPayment);
router.get('/internal/queue', requireAuth, requireOperationsWorkspace, controller.internalQueue);
router.get('/internal/jobs/:id', requireAuth, requireOperationsWorkspace, controller.getInternalJob);
// Group 9 Slice E (item 484): the handoff state record, per job and per
// driver. Same /delivery router as the other internal routes, not a
// tenant route.
router.get('/internal/jobs/:id/handoffs', requireAuth, requireOperationsWorkspace, controller.internalHandoffs);
router.get('/internal/handoffs', requireAuth, requireOperationsWorkspace, controller.internalDriverHandoffs);
router.get('/internal/vehicles', requireAuth, requireOperationsWorkspace, controller.internalVehicles);
router.post('/internal/vehicles', requireAuth, requireOperationsWorkspace, controller.createVehicle);
router.get('/internal/drivers', requireAuth, requireOperationsWorkspace, controller.internalDrivers);
router.post('/internal/drivers', requireAuth, requireOperationsWorkspace, controller.upsertDriver);
// P2-4-F04: ops driver-payout management. Paid state requires a payment
// reference (fails closed).
router.get('/internal/driver-payouts', requireAuth, requireOperationsWorkspace, controller.listAllDriverPayouts);
// Group 14 Slice 5j (747, D-790): single-payout detail read for ops.
router.get('/internal/driver-payouts/:payoutId', requireAuth, requireOperationsWorkspace, controller.getInternalDriverPayout);
router.post('/internal/driver-payouts/:payoutId/approve', requireAuth, rejectImpersonated, requireOperationsWorkspace, controller.approveDriverPayout);
router.post('/internal/driver-payouts/:payoutId/mark-paid', requireAuth, rejectImpersonated, requireOperationsWorkspace, controller.markDriverPayoutPaid);
router.post('/internal/driver-payouts/:payoutId/void', requireAuth, rejectImpersonated, requireOperationsWorkspace, controller.voidDriverPayout);
// Group 9 Slice F (items 488/493/494): ops adjusts a payout amount
// with a persisted reason, reviews disputes, and sees the aggregate
// exceptions view. Same /delivery router, not a tenant route.
router.post('/internal/driver-payouts/:payoutId/adjust', requireAuth, rejectImpersonated, requireOperationsWorkspace, controller.adjustDriverPayout);
router.get('/internal/disputes', requireAuth, requireOperationsWorkspace, controller.listInternalDisputes);
router.patch('/internal/disputes/:disputeId', requireAuth, rejectImpersonated, requireOperationsWorkspace, controller.resolveDispute);
router.get('/internal/exceptions', requireAuth, requireOperationsWorkspace, controller.getInternalExceptions);
router.post('/internal/jobs/:id/assign', requireAuth, requireOperationsWorkspace, controller.assignInternal);
router.post('/internal/jobs/:id/release-marketplace', requireAuth, requireOperationsWorkspace, controller.releaseMarketplace);
// Group 9 partials Wave 2 Batch P (482, G9-B4, D-555): mid-route transfer
// of a picked-up job to another internal driver.
router.post('/internal/jobs/:id/transfer', requireAuth, requireOperationsWorkspace, controller.transferAssignment);
router.patch('/internal/reschedule-requests/:requestId', requireAuth, requireOperationsWorkspace, controller.reviewReschedule);
router.patch('/internal/returns/:returnId', requireAuth, requireOperationsWorkspace, controller.reviewReturn);
router.patch('/internal/issues/:issueId/resolve', requireAuth, requireOperationsWorkspace, controller.resolveIssue);
// Group 9 partials Wave 2 Batch O (475, G9-A11, D-548): ops reviews a
// redelivery-attempt request on the internal route; the shipper uses
// the participant route above. Same handler, same fail-closed checks.
router.patch('/internal/redelivery-requests/:requestId', requireAuth, requireOperationsWorkspace, controller.reviewRedelivery);

// Customer tracking links: signed, expiring tokens for recipients without an
// OxSteed account. Management endpoints are owner-or-ops; the public
// tracking endpoint is unauthenticated (rate-limited, non-enumerable).
router.post('/jobs/:id/tracking/links', requireAuth, trackingLinkController.create);
router.get('/jobs/:id/tracking/links', requireAuth, trackingLinkController.list);
router.post('/jobs/:id/tracking/links/:linkId/revoke', requireAuth, trackingLinkController.revoke);
router.post('/jobs/:id/tracking/links/:linkId/refresh', requireAuth, trackingLinkController.refresh);
router.get('/jobs/:id/tracking/customer-state', requireAuth, trackingLinkController.customerState);
router.get('/t/public/:token', generalLimiter, trackingLinkController.publicTrack);

const trackingController = require('../controllers/deliveryTrackingController');
router.post('/jobs/:id/tracking/consent', requireAuth, trackingController.grantConsent);
router.delete('/jobs/:id/tracking/consent', requireAuth, trackingController.revokeConsent);
router.post('/jobs/:id/tracking/start', requireAuth, trackingController.startTracking);
router.post('/jobs/:id/tracking/pause', requireAuth, trackingController.pauseTracking);
router.post('/jobs/:id/tracking/resume', requireAuth, trackingController.resumeTracking);
router.post('/jobs/:id/tracking/stop', requireAuth, trackingController.stopTracking);
router.post('/jobs/:id/tracking/locations', requireAuth, trackingController.ingestLocations);
router.post('/jobs/:id/tracking/scans', requireAuth, trackingController.recordScan);
router.get('/jobs/:id/tracking/scans', requireAuth, trackingController.listScans);
router.get('/jobs/:id/tracking/status', requireAuth, trackingController.getStatus);
router.post('/tracking/devices', requireAuth, trackingController.registerDevice);
router.get('/tracking/devices', requireAuth, trackingController.listDevices);
// Group 9 Slice G (item 499): device-change recovery. The driver
// registers a new phone from the driver screens; the server moves
// the live tracking assignments and consent to it and revokes the
// old device. Same /delivery router, not a tenant route.
router.post('/tracking/devices/transfer', requireAuth, rejectImpersonated, trackingController.transferDevice);
// Group 9 partials Wave 2 Batch Q (499, G9-B7, D-562): the lost-device
// report. The driver records the stranded queue counts from the
// device being abandoned, before the revoke (DELETE below) lands.
router.post('/tracking/devices/strands', requireAuth, rejectImpersonated, trackingController.reportDeviceStrands);
router.patch('/tracking/devices/:deviceId', requireAuth, trackingController.updateDevice);
router.delete('/tracking/devices/:deviceId', requireAuth, trackingController.updateDevice);

// ── Delivery tracking: operations API (integration plan) ──
router.get('/internal/jobs/:id/tracking/exact', requireAuth, requireOperationsWorkspace, trackingOpsController.getExactTracking);
router.get('/internal/tracking/review-queue', requireAuth, requireOperationsWorkspace, trackingOpsController.getReviewQueue);
// Group 9 partials Wave 2 Batch Q (499, G9-B7, D-562): the ops
// reconcile queue for stranded device-transfer work, and the
// per-row reconcile decision.
router.get('/internal/tracking/device-strands', requireAuth, requireOperationsWorkspace, trackingOpsController.listDeviceStrands);
router.post('/internal/tracking/device-strands/:strandId/reconcile', requireAuth, requireOperationsWorkspace, trackingOpsController.reconcileDeviceStrand);
router.patch('/internal/tracking/points/:pointId', requireAuth, requireOperationsWorkspace, trackingOpsController.reviewPoint);
router.post('/internal/telematics/connections', requireAuth, requireOperationsWorkspace, trackingOpsController.createTelematicsConnection);
router.get('/internal/telematics/connections', requireAuth, requireOperationsWorkspace, trackingOpsController.listTelematicsConnections);
router.post('/internal/telematics/connections/:id/pause', requireAuth, requireOperationsWorkspace, trackingOpsController.pauseTelematicsConnection);
router.post('/internal/telematics/connections/:id/resume', requireAuth, requireOperationsWorkspace, trackingOpsController.resumeTelematicsConnection);
router.post('/internal/telematics/connections/:id/revoke', requireAuth, requireOperationsWorkspace, trackingOpsController.revokeTelematicsConnection);
router.post('/internal/telematics/connections/:id/reconcile', requireAuth, requireOperationsWorkspace, trackingOpsController.reconcileTelematicsConnection);
router.post('/internal/tracking/eta/:id/refresh', requireAuth, requireOperationsWorkspace, trackingOpsController.refreshEta);
router.get('/internal/jobs/:id/tracking/geofences', requireAuth, requireOperationsWorkspace, trackingOpsController.getGeofences);
router.get('/internal/jobs/:id/tracking/eta-history', requireAuth, requireOperationsWorkspace, trackingOpsController.getEtaHistory);

// NOTE: the public telematics provider webhook
// (POST /api/delivery/webhooks/telematics/:provider) is mounted in
// server/index.js BEFORE express.json() with express.raw() so the exact
// request bytes survive for HMAC verification. It is intentionally NOT
// registered on this router.

module.exports = router;
