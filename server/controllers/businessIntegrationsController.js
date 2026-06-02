'use strict';

const pool = require('../db');
const crypto = require('crypto');
const { AppError } = require('../middleware/errorHandler');

const TYPE_LABELS = {
  api_access: 'API Access',
  sms_notifications: 'SMS Notifications',
  google_calendar: 'Google Calendar',
};

function createApiKey() {
  return `oxs_live_${crypto.randomBytes(24).toString('hex')}`;
}

async function upsertIntegrationConfig({
  businessId,
  type,
  name,
  userId,
  isConnected = false,
  isEnabled = true,
  config = {},
}) {
  const { rows } = await pool.query(
    `INSERT INTO business_integrations
       (business_id, integration_type, integration_name, is_connected, is_enabled, config_json, created_by_id)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)
     ON CONFLICT (business_id, integration_type)
     DO UPDATE SET
       integration_name = EXCLUDED.integration_name,
       is_connected = EXCLUDED.is_connected,
       is_enabled = EXCLUDED.is_enabled,
       config_json = COALESCE(business_integrations.config_json, '{}'::jsonb) || EXCLUDED.config_json,
       updated_at = NOW()
     RETURNING integration_type, is_connected, is_enabled, config_json, updated_at`,
    [businessId, type, name, isConnected, isEnabled, JSON.stringify(config), userId]
  );
  return rows[0];
}

/**
 * GET /businesses/:businessId/integrations
 * Returns a flat status object the frontend expects:
 * { stripe_connected, stripe_account_id, webhooks_enabled,
 *   sms_enabled, calendar_sync_enabled, api_key }
 */
async function getIntegrations(req, res, next) {
  const { businessId } = req.params;
  try {
    // Fetch all integration rows for this business
    const { rows } = await pool.query(
      `SELECT integration_type, is_connected, is_enabled, config_json
       FROM business_integrations
       WHERE business_id = $1`,
      [businessId]
    );

    const byType = {};
    for (const row of rows) {
      byType[row.integration_type] = row;
    }

    const stripe     = byType['stripe']          || {};
    const apiAccess  = byType['api_access']      || {};
    const sms        = byType['sms_notifications'] || {};
    const calendar   = byType['google_calendar'] || byType['outlook_calendar'] || {};
    const webhooksRow = byType['custom_webhook'] || {};

    // Check if there are any active webhooks for webhooks_enabled flag
    const webhookCount = await pool.query(
      `SELECT COUNT(*) AS cnt FROM business_webhooks
       WHERE business_id = $1 AND is_active = TRUE`,
      [businessId]
    ).catch(() => ({ rows: [{ cnt: 0 }] }));

    const apiKey = (apiAccess.config_json && apiAccess.config_json.api_key)
      ? apiAccess.config_json.api_key
      : null;

    res.json({
      stripe_connected:       !!(stripe.is_connected),
      stripe_account_id:      (stripe.config_json && stripe.config_json.account_id) || null,
      webhooks_enabled:       parseInt(webhookCount.rows[0].cnt, 10) > 0,
      sms_enabled:            !!(sms.is_enabled),
      calendar_sync_enabled:  !!(calendar.is_enabled || calendar.is_connected),
      calendar_setup_status:  (calendar.config_json && calendar.config_json.setup_status) || null,
      api_key:                apiKey
    });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /businesses/:businessId/integrations/api-key/regenerate
 * Creates a new business API key and invalidates the previous key.
 */
async function regenerateApiKey(req, res, next) {
  const { businessId } = req.params;

  try {
    const apiKey = createApiKey();
    await upsertIntegrationConfig({
      businessId,
      type: 'api_access',
      name: TYPE_LABELS.api_access,
      userId: req.user.id,
      isConnected: true,
      isEnabled: true,
      config: {
        api_key: apiKey,
        regenerated_at: new Date().toISOString(),
        regenerated_by: req.user.id,
      },
    });

    res.json({
      success: true,
      api_key: apiKey,
      message: 'API key regenerated. Store it securely; the previous key is no longer valid.',
    });
  } catch (err) {
    next(err);
  }
}

/**
 * PATCH /businesses/:businessId/integrations/:integrationType
 * Supports lightweight business-managed integrations that do not require OAuth.
 */
async function updateIntegration(req, res, next) {
  const { businessId, integrationType } = req.params;
  const { enabled = true, setup_requested = false } = req.body || {};

  const supported = new Set(['sms_notifications', 'google_calendar']);
  if (!supported.has(integrationType)) {
    return res.status(400).json({ error: 'Unsupported integration type' });
  }

  try {
    const config = {};
    if (setup_requested) {
      config.setup_status = 'setup_requested';
      config.setup_requested_at = new Date().toISOString();
      config.setup_requested_by = req.user.id;
    }

    const row = await upsertIntegrationConfig({
      businessId,
      type: integrationType,
      name: TYPE_LABELS[integrationType],
      userId: req.user.id,
      isConnected: integrationType === 'sms_notifications' ? !!enabled : false,
      isEnabled: !!enabled,
      config,
    });

    res.json({
      success: true,
      integration_type: row.integration_type,
      is_enabled: row.is_enabled,
      is_connected: row.is_connected,
      config: row.config_json || {},
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /businesses/:businessId/webhooks
 * Returns array: [{ id, url, events, last_delivery_at, is_active }]
 */
async function listWebhooks(req, res, next) {
  const { businessId } = req.params;
  try {
    // business_webhooks.business_id is cast to match — handle gracefully if table missing
    const { rows } = await pool.query(
      `SELECT w.id,
              w.webhook_url   AS url,
              w.event_types   AS events,
              w.is_active,
              MAX(d.created_at) AS last_delivery_at
       FROM business_webhooks w
       LEFT JOIN webhook_delivery_log d ON d.webhook_id = w.id
       WHERE w.business_id::text = $1::text
         AND w.is_active = TRUE
       GROUP BY w.id, w.webhook_url, w.event_types, w.is_active
       ORDER BY w.created_at DESC`,
      [businessId]
    );
    res.json(rows);
  } catch (err) {
    // Table may not exist yet — return empty array so UI doesn't crash
    if (err.code === '42P01') return res.json([]);
    next(err);
  }
}

/**
 * POST /businesses/:businessId/webhooks
 * Body: { url, events[] }
 */
async function createWebhook(req, res, next) {
  const { businessId } = req.params;
  const { url, events } = req.body;

  if (!url || !Array.isArray(events) || events.length === 0) {
    return res.status(400).json({ error: 'url and events are required' });
  }

  // Basic URL validation
  try { new URL(url); } catch {
    return res.status(400).json({ error: 'Invalid URL format' });
  }
  if (!url.startsWith('https://')) {
    return res.status(400).json({ error: 'Webhook URL must use HTTPS' });
  }

  try {
    const secret = 'whsec_' + crypto.randomBytes(20).toString('hex');
    const { rows } = await pool.query(
      `INSERT INTO business_webhooks
         (business_id, webhook_url, webhook_secret, event_types, created_by_id)
       VALUES ($1::text::integer, $2, $3, $4, $5)
       RETURNING id, webhook_url AS url, event_types AS events, is_active, created_at`,
      [businessId, url, secret, events, req.user.id]
    ).catch(async () => {
      // Fallback: business_id might be UUID type in older DBs
      return pool.query(
        `INSERT INTO business_webhooks
           (business_id, webhook_url, webhook_secret, event_types, created_by_id)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, webhook_url AS url, event_types AS events, is_active, created_at`,
        [businessId, url, secret, events, req.user.id]
      );
    });
    res.status(201).json(rows[0]);
  } catch (err) {
    next(err);
  }
}

/**
 * DELETE /businesses/:businessId/webhooks/:webhookId
 */
async function deleteWebhook(req, res, next) {
  const { businessId, webhookId } = req.params;
  try {
    await pool.query(
      `UPDATE business_webhooks SET is_active = FALSE
       WHERE id = $1 AND business_id::text = $2::text`,
      [webhookId, businessId]
    );
    res.json({ success: true });
  } catch (err) {
    if (err.code === '42P01') return res.json({ success: true });
    next(err);
  }
}

/**
 * POST /businesses/:businessId/integrations/stripe/auth
 * Returns a Stripe Connect OAuth URL when platform credentials are configured.
 */
async function stripeAuthUrl(req, res, next) {
  const { businessId } = req.params;
  try {
    const clientId = process.env.STRIPE_CLIENT_ID;
    if (!clientId) {
      throw new AppError(
        'Stripe Connect is not configured for this environment.',
        424,
        'configuration_missing',
        { stripe: 'Set STRIPE_CLIENT_ID before starting Stripe Connect onboarding.' }
      );
    }

    // Upsert integration row as "pending"
    await pool.query(
      `INSERT INTO business_integrations
         (business_id, integration_type, integration_name, is_connected, is_enabled, created_by_id)
       VALUES ($1, 'stripe', 'Stripe Connect', FALSE, TRUE, $2)
       ON CONFLICT (business_id, integration_type) DO NOTHING`,
      [businessId, req.user.id]
    );

    const redirectUri = encodeURIComponent(
      `${process.env.CLIENT_URL || process.env.APP_URL || 'http://localhost:3000'}/api/businesses/${businessId}/integrations/stripe/callback`
    );
    const authUrl = `https://connect.stripe.com/oauth/authorize?response_type=code&client_id=${clientId}&scope=read_write&redirect_uri=${redirectUri}`;

    res.json({ auth_url: authUrl });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /businesses/:businessId/integrations/stripe/disconnect
 */
async function disconnectStripe(req, res, next) {
  const { businessId } = req.params;
  try {
    await pool.query(
      `UPDATE business_integrations
       SET is_connected = FALSE, auth_token = NULL, auth_refresh_token = NULL,
           config_json = NULL, updated_at = NOW()
       WHERE business_id = $1 AND integration_type = 'stripe'`,
      [businessId]
    );
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getIntegrations,
  listWebhooks,
  createWebhook,
  deleteWebhook,
  regenerateApiKey,
  updateIntegration,
  stripeAuthUrl,
  disconnectStripe
};
