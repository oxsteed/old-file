'use strict';

const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { requireInternalLogisticsWorkspace } = require('../middleware/requireInternalLogisticsWorkspace');
const controller = require('../controllers/localDeliveryController');
const proofController = require('../controllers/localDeliveryProofController');
const upload = require('../middleware/upload');
const validateFileUpload = require('../middleware/validateFileUpload');
const { authenticatedLimiter } = require('../middleware/rateLimiter');

const router = express.Router();
router.use(authenticatedLimiter);

router.post('/quote', requireAuth, controller.quote);
router.post('/jobs', requireAuth, controller.create);
router.get('/jobs', requireAuth, controller.list);
router.get('/jobs/:id', requireAuth, controller.get);
router.post('/jobs/:id/checkout', requireAuth, controller.createBaseCheckout);
router.post('/jobs/:id/proof-upload', requireAuth, proofController.uploadGuard, upload.single('image'), validateFileUpload, proofController.upload);
router.post('/jobs/:id/proof-pin', requireAuth, proofController.rotatePin);
router.get('/jobs/:id/proofs/:proofId', requireAuth, proofController.download);
router.post('/jobs/:id/claim', requireAuth, controller.claim);
router.patch('/jobs/:id/status', requireAuth, controller.updateStatus);
router.post('/jobs/:id/issues', requireAuth, controller.createIssue);
router.post('/jobs/:id/extras', requireAuth, controller.createExtra);
router.post('/jobs/:id/reschedule-requests', requireAuth, controller.requestReschedule);
router.post('/jobs/:id/return-requests', requireAuth, controller.requestReturn);
router.patch('/extras/:extraId', requireAuth, controller.reviewExtra);
router.post('/extras/:extraId/checkout', requireAuth, controller.createExtraCheckout);
router.post('/payments/:paymentId/sync', requireAuth, controller.syncExtraPayment);
router.post('/extras/:extraId/payment-sync', requireAuth, controller.syncExtraPayment);

const requireOperationsWorkspace = requireInternalLogisticsWorkspace('operations');
router.post('/internal/payments/:paymentId/refund', requireAuth, requireOperationsWorkspace, controller.refundPayment);
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

module.exports = router;
