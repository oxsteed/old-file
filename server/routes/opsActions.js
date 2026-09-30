'use strict';

const express = require('express');
const { requireAdmin, requirePermission } = require('../middleware/adminAuth');
const opsActionsController = require('../controllers/opsActionsController');

const router = express.Router();

router.get(
  '/queues/dead-letter',
  requireAdmin,
  requirePermission('manage_operations'),
  opsActionsController.listDeadLetter
);

router.post(
  '/queues/dead-letter/:jobId/requeue',
  requireAdmin,
  requirePermission('manage_operations'),
  opsActionsController.requeueDeadLetter
);

router.post(
  '/webhooks/:deliveryId/retry',
  requireAdmin,
  requirePermission('manage_operations'),
  opsActionsController.retryWebhookDelivery
);

module.exports = router;
