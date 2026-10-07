'use strict';

const pool = require('../db');
const crypto = require('crypto');
const { AppError } = require('../middleware/errorHandler');
const { withTransaction } = require('../utils/transaction');
const { assertPublicWebhookTarget } = require('../utils/webhookUrlSafety');

const TYPE_LABELS = {
  api_access: 'API Access',
  sms_notifications: 'SMS Notifications',
  google_calendar: 'Google Calendar',
};

const STRIPE_CONNECT_AUTHORIZE_URL = 'https://connect.stripe.com/oauth/authorize';
const STRIPE_CONNECT_TOKEN_URL = 'https://connect.stripe.com/oauth/token';
const STRIPE_CONNECT_DEAUTHORIZE_URL = 'https://connect.stripe.com/oauth/deauthorize';
const STRIPE_CONNECT_ACCOUNT_BASE_URL = 'https://api.stripe.com/v1/accounts';
const STRIPE_STATE_COOKIE = 'oxsteed_stripe_oauth';
const STRIPE_STATE_MAX_AGE = 15 * 60 * 1000;

function stripeStateCookieOptions() {
  return { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/api/businesses' };
}

function stateFingerprint(state) {
  return crypto.createHash('sha256').update(state).digest('hex');
}

function stripeCookieMatches(req, nonce) {
  const cookies = String(req.headers.cookie || '').split(';').map(part => part.trim())
    .filter(part => part.startsWith(`${STRIPE_STATE_COOKIE}=`));
  if (cookies.length !== 1) return false;
  const actual = Buffer.from(cookies[0].slice(STRIPE_STATE_COOKIE.length + 1));
  const expected = Buffer.from(nonce);
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function getStripeConnectStateSecret() {
  const secret = process.env.STRIPE_CONNECT_STATE_SECRET
    || process.env.JWT_SECRET
    || process.env.APP_SECRET
    || process.env.SESSION_SECRET;
  if (!secret) throw new AppError('Stripe Connect state signing is not configured.', 424, 'configuration_missing');
  return secret;
}

function createStripeConnectState(businessId, userId) {
  const nonce = crypto.randomBytes(24).toString('hex');
  const payload = JSON.stringify({
    businessId: String(businessId),
    userId: String(userId),
    ts: Date.now(),
    nonce,
  });
  const encoded = Buffer.from(payload).toString('base64url');
  const signature = crypto
    .createHmac('sha256', getStripeConnectStateSecret())
    .update(encoded)
    .digest('base64url');
  return { state: `${encoded}.${signature}`, nonce };
}

function verifyStripeConnectState(state) {
  if (typeof state !== 'string' || state.length > 4096 || state.split('.').length !== 2) return null;
  const [encoded, signature] = state.split('.', 2);
  const expected = crypto
    .createHmac('sha256', getStripeConnectStateSecret())
    .update(encoded)
    .digest('base64url');
  const expectedBuf = Buffer.from(expected);
  const providedBuf = Buffer.from(signature || '');
  if (expectedBuf.length !== providedBuf.length || !crypto.timingSafeEqual(expectedBuf, providedBuf)) {
    return null;
  }
  try {
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    if (typeof payload?.businessId !== 'string' || !payload.businessId
        || typeof payload.userId !== 'string' || !payload.userId
        || !/^[a-f0-9]{48}$/.test(payload.nonce || '')) return null;
    const timestamp = Number(payload.ts);
    if (!Number.isFinite(timestamp) || timestamp <= 0 || timestamp > Date.now()
        || Date.now() - timestamp > STRIPE_STATE_MAX_AGE) return null;
    return {
      businessId: String(payload.businessId),
      userId: payload.userId,
      ts: timestamp,
      nonce: payload.nonce,
    };
  } catch {
    return null;
  }
}

async function stripeFormRequest(url, body) {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      ...(url === STRIPE_CONNECT_DEAUTHORIZE_URL
        ? { Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}` } : {}),
    },
    signal: AbortSignal.timeout(15000),
    body: new URLSearchParams(body).toString(),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const err = new AppError(
      data?.error_description || data?.error || 'Stripe request failed',
      502,
      'stripe_connect_request_failed',
      { stripe: data }
    );
    throw err;
  }
  return data;
}

async function stripeGetRequest(url) {
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
    },
    signal: AbortSignal.timeout(15000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const err = new AppError(
      data?.error?.message || data?.error_description || data?.error || 'Stripe request failed',
      502,
      'stripe_connect_request_failed',
      { stripe: data }
    );
    throw err;
  }
  return data;
}

function getStripeBusinessStatus({ stripe_account_id, stripe_charges_enabled, stripe_payouts_enabled, stripe_account_status }) {
  const accountId = stripe_account_id ? String(stripe_account_id).trim() : null;
  const chargesEnabled = !!stripe_charges_enabled;
  const payoutsEnabled = !!stripe_payouts_enabled;
  const accountStatus = stripe_account_status || null;
  return {
    accountId,
    chargesEnabled,
    payoutsEnabled,
    accountStatus,
    connected: Boolean(accountId),
    readyForCheckout: Boolean(accountId && chargesEnabled),
  };
}

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
    const { rows: businessRows } = await pool.query(
      `SELECT stripe_account_id, stripe_charges_enabled, stripe_payouts_enabled, stripe_account_status
         FROM businesses
        WHERE id = $1`,
      [businessId]
    ).catch(() => ({ rows: [] }));

    const byType = {};
    for (const row of rows) {
      byType[row.integration_type] = row;
    }

    const stripe     = byType['stripe']          || {};
    const apiAccess  = byType['api_access']      || {};
    const sms        = byType['sms_notifications'] || {};
    const calendar   = byType['google_calendar'] || byType['outlook_calendar'] || {};

    // Check if there are any active webhooks for webhooks_enabled flag
    const webhookCount = await pool.query(
      `SELECT COUNT(*) AS cnt FROM business_webhooks
       WHERE business_id = $1 AND is_active = TRUE`,
      [businessId]
    ).catch(() => ({ rows: [{ cnt: 0 }] }));

    const apiKey = (apiAccess.config_json && apiAccess.config_json.api_key)
      ? apiAccess.config_json.api_key
      : null;
    // M21b: never return the full API key on a read. The persistent DOM must
    // only ever see the masked form; the full key is returned once, at
    // (re)generation time, and the owner is told to store it securely.
    const apiKeyMasked = apiKey
      ? `••••••••${String(apiKey).slice(-4)}`
      : null;
    const businessStripe = getStripeBusinessStatus(businessRows[0] || {});
    const integrationStripeAccountId = (stripe.config_json && stripe.config_json.account_id) || null;
    const stripeAccountId = businessStripe.accountId || integrationStripeAccountId;
    const stripeConnected = Boolean(stripe.is_connected || businessStripe.connected || integrationStripeAccountId);

    res.json({
      stripe_connected:       stripeConnected,
      stripe_account_id:      stripeAccountId,
      stripe_charges_enabled:  businessStripe.chargesEnabled,
      stripe_payouts_enabled:  businessStripe.payoutsEnabled,
      stripe_account_status:   businessStripe.accountStatus || (stripe.config_json && stripe.config_json.account_status) || null,
      stripe_ready_for_checkout: businessStripe.readyForCheckout,
      webhooks_enabled:       parseInt(webhookCount.rows[0].cnt, 10) > 0,
      sms_enabled:            !!(sms.is_enabled),
      calendar_sync_enabled:  !!(calendar.is_enabled || calendar.is_connected),
      calendar_setup_status:  (calendar.config_json && calendar.config_json.setup_status) || null,
      api_key_masked:        apiKeyMasked
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

  // SSRF guard: the target must resolve to public IPs only. DNS failures and
  // timeouts fail closed. Requires migration 622 (business_webhooks.pinned_ip).
  const safety = await assertPublicWebhookTarget(url);
  if (!safety.ok) {
    return res.status(400).json({
      error: 'Webhook URL must resolve to a public HTTPS endpoint',
      code: 'webhook_url_not_public',
      reason: safety.reason,
    });
  }
  const pinnedIp = safety.ips[0];

  try {
    const secret = 'whsec_' + crypto.randomBytes(20).toString('hex');
    const { rows } = await pool.query(
      `INSERT INTO business_webhooks
         (business_id, webhook_url, webhook_secret, event_types, created_by_id, pinned_ip)
       VALUES ($1::text::integer, $2, $3, $4, $5, $6)
       RETURNING id, webhook_url AS url, event_types AS events, is_active, created_at`,
      [businessId, url, secret, events, req.user.id, pinnedIp]
    ).catch(async () => {
      // Fallback: business_id might be UUID type in older DBs
      return pool.query(
        `INSERT INTO business_webhooks
           (business_id, webhook_url, webhook_secret, event_types, created_by_id, pinned_ip)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, webhook_url AS url, event_types AS events, is_active, created_at`,
        [businessId, url, secret, events, req.user.id, pinnedIp]
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
    if (!clientId || !process.env.STRIPE_SECRET_KEY) {
      throw new AppError(
        'Stripe Connect is not configured for this environment.',
        424,
        'configuration_missing',
        { stripe: 'Set STRIPE_CLIENT_ID before starting Stripe Connect onboarding.' }
      );
    }

    const { state, nonce } = createStripeConnectState(businessId, req.user.id);
    const pending = { fingerprint: stateFingerprint(state), userId: String(req.user.id), expiresAt: Date.now() + STRIPE_STATE_MAX_AGE };
    // Store only a fingerprint; consume it atomically before exchanging a code.
    await pool.query(
      `INSERT INTO business_integrations
         (business_id, integration_type, integration_name, is_connected, is_enabled, created_by_id, config_json)
       VALUES ($1, 'stripe', 'Stripe Connect', FALSE, TRUE, $2, jsonb_build_object('stripe_oauth_pending', $3::jsonb))
       ON CONFLICT (business_id, integration_type) DO UPDATE SET
         config_json = COALESCE(business_integrations.config_json, '{}'::jsonb)
                       || jsonb_build_object('stripe_oauth_pending', $3::jsonb),
         updated_at = NOW()`,
      [businessId, req.user.id, JSON.stringify(pending)]
    );

    const redirectUri = encodeURIComponent(
      `${process.env.CLIENT_URL || process.env.APP_URL || 'http://localhost:3000'}/api/businesses/integrations/stripe/callback`
    );
    const authUrl = `${STRIPE_CONNECT_AUTHORIZE_URL}?response_type=code&client_id=${encodeURIComponent(clientId)}&scope=read_write&state=${encodeURIComponent(state)}&redirect_uri=${redirectUri}`;

    res.cookie(STRIPE_STATE_COOKIE, nonce, { ...stripeStateCookieOptions(), maxAge: STRIPE_STATE_MAX_AGE });
    res.json({ auth_url: authUrl });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /businesses/:businessId/integrations/stripe/callback
 * Stripe redirects here after the merchant approves access.
 */
async function stripeCallback(req, res, next) {
  let { businessId } = req.params;
  const {
    code,
    state,
    error,
    error_description: errorDescription,
    error_message: errorMessage,
  } = req.query || {};
  const appBaseUrl = process.env.CLIENT_URL || process.env.APP_URL || 'http://localhost:3000';

  try {
    const parsedState = verifyStripeConnectState(state);
    if (!parsedState || (businessId && parsedState.businessId !== String(businessId))
        || !stripeCookieMatches(req, parsedState.nonce)) {
      throw new AppError('Invalid Stripe Connect state', 403, 'stripe_connect_state_invalid');
    }
    businessId = parsedState.businessId;
    if (!error && (typeof code !== 'string' || !code)) {
      throw new AppError('Stripe authorization code is missing', 400, 'stripe_connect_code_missing');
    }
    if (!process.env.STRIPE_CLIENT_ID || !process.env.STRIPE_SECRET_KEY) {
      throw new AppError('Stripe Connect is not configured for this environment.', 424, 'configuration_missing');
    }

    const { rows: pendingRows } = await pool.query(
      `UPDATE business_integrations AS bi
          SET config_json = config_json - 'stripe_oauth_pending', updated_at = NOW()
        WHERE business_id::text = $1 AND integration_type = 'stripe'
          AND config_json->'stripe_oauth_pending'->>'fingerprint' = $2
          AND config_json->'stripe_oauth_pending'->>'userId' = $3
          AND (config_json->'stripe_oauth_pending'->>'expiresAt')::bigint > $4
          AND EXISTS (
            SELECT 1 FROM businesses b WHERE b.id = bi.business_id
              AND b.deleted_at IS NULL AND b.is_active IS NOT FALSE
              AND (b.user_id::text = $3 OR EXISTS (
                SELECT 1 FROM business_members bm WHERE bm.business_id = b.id
                  AND bm.member_id::text = $3 AND bm.role = 'owner' AND bm.status = 'active'
              ))
          )
        RETURNING business_id`,
      [businessId, stateFingerprint(state), parsedState.userId, Date.now()]
    );
    if (!pendingRows.length) {
      throw new AppError('Stripe Connect authorization expired or already used.', 403, 'stripe_connect_state_invalid');
    }
    res.clearCookie(STRIPE_STATE_COOKIE, stripeStateCookieOptions());
    if (error) {
      return res.redirect(
        `${appBaseUrl}/restaurants/merchant?stripe=error&businessId=${encodeURIComponent(businessId)}&message=${encodeURIComponent(errorDescription || errorMessage || error)}`
      );
    }

    const token = await stripeFormRequest(STRIPE_CONNECT_TOKEN_URL, {
      client_secret: process.env.STRIPE_CLIENT_SECRET || process.env.STRIPE_SECRET_KEY,
      code,
      grant_type: 'authorization_code',
    });
    const accountId = token.account_id || token.stripe_user_id || null;
    if (!accountId) {
      throw new AppError('Stripe did not return a connected account id', 502, 'stripe_connect_account_missing');
    }
    if (process.env.NODE_ENV === 'production' && token.livemode !== true) {
      throw new AppError('Stripe returned a test-mode account connection.', 502, 'stripe_connect_mode_mismatch');
    }

    const account = await stripeGetRequest(`${STRIPE_CONNECT_ACCOUNT_BASE_URL}/${encodeURIComponent(accountId)}`);
    const accountStatus = account.charges_enabled
      ? 'active'
      : (Array.isArray(account.requirements?.currently_due) && account.requirements.currently_due.length
        ? 'restricted'
        : 'pending');

    const configJson = {
      account_id: accountId,
      scope: token.scope || null,
      livemode: !!token.livemode,
      token_type: token.token_type || null,
      charges_enabled: !!account.charges_enabled,
      payouts_enabled: !!account.payouts_enabled,
      details_submitted: !!account.details_submitted,
      country: account.country || null,
      default_currency: account.default_currency || null,
      account_status: accountStatus,
      requirements: account.requirements || null,
      connected_at: new Date().toISOString(),
    };

    await withTransaction(pool, async client => {
      const { rows: ownerRows } = await client.query(
        `SELECT b.id FROM businesses b WHERE b.id::text = $1
           AND b.deleted_at IS NULL AND b.is_active IS NOT FALSE
           AND (b.user_id::text = $2 OR EXISTS (
             SELECT 1 FROM business_members bm WHERE bm.business_id = b.id
               AND bm.member_id::text = $2 AND bm.role = 'owner' AND bm.status = 'active'
           )) FOR UPDATE OF b`,
        [businessId, parsedState.userId]
      );
      if (!ownerRows.length) throw new AppError('Business owner access changed.', 403, 'business_role_required');
      await client.query(
      `INSERT INTO business_integrations
         (business_id, integration_type, integration_name, is_connected, is_enabled,
          auth_token, auth_refresh_token, auth_expires_at, config_json, created_by_id)
       VALUES ($1, 'stripe', 'Stripe Connect', TRUE, TRUE, $2, $3, $4, $5::jsonb, NULL)
       ON CONFLICT (business_id, integration_type)
       DO UPDATE SET
         integration_name = EXCLUDED.integration_name,
         is_connected = EXCLUDED.is_connected,
         is_enabled = EXCLUDED.is_enabled,
         auth_token = EXCLUDED.auth_token,
         auth_refresh_token = EXCLUDED.auth_refresh_token,
         auth_expires_at = EXCLUDED.auth_expires_at,
         config_json = COALESCE(business_integrations.config_json, '{}'::jsonb) || EXCLUDED.config_json,
         updated_at = NOW()`,
      [
        businessId,
        null,
        null,
        null,
        JSON.stringify(configJson),
      ]
    );

      await client.query(
      `UPDATE businesses
          SET stripe_account_id = $1,
              stripe_charges_enabled = $2,
              stripe_payouts_enabled = $3,
              stripe_account_status = $4,
              updated_at = NOW()
        WHERE id = $5`,
      [accountId, !!account.charges_enabled, !!account.payouts_enabled, accountStatus, businessId]
    );
      const { syncBusinessOAuthToRestaurantConnect } = require('../services/stripeConnectSoTService');
      await syncBusinessOAuthToRestaurantConnect(client, businessId);
    }, 'connect_business_stripe');

    return res.redirect(
      `${appBaseUrl}/restaurants/merchant?stripe=connected&businessId=${encodeURIComponent(businessId)}`
    );
  } catch (err) {
    if (err instanceof AppError) {
      return res.redirect(
        `${appBaseUrl}/restaurants/merchant?stripe=error&businessId=${encodeURIComponent(businessId || '')}&message=${encodeURIComponent(err.message)}`
      );
    }
    next(err);
  }
}

/**
 * POST /businesses/:businessId/integrations/stripe/disconnect
 */
async function stripeContinueSetup(req, res, next) {
  const { businessId } = req.params;
  try {
    if (!process.env.STRIPE_SECRET_KEY) {
      throw new AppError('Stripe Connect is not configured for this environment.', 424, 'configuration_missing');
    }
    const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
    const { rows } = await pool.query(
      `SELECT stripe_account_id, stripe_charges_enabled
         FROM businesses
        WHERE id = $1`,
      [businessId],
    );
    const accountId = rows[0]?.stripe_account_id ? String(rows[0].stripe_account_id).trim() : '';
    if (!accountId) {
      throw new AppError(
        'Connect Stripe before finishing setup.',
        409,
        'stripe_connect_not_linked',
      );
    }
    if (rows[0]?.stripe_charges_enabled) {
      return res.json({ success: true, already_ready: true, charges_enabled: true });
    }
    const loginLink = await stripe.accounts.createLoginLink(accountId);
    return res.json({
      success: true,
      url: loginLink.url,
      kind: 'login_link',
      charges_enabled: false,
    });
  } catch (err) {
    next(err instanceof AppError ? err : new AppError('Could not open Stripe setup', 502, 'stripe_continue_setup_failed'));
  }
}

async function disconnectStripe(req, res, next) {
  const { businessId } = req.params;
  try {
    const { rows: businessRows } = await pool.query(
      `SELECT b.stripe_account_id,
          EXISTS (SELECT 1 FROM businesses other
                    WHERE other.id <> b.id AND other.stripe_account_id = b.stripe_account_id) AS shared_connection
         FROM businesses b WHERE b.id = $1`,
      [businessId]
    );
    const businessStripeAccountId = businessRows[0]?.stripe_account_id || null;
    if (businessStripeAccountId) {
      if (businessRows[0].shared_connection) {
        throw new AppError('This Stripe account serves multiple businesses. Contact support before revoking its shared access.', 409, 'stripe_connect_shared_account');
      }
      if (!process.env.STRIPE_CLIENT_ID || !process.env.STRIPE_SECRET_KEY) {
        throw new AppError('Stripe Connect is not configured for this environment.', 424, 'configuration_missing');
      }
      // Stripe requires platform authentication. Do not report a successful
      // revocation or erase local evidence when the provider request fails.
      await stripeFormRequest(STRIPE_CONNECT_DEAUTHORIZE_URL, {
        client_id: process.env.STRIPE_CLIENT_ID,
        stripe_user_id: businessStripeAccountId,
      });
    }
    await withTransaction(pool, async client => {
      const { rows: current } = await client.query(
        'SELECT stripe_account_id FROM businesses WHERE id = $1 FOR UPDATE', [businessId]
      );
      if ((current[0]?.stripe_account_id || null) !== businessStripeAccountId) {
        throw new AppError('The Stripe connection changed. Reload before retrying.', 409, 'stripe_connect_changed');
      }
      await client.query(
      `UPDATE business_integrations
       SET is_connected = FALSE, auth_token = NULL, auth_refresh_token = NULL,
           config_json = NULL, updated_at = NOW()
       WHERE business_id = $1 AND integration_type = 'stripe'`,
      [businessId]
    );
      await client.query(
      `UPDATE businesses
          SET stripe_account_id = NULL,
              stripe_charges_enabled = FALSE,
              stripe_payouts_enabled = FALSE,
              stripe_account_status = NULL,
              updated_at = NOW()
        WHERE id = $1`,
      [businessId]
      );
    }, 'disconnect_business_stripe');
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
  stripeCallback,
  stripeContinueSetup,
  disconnectStripe
};
