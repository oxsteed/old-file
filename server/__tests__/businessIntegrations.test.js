'use strict';

const express = require('express');
const request = require('supertest');
const { mockQuery, resetMocks } = require('./setup');
const { errorHandler } = require('../middleware/errorHandler');
const {
  getIntegrations,
  disconnectStripe,
  regenerateApiKey,
  stripeCallback,
  stripeAuthUrl,
  updateIntegration,
} = require('../controllers/businessIntegrationsController');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: 'user-123' };
    next();
  });
  app.get('/api/businesses/:businessId/integrations', getIntegrations);
  app.post('/api/businesses/:businessId/integrations/api-key/regenerate', regenerateApiKey);
  app.post('/api/businesses/:businessId/integrations/stripe/auth', stripeAuthUrl);
  app.get('/api/businesses/integrations/stripe/callback', stripeCallback);
  app.get('/api/businesses/:businessId/integrations/stripe/callback', stripeCallback);
  app.post('/api/businesses/:businessId/integrations/stripe/disconnect', disconnectStripe);
  app.patch('/api/businesses/:businessId/integrations/:integrationType', updateIntegration);
  app.use(errorHandler);
  return app;
}

let originalEnv;
let originalFetch;
const envKeys = ['CLIENT_URL', 'STRIPE_CLIENT_ID', 'STRIPE_CLIENT_SECRET', 'STRIPE_SECRET_KEY', 'NODE_ENV'];
beforeEach(() => {
  resetMocks();
  originalEnv = Object.fromEntries(envKeys.map(key => [key, process.env[key]]));
  originalFetch = global.fetch;
});
afterEach(() => {
  for (const key of envKeys) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
  global.fetch = originalFetch;
});

async function beginOAuth(businessId = '12') {
  process.env.CLIENT_URL = 'https://app.oxsteed.test';
  process.env.STRIPE_CLIENT_ID = 'ca_test_realclient';
  process.env.STRIPE_SECRET_KEY = 'sk_test_dummy';
  const response = await request(buildApp())
    .post(`/api/businesses/${businessId}/integrations/stripe/auth`).send({});
  expect(response.status).toBe(200);
  return {
    state: new URL(response.body.auth_url).searchParams.get('state'),
    cookie: response.headers['set-cookie'][0].split(';')[0],
    response,
  };
}

function mockStripeConnection(livemode = false) {
  global.fetch = jest.fn()
    .mockResolvedValueOnce({ ok: true, json: async () => ({
      access_token: 'synthetic_access_token', refresh_token: 'synthetic_refresh_token',
      scope: 'read_write', livemode, token_type: 'bearer', stripe_user_id: 'acct_123',
    }) })
    .mockResolvedValueOnce({ ok: true, json: async () => ({
      id: 'acct_123', charges_enabled: true, payouts_enabled: true,
      details_submitted: true, default_currency: 'usd', country: 'US',
      requirements: { currently_due: [] },
    }) });
}

describe('business integrations controls', () => {
  test('returns API access, SMS, calendar, and webhook status', async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [
          {
            integration_type: 'api_access',
            is_connected: true,
            is_enabled: true,
            config_json: { api_key: 'oxs_live_existing' },
          },
          {
            integration_type: 'sms_notifications',
            is_connected: true,
            is_enabled: true,
            config_json: {},
          },
          {
            integration_type: 'google_calendar',
            is_connected: false,
            is_enabled: true,
            config_json: { setup_status: 'setup_requested' },
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ cnt: '2' }] });

    const res = await request(buildApp()).get('/api/businesses/12/integrations');

    expect(res.status).toBe(200);
    // M21b: the full API key is never returned on read; only the masked form.
    expect(res.body.api_key).toBeUndefined();
    expect(res.body.api_key_masked).toBe('••••••••ting');
    expect(res.body.sms_enabled).toBe(true);
    expect(res.body.calendar_sync_enabled).toBe(true);
    expect(res.body.calendar_setup_status).toBe('setup_requested');
    expect(res.body.webhooks_enabled).toBe(true);
  });

  test('regenerates and persists a real API key', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{
        integration_type: 'api_access',
        is_connected: true,
        is_enabled: true,
        config_json: {},
      }],
    });

    const res = await request(buildApp())
      .post('/api/businesses/12/integrations/api-key/regenerate')
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.api_key).toMatch(/^oxs_live_[a-f0-9]{48}$/);

    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/INSERT INTO business_integrations/);
    expect(params[1]).toBe('api_access');
    expect(JSON.parse(params[5]).api_key).toBe(res.body.api_key);
  });

  test('updates lightweight integration flags', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{
        integration_type: 'sms_notifications',
        is_connected: false,
        is_enabled: false,
        config_json: {},
      }],
    });

    const res = await request(buildApp())
      .patch('/api/businesses/12/integrations/sms_notifications')
      .send({ enabled: false });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.integration_type).toBe('sms_notifications');
    expect(res.body.is_enabled).toBe(false);

    const [, params] = mockQuery.mock.calls[0];
    expect(params[1]).toBe('sms_notifications');
    expect(params[4]).toBe(false);
  });

  test('rejects unsupported integration updates', async () => {
    const res = await request(buildApp())
      .patch('/api/businesses/12/integrations/unsupported')
      .send({ enabled: true });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Unsupported integration type');
  });

  test('does not generate a Stripe auth URL without Connect credentials', async () => {
    const previousClientId = process.env.STRIPE_CLIENT_ID;
    delete process.env.STRIPE_CLIENT_ID;

    const res = await request(buildApp())
      .post('/api/businesses/12/integrations/stripe/auth')
      .send({});

    expect(res.status).toBe(424);
    expect(res.body.code).toBe('configuration_missing');
    expect(res.body.error).toMatch(/Stripe Connect is not configured/);
    expect(mockQuery).not.toHaveBeenCalled();

    if (previousClientId) process.env.STRIPE_CLIENT_ID = previousClientId;
  });

  test('generates a real Stripe Connect OAuth URL when configured', async () => {
    process.env.STRIPE_CLIENT_ID = 'ca_test_realclient';
    process.env.CLIENT_URL = 'https://app.oxsteed.test';
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = await request(buildApp())
      .post('/api/businesses/12/integrations/stripe/auth')
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.auth_url).toContain('https://connect.stripe.com/oauth/authorize');
    expect(res.body.auth_url).toContain('client_id=ca_test_realclient');
    expect(res.body.auth_url).toContain('state=');
    expect(res.body.auth_url).not.toContain('ca_placeholder');
    const redirect = new URL(res.body.auth_url).searchParams.get('redirect_uri');
    expect(redirect).toBe('https://app.oxsteed.test/api/businesses/integrations/stripe/callback');
    expect(res.headers['set-cookie'][0]).toMatch(/HttpOnly/);
    expect(res.headers['set-cookie'][0]).toMatch(/SameSite=Lax/);
    const pending = JSON.parse(mockQuery.mock.calls[0][1][2]);
    expect(pending.userId).toBe('user-123');
    expect(pending.fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(pending)).not.toContain('nonce');
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  test('exchanges the Stripe Connect callback code and persists the connected account', async () => {
    const { state, cookie } = await beginOAuth();
    delete process.env.STRIPE_CLIENT_SECRET;
    mockStripeConnection();
    mockQuery
      .mockResolvedValueOnce({ rows: [{ business_id: 12 }] })
      .mockResolvedValueOnce({ rows: [{ id: 12 }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    const res = await request(buildApp())
      .get(`/api/businesses/integrations/stripe/callback?code=oauth_code_123&state=${state}`)
      .set('Cookie', cookie);
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('/restaurants/merchant?stripe=connected&businessId=12');
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(new URLSearchParams(global.fetch.mock.calls[0][1].body).get('client_secret')).toBe('sk_test_dummy');
    expect(mockQuery.mock.calls[1][0]).toMatch(/config_json - 'stripe_oauth_pending'/);
    expect(mockQuery.mock.calls[1][1][2]).toBe('user-123');
    expect(mockQuery.mock.calls[2][0]).toMatch(/FOR UPDATE OF b/);
    expect(mockQuery.mock.calls[3][1].slice(1, 4)).toEqual([null, null, null]);
    expect(mockQuery.mock.calls[4][0]).toMatch(/UPDATE businesses/);
    expect(res.headers['set-cookie'][0]).toContain('Expires=Thu, 01 Jan 1970');
  });

  test.each(['missing', 'wrong', 'duplicate'])('rejects %s browser cookie before any provider call', async kind => {
    const { state, cookie } = await beginOAuth();
    mockQuery.mockClear();
    global.fetch = jest.fn();
    let call = request(buildApp()).get(`/api/businesses/integrations/stripe/callback?code=code&state=${state}`);
    if (kind === 'wrong') call = call.set('Cookie', 'oxsteed_stripe_oauth=wrong');
    if (kind === 'duplicate') call = call.set('Cookie', `${cookie}; ${cookie}`);
    const res = await call;
    expect(res.headers.location).toContain('stripe=error');
    expect(global.fetch).not.toHaveBeenCalled();
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test.each(['expired', 'future', 'invalid-time', 'extra-segment', 'wrong-business'])
  ('rejects %s state without consuming authorization', async kind => {
    const begun = await beginOAuth();
    const payload = JSON.parse(Buffer.from(begun.state.split('.')[0], 'base64url').toString());
    if (kind === 'expired') payload.ts = Date.now() - 16 * 60 * 1000;
    if (kind === 'future') payload.ts = Date.now() + 10000;
    if (kind === 'invalid-time') payload.ts = 'not-a-timestamp';
    const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const signature = require('crypto').createHmac('sha256', process.env.JWT_SECRET).update(encoded).digest('base64url');
    const state = `${encoded}.${signature}${kind === 'extra-segment' ? '.extra' : ''}`;
    mockQuery.mockClear();
    global.fetch = jest.fn();
    const route = kind === 'wrong-business' ? '/api/businesses/99/integrations/stripe/callback' : '/api/businesses/integrations/stripe/callback';
    const res = await request(buildApp()).get(`${route}?code=code&state=${state}`).set('Cookie', begun.cookie);
    expect(res.headers.location).toContain('stripe=error');
    expect(global.fetch).not.toHaveBeenCalled();
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test('never re-exchanges an already-consumed authorization code', async () => {
    const { state, cookie } = await beginOAuth();
    global.fetch = jest.fn();
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(buildApp())
      .get(`/api/businesses/integrations/stripe/callback?code=code&state=${state}`).set('Cookie', cookie);
    expect(res.headers.location).toContain('already%20used');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('validates and consumes denied consent without linking any account', async () => {
    const { state, cookie } = await beginOAuth();
    global.fetch = jest.fn();
    mockQuery.mockResolvedValueOnce({ rows: [{ business_id: 12 }] });
    const res = await request(buildApp())
      .get(`/api/businesses/integrations/stripe/callback?error=access_denied&state=${state}`).set('Cookie', cookie);
    expect(res.headers.location).toContain('stripe=error&businessId=12');
    expect(global.fetch).not.toHaveBeenCalled();
    expect(mockQuery).toHaveBeenCalledTimes(2);
  });

  test('preserves the legacy callback route with the same validation', async () => {
    const { state, cookie } = await beginOAuth();
    mockStripeConnection();
    mockQuery.mockResolvedValueOnce({ rows: [{ business_id: 12 }] })
      .mockResolvedValueOnce({ rows: [{ id: 12 }] });
    const res = await request(buildApp())
      .get(`/api/businesses/12/integrations/stripe/callback?code=code&state=${state}`).set('Cookie', cookie);
    expect(res.headers.location).toContain('stripe=connected&businessId=12');
  });

  test('rejects an ownership change before persisting connection state', async () => {
    const { state, cookie } = await beginOAuth();
    mockStripeConnection();
    mockQuery.mockResolvedValueOnce({ rows: [{ business_id: 12 }] })
      .mockResolvedValueOnce({ rows: [] });
    const res = await request(buildApp())
      .get(`/api/businesses/integrations/stripe/callback?code=code&state=${state}`).set('Cookie', cookie);
    expect(res.headers.location).toContain('stripe=error');
    expect(mockQuery).toHaveBeenCalledTimes(3);
  });

  test('rejects test-mode connections in production', async () => {
    const { state, cookie } = await beginOAuth();
    process.env.NODE_ENV = 'production';
    mockStripeConnection(false);
    mockQuery.mockResolvedValueOnce({ rows: [{ business_id: 12 }] });
    const res = await request(buildApp())
      .get(`/api/businesses/integrations/stripe/callback?code=code&state=${state}`).set('Cookie', cookie);
    expect(res.headers.location).toContain('test-mode');
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(mockQuery).toHaveBeenCalledTimes(2);
  });

  test('rejects a Stripe Connect callback with invalid state', async () => {
    process.env.CLIENT_URL = 'https://app.oxsteed.test';

    const res = await request(buildApp())
      .get('/api/businesses/12/integrations/stripe/callback?code=oauth_code_123&state=bad.state.value');

    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('/restaurants/merchant?stripe=error&businessId=12');
  });

  test('authenticates provider revocation and clears both local records together', async () => {
    process.env.STRIPE_CLIENT_ID = 'ca_fixture';
    process.env.STRIPE_SECRET_KEY = 'sk_test_fixture';
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ stripe_user_id: 'acct_fixture' }) });
    mockQuery.mockResolvedValueOnce({ rows: [{ stripe_account_id: 'acct_fixture', shared_connection: false }] })
      .mockResolvedValueOnce({ rows: [{ stripe_account_id: 'acct_fixture' }] });
    const res = await request(buildApp()).post('/api/businesses/12/integrations/stripe/disconnect');
    expect(res.status).toBe(200);
    expect(global.fetch).toHaveBeenCalledWith('https://connect.stripe.com/oauth/deauthorize', expect.objectContaining({
      headers: expect.objectContaining({ Authorization: 'Bearer sk_test_fixture' }),
    }));
    expect(mockQuery.mock.calls[1][0]).toContain('FOR UPDATE');
    expect(mockQuery.mock.calls[2][0]).toContain('UPDATE business_integrations');
    expect(mockQuery.mock.calls[3][0]).toContain('UPDATE businesses');
  });

  test('does not erase a connection when provider revocation fails', async () => {
    process.env.STRIPE_CLIENT_ID = 'ca_fixture';
    global.fetch = jest.fn().mockResolvedValue({ ok: false, json: async () => ({ error: 'invalid_client' }) });
    mockQuery.mockResolvedValueOnce({ rows: [{ stripe_account_id: 'acct_fixture' }] });
    const res = await request(buildApp()).post('/api/businesses/12/integrations/stripe/disconnect');
    expect(res.status).toBe(502);
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  test('cannot revoke another business\'s shared account access', async () => {
    global.fetch = jest.fn();
    mockQuery.mockResolvedValueOnce({ rows: [{ stripe_account_id: 'acct_shared', shared_connection: true }] });
    const res = await request(buildApp()).post('/api/businesses/12/integrations/stripe/disconnect');
    expect(res.status).toBe(409);
    expect(global.fetch).not.toHaveBeenCalled();
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });
});
