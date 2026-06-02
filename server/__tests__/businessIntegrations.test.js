'use strict';

const express = require('express');
const request = require('supertest');
const { mockQuery, resetMocks } = require('./setup');
const { errorHandler } = require('../middleware/errorHandler');
const {
  getIntegrations,
  regenerateApiKey,
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
  app.patch('/api/businesses/:businessId/integrations/:integrationType', updateIntegration);
  app.use(errorHandler);
  return app;
}

beforeEach(() => resetMocks());

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
      .mockResolvedValueOnce({ rows: [{ cnt: '2' }] });

    const res = await request(buildApp()).get('/api/businesses/12/integrations');

    expect(res.status).toBe(200);
    expect(res.body.api_key).toBe('oxs_live_existing');
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
    expect(res.body.auth_url).not.toContain('ca_placeholder');
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });
});
