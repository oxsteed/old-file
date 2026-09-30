'use strict';

/**
 * server/routes/connector.js
 *
 * OxSteed connector API (mounted at /api/connector/v1 in server/index.js).
 *
 * Machine-facing admin surface authenticated by API key: the key must belong
 * to an active admin or super_admin (see server/middleware/connectorAuth.js).
 * Every route on this router runs through connectorAuth.
 */

const express = require('express');
const connectorAuth = require('../middleware/connectorAuth');
const connector = require('../controllers/connectorController');

const router = express.Router();

router.use(connectorAuth);

// Reads
router.get('/me', connector.getMe);
router.get('/bookings', connector.listBookings);
router.get('/bookings/:id', connector.getBooking);
router.get('/payouts', connector.listPayouts);
router.get('/reconciliation-exceptions', connector.listReconExceptions);
router.get('/incidents', connector.listIncidents);
router.get('/fraud-cases', connector.listFraudCases);
router.get('/settings-changes', connector.listSettingsChanges);

// Actions
router.post('/reconciliation-exceptions/:id/acknowledge', connector.acknowledgeReconException);
router.post('/reconciliation-exceptions/:id/assign', connector.assignReconException);
router.post('/reconciliation-exceptions/:id/resolve', connector.resolveReconException);
router.post('/dead-letters/:id/requeue', connector.requeueDeadLetter);
router.post('/webhooks/retry', connector.retryWebhook);
router.post('/settings-changes/:id/approve', connector.approveSettingsChange);
router.post('/settings-changes/:id/reject', connector.rejectSettingsChange);

module.exports = router;
