'use strict';

const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { rejectImpersonated } = require('../middleware/rejectImpersonated');
const { requireInternalLogisticsWorkspace } = require('../middleware/requireInternalLogisticsWorkspace');
const controller = require('../controllers/localDeliveryController');
const proofController = require('../controllers/localDeliveryProofController');
const trackingOpsController = require('../controllers/deliveryTrackingOpsController');
const trackingLinkController = require('../controllers/deliveryTrackingLinkController');
const upload = require('../middleware/upload');
const validateFileUpload = require('../middleware/validateFileUpload');
const { authenticatedLimiter, generalLimiter } = require('../middleware/rateLimiter');

const router = express.Router();
router.use(authenticatedLimiter);

router.post('/quote', requireAuth, controller.quote);
router.post('/jobs', requireAuth, controller.create);
router.get('/jobs', requireAuth, controller.list);
router.get('/jobs/:id', requireAuth, controller.get);
router.post('/jobs/:id/checkout', requireAuth, rejectImpersonated, controller.createBaseCheckout);
router.post('/jobs/:id/proof-upload', requireAuth, rejectImpersonated, proofController.uploadGuard, upload.single('image'), validateFileUpload, proofController.upload);
router.post('/jobs/:id/proof-pin', requireAuth, rejectImpersonated, proofController.rotatePin);
router.get('/jobs/:id/proofs/:proofId', requireAuth, proofController.download);
router.post('/jobs/:id/claim', requireAuth, rejectImpersonated, controller.claim);
router.patch('/jobs/:id/status', requireAuth, rejectImpersonated, controller.updateStatus);
router.post('/jobs/:id/issues', requireAuth, rejectImpersonated, controller.createIssue);
router.post('/jobs/:id/extras', requireAuth, rejectImpersonated, controller.createExtra);
router.post('/jobs/:id/reschedule-requests', requireAuth, rejectImpersonated, controller.requestReschedule);
router.post('/jobs/:id/return-requests', requireAuth, rejectImpersonated, controller.requestReturn);
router.patch('/extras/:extraId', requireAuth, rejectImpersonated, controller.reviewExtra);
router.post('/extras/:extraId/checkout', requireAuth, rejectImpersonated, controller.createExtraCheckout);
router.post('/payments/:paymentId/sync', requireAuth, rejectImpersonated, controller.syncExtraPayment);
router.post('/extras/:extraId/payment-sync', requireAuth, rejectImpersonated, controller.syncExtraPayment);

const requireOperationsWorkspace = requireInternalLogisticsWorkspace('operations');
router.post('/internal/payments/:paymentId/refund', requireAuth, rejectImpersonated, requireOperationsWorkspace, controller.refundPayment);
router.get('/internal/queue', requireAuth, requireOperationsWorkspace, controller.internalQueue);
router.get('/internal/jobs/:id', requireAuth, requireOperationsWorkspace, controller.getInternalJob);
router.get('/internal/vehicles', requireAuth, requireOperationsWorkspace, controller.internalVehicles);
router.post('/internal/vehicles', requireAuth, requireOperationsWorkspace, controller.createVehicle);
router.get('/internal/drivers', requireAuth, requireOperationsWorkspace, controller.internalDrivers);
router.post('/internal/drivers', requireAuth, requireOperationsWorkspace, controller.upsertDriver);
router.post('/internal/jobs/:id/assign', requireAuth, requireOperationsWorkspace, controller.assignInternal);
router.post('/internal/jobs/:id/release-marketplace', requireAuth, requireOperationsWorkspace, controller.releaseMarketplace);
router.patch('/internal/reschedule-requests/:requestId', requireAuth, requireOperationsWorkspace, controller.reviewReschedule);
router.patch('/internal/returns/:returnId', requireAuth, requireOperationsWorkspace, controller.reviewReturn);
router.patch('/internal/issues/:issueId/resolve', requireAuth, requireOperationsWorkspace, controller.resolveIssue);

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

// ── Delivery tracking: operations API (integration plan) ──
router.get('/internal/jobs/:id/tracking/exact', requireAuth, requireOperationsWorkspace, trackingOpsController.getExactTracking);
router.get('/internal/tracking/review-queue', requireAuth, requireOperationsWorkspace, trackingOpsController.getReviewQueue);
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
