'use strict';

const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const requireBusinessAccess = require('../middleware/requireBusinessAccess');
const ctrl = require('../controllers/businessIntegrationsController');

// GET /:businessId/integrations — read-only, any member
router.get(
  '/:businessId/integrations',
  requireAuth,
  requireBusinessAccess({ minRole: 'any' }),
  ctrl.getIntegrations
);

// GET /:businessId/webhooks — any member
router.get(
  '/:businessId/webhooks',
  requireAuth,
  requireBusinessAccess({ minRole: 'any' }),
  ctrl.listWebhooks
);

// POST /:businessId/webhooks — manager+
router.post(
  '/:businessId/webhooks',
  requireAuth,
  requireBusinessAccess({ minRole: 'manager' }),
  ctrl.createWebhook
);

// DELETE /:businessId/webhooks/:webhookId — manager+
router.delete(
  '/:businessId/webhooks/:webhookId',
  requireAuth,
  requireBusinessAccess({ minRole: 'manager' }),
  ctrl.deleteWebhook
);

// POST /:businessId/integrations/api-key/regenerate — owner only
router.post(
  '/:businessId/integrations/api-key/regenerate',
  requireAuth,
  requireBusinessAccess({ minRole: 'owner' }),
  ctrl.regenerateApiKey
);

// PATCH /:businessId/integrations/:integrationType — manager+
router.patch(
  '/:businessId/integrations/:integrationType',
  requireAuth,
  requireBusinessAccess({ minRole: 'manager' }),
  ctrl.updateIntegration
);

// POST /:businessId/integrations/stripe/auth — owner only
router.post(
  '/:businessId/integrations/stripe/auth',
  requireAuth,
  requireBusinessAccess({ minRole: 'owner' }),
  ctrl.stripeAuthUrl
);

// POST /:businessId/integrations/stripe/disconnect — owner only
router.post(
  '/:businessId/integrations/stripe/disconnect',
  requireAuth,
  requireBusinessAccess({ minRole: 'owner' }),
  ctrl.disconnectStripe
);

module.exports = router;
