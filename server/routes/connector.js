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
const { connectorAuth, requireConnectorGrant } = require('../middleware/connectorAuth');
const { connectorMutationLimiter } = require('../middleware/rateLimiter');
const connector = require('../controllers/connectorController');

const router = express.Router();

router.use(connectorAuth);

// Reads
router.get('/me', connector.getMe);
router.get('/bookings', connector.listBookings);
router.get('/bookings/:id', connector.getBooking);
router.get('/payouts', requireConnectorGrant('view_financials'), connector.listPayouts);
router.get('/reconciliation-exceptions', connector.listReconExceptions);
router.get('/incidents', connector.listIncidents);
router.get('/fraud-cases', requireConnectorGrant('view_financials'), connector.listFraudCases);
router.get('/settings-changes', connector.listSettingsChanges);

// Actions
// Grant mapping mirrors the interactive UI equivalents:
// - reconciliation exception lifecycle -> manage_operations (ops mutations)
// - dead-letter requeue + webhook retry  -> manage_operations (opsActions.js)
// - staged settings approve/reject       -> approve_settings (settingsChanges.js)
router.post('/reconciliation-exceptions/:id/acknowledge', connectorMutationLimiter, requireConnectorGrant('manage_operations'), connector.acknowledgeReconException);
router.post('/reconciliation-exceptions/:id/assign', connectorMutationLimiter, requireConnectorGrant('manage_operations'), connector.assignReconException);
router.post('/reconciliation-exceptions/:id/resolve', connectorMutationLimiter, requireConnectorGrant('manage_operations'), connector.resolveReconException);
router.post('/dead-letters/:id/requeue', connectorMutationLimiter, requireConnectorGrant('manage_operations'), connector.requeueDeadLetter);
router.post('/webhooks/retry', connectorMutationLimiter, requireConnectorGrant('manage_operations'), connector.retryWebhook);
router.post('/settings-changes/:id/approve', connectorMutationLimiter, requireConnectorGrant('approve_settings'), connector.approveSettingsChange);
router.post('/settings-changes/:id/reject', connectorMutationLimiter, requireConnectorGrant('approve_settings'), connector.rejectSettingsChange);

module.exports = router;
