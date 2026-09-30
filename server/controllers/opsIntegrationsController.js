'use strict';

/**
 * opsIntegrationsController
 *
 * Operations-console view over business_integrations. Lets staff with the
 * manage_operations grant list integrations across businesses, run a live
 * connectivity check (Stripe Connect account status), and reconnect rows that
 * were disabled.
 *
 * Schema note: business_integrations uses is_connected / is_enabled booleans
 * (migrations 227/295), not a status column. This controller maps those to a
 * derived `status` string: 'disabled' (is_enabled FALSE), 'connected'
 * (is_connected TRUE and is_enabled TRUE), 'pending' (everything else).
 * The Stripe provider account id lives in config_json->>'account_id'
 * (written by the Stripe Connect callback) and in businesses.stripe_account_id.
 */

const pool = require('../db');
const Stripe = require('stripe');
const { logAdminAction } = require('../services/auditService');
const logger = require('../utils/logger');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function statusExpression() {
  return `CASE
     WHEN i.is_enabled = FALSE THEN 'disabled'
     WHEN i.is_connected = TRUE THEN 'connected'
     ELSE 'pending'
   END`;
}

/**
 * GET / (ops integrations)
 * Query params: ?status=connected|disabled|pending  ?type=stripe|...  ?business_id=  ?limit=  ?offset=
 * Returns integrations joined with the business name, plus the most recent
 * webhook delivery timestamp and the count of failed deliveries in the last 24h.
 */
async function listIntegrations(req, res, next) {
  try {
    const { status, type, business_id: businessId } = req.query || {};
    const limit = Math.min(Math.max(parseInt(req.query?.limit, 10) || 50, 1), 100);
    const offset = Math.max(parseInt(req.query?.offset, 10) || 0, 0);

    const conditions = [];
    const params = [];
    const add = (sql, value) => {
      params.push(value);
      conditions.push(sql.replace('?', `$${params.length}`));
    };

    if (status) {
      const normalized = String(status).toLowerCase();
      if (normalized === 'connected') {
        conditions.push('(i.is_connected = TRUE AND i.is_enabled = TRUE)');
      } else if (normalized === 'disabled') {
        conditions.push('(i.is_enabled = FALSE)');
      } else if (normalized === 'pending') {
        conditions.push('(i.is_connected = FALSE AND i.is_enabled = TRUE)');
      } else {
        return res.status(400).json({ error: 'Invalid status filter', code: 'invalid_status' });
      }
    }
    if (type) add('i.integration_type = ?', String(type));
    if (businessId) add('i.business_id = ?', parseInt(businessId, 10));

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const rowsQuery = `
      SELECT i.id,
             i.business_id,
             b.business_name AS business_name,
             i.integration_type,
             i.integration_name,
             i.is_connected,
             i.is_enabled,
             ${statusExpression()} AS status,
             i.config_json,
             i.last_sync_at,
             i.last_error,
             i.created_at,
             i.updated_at,
             (SELECT MAX(d.created_at)
                FROM webhook_delivery_log d
                JOIN business_webhooks w ON w.id = d.webhook_id
               WHERE w.business_id = i.business_id) AS last_delivery_at,
             (SELECT COUNT(*)
                FROM webhook_delivery_log d
                JOIN business_webhooks w ON w.id = d.webhook_id
               WHERE w.business_id = i.business_id
                 AND d.created_at >= NOW() - INTERVAL '24 hours'
                 AND d.completed_at IS NULL
                 AND d.error_message IS NOT NULL) AS failed_deliveries_24h
        FROM business_integrations i
        JOIN businesses b ON b.id = i.business_id
       ${where}
       ORDER BY i.updated_at DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;

    const [{ rows }, countResult] = await Promise.all([
      pool.query(rowsQuery, [...params, limit, offset]),
      pool.query(
        `SELECT COUNT(*) AS total FROM business_integrations i ${where}`,
        params
      ),
    ]);

    res.json({
      integrations: rows.map((row) => ({
        ...row,
        failed_deliveries_24h: parseInt(row.failed_deliveries_24h, 10) || 0,
      })),
      total: parseInt(countResult.rows?.[0]?.total, 10) || 0,
      limit,
      offset,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Loads the integration row plus the Stripe account id from config_json,
 * falling back to businesses.stripe_account_id.
 */
async function loadIntegration(id) {
  const { rows } = await pool.query(
    `SELECT i.id,
            i.business_id,
            i.integration_type,
            i.integration_name,
            i.is_connected,
            i.is_enabled,
            i.config_json,
            i.last_sync_at,
            i.updated_at,
            COALESCE(i.config_json ->> 'account_id', b.stripe_account_id) AS provider_account_id
       FROM business_integrations i
  LEFT JOIN businesses b ON b.id = i.business_id
      WHERE i.id = $1`,
    [id]
  );
  return rows[0] || null;
}

/**
 * POST /:id/test
 * Runs a read-only connectivity check. For Stripe, retrieves the connected
 * account. Never moves money or creates anything. No audit rows written.
 */
async function testIntegration(req, res, next) {
  const { id } = req.params || {};
  if (!id || !UUID_RE.test(id)) {
    return res.status(400).json({ error: 'Invalid integration id', code: 'invalid_id' });
  }

  try {
    const integration = await loadIntegration(id);
    if (!integration) {
      return res.status(404).json({ error: 'Integration not found', code: 'integration_not_found' });
    }

    if (!process.env.STRIPE_SECRET_KEY) {
      return res.status(503).json({ error: 'Stripe is not configured', code: 'stripe_not_configured' });
    }

    if (integration.integration_type !== 'stripe') {
      return res.json({
        ok: true,
        checked: false,
        reason: 'no automated check for this provider',
        integration_type: integration.integration_type,
      });
    }

    if (!integration.provider_account_id) {
      return res.json({
        ok: true,
        checked: false,
        reason: 'no provider account linked to this integration',
        integration_type: 'stripe',
      });
    }

    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    try {
      const account = await stripe.accounts.retrieve(integration.provider_account_id);
      return res.json({
        ok: true,
        checked: true,
        integration_type: 'stripe',
        account_id: integration.provider_account_id,
        charges_enabled: !!account.charges_enabled,
        payouts_enabled: !!account.payouts_enabled,
        details_submitted: !!account.details_submitted,
      });
    } catch (stripeErr) {
      // Record the failure on the row for the ops list; never fail the response over it.
      try {
        await pool.query(
          `UPDATE business_integrations
              SET config_json = COALESCE(config_json, '{}'::jsonb) || $2::jsonb,
                  updated_at = NOW()
            WHERE id = $1`,
          [
            id,
            JSON.stringify({
              last_test_at: new Date().toISOString(),
              last_test_error: String(stripeErr?.message || stripeErr).slice(0, 1000),
            }),
          ]
        );
      } catch (metaErr) {
        logger?.warn?.('opsIntegrations: failed to record test failure metadata', {
          integrationId: id,
          error: metaErr.message,
        });
      }
      return res.status(502).json({
        ok: false,
        error: String(stripeErr?.message || 'Provider check failed'),
        code: 'provider_check_failed',
      });
    }
  } catch (err) {
    next(err);
  }
}

/**
 * POST /:id/reconnect
 * Only allowed when the integration is disabled (is_enabled FALSE). Flips it
 * back to connected and clears disabled markers from config_json.
 */
async function reconnectIntegration(req, res, next) {
  const { id } = req.params || {};
  if (!id || !UUID_RE.test(id)) {
    return res.status(400).json({ error: 'Invalid integration id', code: 'invalid_id' });
  }

  try {
    const integration = await loadIntegration(id);
    if (!integration) {
      return res.status(404).json({ error: 'Integration not found', code: 'integration_not_found' });
    }
    if (integration.is_enabled !== false) {
      return res.status(409).json({
        error: 'Integration is not disabled',
        code: 'integration_not_disabled',
      });
    }

    const { rows } = await pool.query(
      `UPDATE business_integrations
          SET is_connected = TRUE,
              is_enabled = TRUE,
              last_error = NULL,
              config_json = COALESCE(config_json, '{}'::jsonb)
                - 'disabled_at' - 'disabled_by' - 'disabled_reason' - 'last_test_error',
              updated_at = NOW()
        WHERE id = $1
    RETURNING id, business_id, integration_type, integration_name,
              is_connected, is_enabled, config_json, last_sync_at,
              created_at, updated_at`,
      [id]
    );

    await logAdminAction({
      adminId: req.user.id,
      action: 'ops_integration_reconnected',
      targetType: 'business_integration',
      targetId: String(id),
      description: `Integration ${integration.integration_type} reconnected for business ${integration.business_id}`,
      req,
    });

    res.json({ success: true, integration: rows[0] });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  listIntegrations,
  testIntegration,
  reconnectIntegration,
};
