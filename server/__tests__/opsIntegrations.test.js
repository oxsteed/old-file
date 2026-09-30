'use strict';

const { mockQuery, resetMocks } = require('./setup');
const controller = require('../controllers/opsIntegrationsController');
const stripeFactory = require('stripe');

function responseDouble() {
  return { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
}

function reqDouble(overrides = {}) {
  return {
    params: {},
    query: {},
    body: {},
    user: { id: 'admin-uuid-1' },
    headers: {},
    ...overrides,
  };
}

const STRIPE_INTEGRATION = {
  id: 'a1b2c3d4-e5f6-4a5b-8c9d-0123456789ab',
  business_id: 42,
  integration_type: 'stripe',
  integration_name: 'Stripe Connect',
  is_connected: true,
  is_enabled: true,
  config_json: { account_id: 'acct_123' },
  last_sync_at: null,
  updated_at: '2026-09-29T12:00:00Z',
  provider_account_id: 'acct_123',
};

const DISABLED_INTEGRATION = {
  ...STRIPE_INTEGRATION,
  id: 'b2c3d4e5-f6a7-4b5c-8d9e-0123456789bc',
  is_enabled: false,
  provider_account_id: 'acct_123',
};

const stripeInstance = stripeFactory.__mockInstance;

beforeEach(() => {
  resetMocks();
  stripeInstance.accounts.retrieve.mockReset();
});

describe('listIntegrations', () => {
  test('passes filter params through to the query', async () => {
    mockQuery.mockImplementation(async (sql) => {
      const text = String(sql);
      if (text.includes('FROM business_integrations i')) {
        if (text.includes('AS total')) return { rows: [{ total: '2' }] };
        return { rows: [{ ...STRIPE_INTEGRATION, failed_deliveries_24h: '0' }] };
      }
      return { rows: [] };
    });

    const res = responseDouble();
    await controller.listIntegrations(
      reqDouble({ query: { status: 'connected', type: 'stripe', business_id: '42', limit: '10', offset: '0' } }),
      res,
      jest.fn()
    );

    expect(res.json).toHaveBeenCalled();
    const [listQuery, listParams] = mockQuery.mock.calls.find(([sql]) =>
      String(sql).includes('FROM business_integrations i') && !String(sql).includes('AS total')
    );
    expect(listQuery).toMatch(/i\.integration_type = \$1/);
    expect(listQuery).toMatch(/i\.business_id = \$2/);
    expect(listQuery).toMatch(/is_connected = TRUE AND i\.is_enabled = TRUE/);
    expect(listParams.slice(0, 3)).toEqual(['stripe', 42, 10]);
    expect(listQuery).toMatch(/webhook_delivery_log/);
    expect(listQuery).toMatch(/business_name/);

    const payload = res.json.mock.calls[0][0];
    expect(payload.integrations).toHaveLength(1);
    expect(payload.integrations[0]).toMatchObject({
      id: STRIPE_INTEGRATION.id,
      integration_type: 'stripe',
      failed_deliveries_24h: 0,
    });
    expect(payload.total).toBe(2);
    expect(payload.limit).toBe(10);
  });

  test('clamps limit at 100', async () => {
    mockQuery.mockImplementation(async (sql) => {
      const text = String(sql);
      if (text.includes('COUNT(*)')) return { rows: [{ total: '0' }] };
      if (text.includes('FROM business_integrations i')) return { rows: [] };
      return { rows: [] };
    });
    const res = responseDouble();
    await controller.listIntegrations(reqDouble({ query: { limit: '500' } }), res, jest.fn());
    expect(res.json.mock.calls[0][0].limit).toBe(100);
  });

  test('rejects unknown status filter', async () => {
    const res = responseDouble();
    await controller.listIntegrations(reqDouble({ query: { status: 'bogus' } }), res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].code).toBe('invalid_status');
    expect(mockQuery).not.toHaveBeenCalled();
  });
});

describe('testIntegration', () => {
  test('missing integration returns 404', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    const res = responseDouble();
    await controller.testIntegration(
      reqDouble({ params: { id: 'a1b2c3d4-e5f6-4a5b-8c9d-0123456789ab' } }),
      res,
      jest.fn()
    );
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json.mock.calls[0][0].code).toBe('integration_not_found');
    expect(stripeInstance.accounts.retrieve).not.toHaveBeenCalled();
  });

  test('stripe check returns capabilities mapping', async () => {
    mockQuery.mockResolvedValue({ rows: [STRIPE_INTEGRATION] });
    stripeInstance.accounts.retrieve.mockResolvedValue({
      id: 'acct_123',
      charges_enabled: true,
      payouts_enabled: false,
      details_submitted: true,
    });

    const res = responseDouble();
    await controller.testIntegration(
      reqDouble({ params: { id: STRIPE_INTEGRATION.id } }),
      res,
      jest.fn()
    );

    expect(stripeInstance.accounts.retrieve).toHaveBeenCalledWith('acct_123');
    expect(res.json).toHaveBeenCalledWith({
      ok: true,
      checked: true,
      integration_type: 'stripe',
      account_id: 'acct_123',
      charges_enabled: true,
      payouts_enabled: false,
      details_submitted: true,
    });
  });

  test('non-stripe provider returns checked:false with reason', async () => {
    mockQuery.mockResolvedValue({
      rows: [{ ...STRIPE_INTEGRATION, integration_type: 'slack', provider_account_id: null }],
    });
    const res = responseDouble();
    await controller.testIntegration(
      reqDouble({ params: { id: STRIPE_INTEGRATION.id } }),
      res,
      jest.fn()
    );
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ ok: true, checked: false, reason: 'no automated check for this provider' })
    );
    expect(stripeInstance.accounts.retrieve).not.toHaveBeenCalled();
  });

  test('stripe SDK error returns 502 with ok:false and records test metadata', async () => {
    mockQuery.mockImplementation(async (sql) => {
      const text = String(sql);
      if (text.includes('FROM business_integrations i')) return { rows: [STRIPE_INTEGRATION] };
      if (text.includes('UPDATE business_integrations')) return { rows: [] };
      return { rows: [] };
    });
    stripeInstance.accounts.retrieve.mockRejectedValue(new Error('account not found'));

    const res = responseDouble();
    await controller.testIntegration(
      reqDouble({ params: { id: STRIPE_INTEGRATION.id } }),
      res,
      jest.fn()
    );

    expect(res.status).toHaveBeenCalledWith(502);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ ok: false, error: 'account not found' })
    );
    const metaUpdate = mockQuery.mock.calls.find(([sql]) =>
      String(sql).includes('UPDATE business_integrations') && String(sql).includes('config_json')
    );
    expect(metaUpdate).toBeTruthy();
    expect(metaUpdate[1][1]).toMatch(/last_test_at/);
    expect(metaUpdate[1][1]).toMatch(/account not found/);
    // No audit rows for read-only tests
    expect(
      mockQuery.mock.calls.some(([sql]) => String(sql).includes('admin_audit_log'))
    ).toBe(false);
  });
});

describe('reconnectIntegration', () => {
  test('returns 409 when the integration is not disabled', async () => {
    mockQuery.mockResolvedValue({ rows: [STRIPE_INTEGRATION] }); // is_enabled true
    const res = responseDouble();
    await controller.reconnectIntegration(
      reqDouble({ params: { id: STRIPE_INTEGRATION.id } }),
      res,
      jest.fn()
    );
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json.mock.calls[0][0].code).toBe('integration_not_disabled');
    expect(
      mockQuery.mock.calls.some(([sql]) => String(sql).includes('UPDATE business_integrations'))
    ).toBe(false);
  });

  test('reconnects a disabled integration, writes an audit row, and returns the row', async () => {
    const reconnected = { ...DISABLED_INTEGRATION, is_connected: true, is_enabled: true };
    mockQuery.mockImplementation(async (sql) => {
      const text = String(sql);
      if (text.includes('FROM business_integrations i')) return { rows: [DISABLED_INTEGRATION] };
      if (text.includes('UPDATE business_integrations')) return { rows: [reconnected] };
      if (text.includes('admin_audit_log')) return { rows: [] };
      return { rows: [] };
    });

    const res = responseDouble();
    await controller.reconnectIntegration(
      reqDouble({ params: { id: DISABLED_INTEGRATION.id } }),
      res,
      jest.fn()
    );

    const updateCall = mockQuery.mock.calls.find(([sql]) =>
      String(sql).includes('UPDATE business_integrations')
    );
    expect(updateCall[0]).toMatch(/is_connected = TRUE/);
    expect(updateCall[0]).toMatch(/is_enabled = TRUE/);
    expect(updateCall[0]).toMatch(/disabled_at/);

    const auditCall = mockQuery.mock.calls.find(([sql]) =>
      String(sql).includes('INSERT INTO admin_audit_log')
    );
    expect(auditCall).toBeTruthy();
    expect(auditCall[1][1]).toBe('ops_integration_reconnected');
    expect(auditCall[1][2]).toBe('business_integration');
    expect(auditCall[1][3]).toBe(DISABLED_INTEGRATION.id);
    expect(auditCall[1][0]).toBe('admin-uuid-1');

    expect(res.json).toHaveBeenCalledWith({ success: true, integration: reconnected });
  });

  test('missing integration returns 404', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    const res = responseDouble();
    await controller.reconnectIntegration(
      reqDouble({ params: { id: DISABLED_INTEGRATION.id } }),
      res,
      jest.fn()
    );
    expect(res.status).toHaveBeenCalledWith(404);
  });
});

describe('routes/opsIntegrations', () => {
  test('registers GET /, POST /:id/test, POST /:id/reconnect with admin guards', () => {
    const express = require('express');
    const router = require('../routes/opsIntegrations');
    expect(typeof router).toBe('function');
    // Express Router created via express.Router() is a function with stack layers
    const paths = router.stack
      .filter((layer) => layer.route)
      .map((layer) => ({
        path: layer.route.path,
        methods: Object.keys(layer.route.methods).filter((m) => layer.route.methods[m]),
        handlers: layer.route.stack.length,
      }));
    expect(paths).toContainEqual(
      expect.objectContaining({ path: '/', methods: ['get'], handlers: 3 })
    );
    expect(paths).toContainEqual(
      expect.objectContaining({ path: '/:id/test', methods: ['post'], handlers: 3 })
    );
    expect(paths).toContainEqual(
      expect.objectContaining({ path: '/:id/reconnect', methods: ['post'], handlers: 3 })
    );
    expect(express).toBeDefined();
  });
});
