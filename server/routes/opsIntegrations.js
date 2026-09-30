'use strict';

const express = require('express');
const { requireAdmin, requirePermission } = require('../middleware/adminAuth');
const opsIntegrationsController = require('../controllers/opsIntegrationsController');

const router = express.Router();

router.get(
  '/',
  requireAdmin,
  requirePermission('manage_operations'),
  opsIntegrationsController.listIntegrations
);

router.post(
  '/:id/test',
  requireAdmin,
  requirePermission('manage_operations'),
  opsIntegrationsController.testIntegration
);

router.post(
  '/:id/reconnect',
  requireAdmin,
  requirePermission('manage_operations'),
  opsIntegrationsController.reconnectIntegration
);

module.exports = router;
