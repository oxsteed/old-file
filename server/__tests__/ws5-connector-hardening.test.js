/**
 * WS5 — H4 connector 2FA hard-block + per-endpoint grant checks, C3 guard.
 *
 * H4: connector API keys are admin credentials, so an admin key holder
 * without enrolled 2FA is rejected (connector_2fa_required), and every
 * sensitive connector endpoint requires the matching permission grant
 * (super_admins bypass). Admin/super_admin key *issuers* must also have
 * 2FA enrolled before they can generate API keys.
 *
 * C3: migration 624 drops the CHECK that made revoking a used product key
 * fail with 500; the migration-presence test below guards the fix.
 */
'use strict';

const { Pool } = require('pg');

const mockRes = () => {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

describe('H4: connector 2FA hard-block (loadConnectorUser)', () => {
  let loadConnectorUser;
  let requireConnectorGrant;

  beforeEach(() => {
    Pool.mockQuery.mockReset();
    ({ loadConnectorUser, requireConnectorGrant } = require('../middleware/connectorAuth'));
  });

  test('rejects an admin key holder without enrolled 2FA', async () => {
    Pool.mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'u1', role: 'admin', email: 'a@x.com', is_active: true, totp_enabled: false }],
    });
    const req = { apiKey: { customerId: 'u1' } };
    const res = mockRes();
    const next = jest.fn();
    await loadConnectorUser(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'connector_2fa_required' }));
    expect(next).not.toHaveBeenCalled();
  });

  test('allows an admin key holder with enrolled 2FA', async () => {
    Pool.mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'u1', role: 'admin', email: 'a@x.com', is_active: true, totp_enabled: true }],
    });
    const req = { apiKey: { customerId: 'u1' } };
    const res = mockRes();
    const next = jest.fn();
    await loadConnectorUser(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(req.connectorUser).toEqual({ id: 'u1', role: 'admin', email: 'a@x.com' });
  });
});

describe('H4: requireConnectorGrant', () => {
  let requireConnectorGrant;

  beforeEach(() => {
    Pool.mockQuery.mockReset();
    ({ requireConnectorGrant } = require('../middleware/connectorAuth'));
  });

  test('super_admin bypasses the grant check', async () => {
    const req = { connectorUser: { id: 's1', role: 'super_admin' } };
    const next = jest.fn();
    await requireConnectorGrant('manage_operations')(req, mockRes(), next);
    expect(next).toHaveBeenCalled();
    expect(Pool.mockQuery).not.toHaveBeenCalled();
  });

  test('admin with an active global grant passes', async () => {
    Pool.mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'g1', region_id: null }],
    });
    const req = { connectorUser: { id: 'a1', role: 'admin' } };
    const next = jest.fn();
    await requireConnectorGrant('view_financials')(req, mockRes(), next);
    expect(next).toHaveBeenCalled();
    expect(Pool.mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('admin_permission_grants'),
      ['a1', 'view_financials']
    );
  });

  test('admin with no grant is rejected with connector_grant_required', async () => {
    Pool.mockQuery.mockResolvedValueOnce({ rows: [] });
    const req = { connectorUser: { id: 'a1', role: 'admin' } };
    const res = mockRes();
    const next = jest.fn();
    await requireConnectorGrant('manage_operations')(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'connector_grant_required' }));
    expect(next).not.toHaveBeenCalled();
  });

  test('regional-only grant cannot authorize a global connector action', async () => {
    Pool.mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'g1', region_id: 'region-9' }],
    });
    const req = { connectorUser: { id: 'a1', role: 'admin' } };
    const res = mockRes();
    const next = jest.fn();
    await requireConnectorGrant('approve_settings')(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'global_permission_required' }));
    expect(next).not.toHaveBeenCalled();
  });
});

describe('H4: sensitive connector routes carry grant middleware', () => {
  const fs = require('fs');

  const routeSource = fs.readFileSync(
    require('path').join(__dirname, '../routes/connector.js'),
    'utf8'
  );

  const cases = [
    ['POST', '/reconciliation-exceptions/:id/acknowledge', 'manage_operations'],
    ['POST', '/reconciliation-exceptions/:id/assign', 'manage_operations'],
    ['POST', '/reconciliation-exceptions/:id/resolve', 'manage_operations'],
    ['POST', '/dead-letters/:id/requeue', 'manage_operations'],
    ['POST', '/webhooks/retry', 'manage_operations'],
    ['POST', '/settings-changes/:id/approve', 'approve_settings'],
    ['POST', '/settings-changes/:id/reject', 'approve_settings'],
    ['GET', '/payouts', 'view_financials'],
    ['GET', '/fraud-cases', 'view_financials'],
  ];

  test.each(cases)('%s %s requires grant %s', (_method, path, grant) => {
    const line = routeSource
      .split('\n')
      .find((l) => l.includes(`'${path}'`));
    expect(line).toBeDefined();
    expect(line).toContain(`requireConnectorGrant('${grant}')`);
  });
});

describe('H4: admin key issuers must have 2FA enrolled', () => {
  beforeEach(() => {
    Pool.mockQuery.mockReset();
  });

  test('admin issuer without 2FA cannot generate an API key', async () => {
    const ctrl = require('../controllers/apiProductsController');
    Pool.mockQuery.mockResolvedValueOnce({ rows: [{ totp_enabled: false }] });
    const req = { user: { id: 'a1', role: 'admin' }, params: { productId: 'p1' } };
    const res = mockRes();
    await ctrl.generateApiKey(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'admin_2fa_required' }));
    // product lookup must not run: the issuer is stopped at the 2FA gate
    expect(Pool.mockQuery).toHaveBeenCalledTimes(1);
  });

  test('admin issuer with 2FA proceeds to key generation', async () => {
    const ctrl = require('../controllers/apiProductsController');
    Pool.mockQuery
      .mockResolvedValueOnce({ rows: [{ totp_enabled: true }] })
      .mockResolvedValueOnce({ rows: [{ id: 'p1' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'k1' }] });
    const req = { user: { id: 'a1', role: 'admin' }, params: { productId: 'p1' } };
    const res = mockRes();
    await ctrl.generateApiKey(req, res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });
});

describe('C3: revoke guard migration present', () => {
  const fs = require('fs');

  test('migration 624 drops the CHECK that made revoking a used key 500', () => {
    const sql = fs.readFileSync(
      require('path').join(__dirname, '../migrations/624_ws5_audit_evidence_guards.sql'),
      'utf8'
    );
    expect(sql).toMatch(/DROP\s+CONSTRAINT\s+IF\s+EXISTS\s+not_revoked_and_used/i);
  });
});
