'use strict';

/**
 * Connector grant delegation (auth-audit finding 30).
 *
 * requireConnectorGrant used an inline direct-only grant query while the
 * interactive GRANT_LOOKUP_SQL unions delegation_grants with grantor-authority
 * verification. Delegated admins got a fail-closed 403 on connector mutations
 * that the UI authorized. The connector path now reuses the shared lookup,
 * so delegated grants authorize exactly like interactive routes.
 */

const { mockQuery, resetMocks } = require('./setup');

jest.mock('../middleware/adminAuth', () => {
  const actual = jest.requireActual('../middleware/adminAuth');
  return { ...actual, lookupGrants: jest.fn() };
});
const { lookupGrants } = require('../middleware/adminAuth');
const { requireConnectorGrant } = require('../middleware/connectorAuth');

function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

beforeEach(() => {
  resetMocks();
  jest.clearAllMocks();
});

describe('requireConnectorGrant mirrors the delegated branch', () => {
  test('a delegated (non-direct) grant authorizes the connector action', async () => {
    lookupGrants.mockResolvedValue([
      { id: 9, region_id: null, grant_source: 'delegated' },
    ]);
    const req = { connectorUser: { id: 'admin-1', role: 'admin', email: 'a@x.test' } };
    const res = mockRes();
    const next = jest.fn();
    await requireConnectorGrant('manage_operations')(req, res, next);
    expect(lookupGrants).toHaveBeenCalledWith('admin-1', 'manage_operations');
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  test('no grant at all still 403s (fail closed)', async () => {
    lookupGrants.mockResolvedValue([]);
    const req = { connectorUser: { id: 'admin-2', role: 'admin', email: 'a@x.test' } };
    const res = mockRes();
    const next = jest.fn();
    await requireConnectorGrant('manage_operations')(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  test('region-limited grants cannot authorize global connector actions', async () => {
    lookupGrants.mockResolvedValue([{ id: 9, region_id: 4, grant_source: 'direct' }]);
    const req = { connectorUser: { id: 'admin-3', role: 'admin', email: 'a@x.test' } };
    const res = mockRes();
    const next = jest.fn();
    await requireConnectorGrant('manage_operations')(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'global_permission_required' }));
    expect(next).not.toHaveBeenCalled();
  });

  test('super_admin still bypasses', async () => {
    const req = { connectorUser: { id: 'super-1', role: 'super_admin', email: 's@x.test' } };
    const res = mockRes();
    const next = jest.fn();
    await requireConnectorGrant('manage_operations')(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(lookupGrants).not.toHaveBeenCalled();
  });
});
