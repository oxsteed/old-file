'use strict';

const express = require('express');
const router = express.Router();
const { scopeExempt } = require('../middleware/scopeGates');
const { requireAuth } = require('../middleware/auth');
const requireBusinessAccess = require('../middleware/requireBusinessAccess');
const ctrl = require('../controllers/businessIntegrationsController');
// WP-056: integration status, Stripe account ids and webhook URLs are
// sensitive settings, not public brand data — reading them needs
// settings.integrations (the hub tab's gate), not just membership.
const requirePermission = require('../middleware/requirePermission');

// GET /:businessId/integrations — members with settings.integrations
router.get(
  '/:businessId/integrations',
  requireAuth,
  requireBusinessAccess({ minRole: 'any' }),
  requirePermission('settings.integrations'),
  ctrl.getIntegrations
);

// GET /:businessId/webhooks — members with settings.integrations
router.get(
  '/:businessId/webhooks',
  requireAuth,
  requireBusinessAccess({ minRole: 'any' }),
  requirePermission('settings.integrations'),
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

// GET /:businessId/integrations/stripe/callback — Stripe redirect target
// One registered redirect for every business; the verified state resolves its id.
router.get('/integrations/stripe/callback', ctrl.stripeCallback);
router.get(
  '/:businessId/integrations/stripe/callback',
  scopeExempt('signed-callback'), ctrl.stripeCallback
);

router.post(
  '/:businessId/integrations/stripe/continue-setup',
  requireAuth,
  requireBusinessAccess({ minRole: 'owner' }),
  ctrl.stripeContinueSetup
);

// POST /:businessId/integrations/stripe/disconnect — owner only
router.post(
  '/:businessId/integrations/stripe/disconnect',
  requireAuth,
  requireBusinessAccess({ minRole: 'owner' }),
  ctrl.disconnectStripe
);

module.exports = router;
