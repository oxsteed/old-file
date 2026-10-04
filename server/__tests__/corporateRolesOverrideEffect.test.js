'use strict';

/**
 * CR1: strict permission-override effect validation in setOverrides.
 *
 * Regression: the grant guard only rejected entries whose effect was exactly
 * 'allow', while persistence mapped anything non-'deny' to 'allow'. A
 * lower-level admin could submit an unsupported effect (e.g. 'force') for a
 * permission they do not hold and get an allow override persisted.
 *
 * The fix validates every entry strictly (only 'allow'/'deny' accepted, 400
 * otherwise) before any guard or persistence runs, and the persistence mapping
 * only persists 'allow' as allow.
 */

jest.mock('../db', () => ({ connect: jest.fn() }));
jest.mock('../services/corporateRolesService', () => ({
  getMaxActiveSeniority: jest.fn(),
  getEffectiveCorporatePermissions: jest.fn(),
  invalidateCache: jest.fn(),
}));
jest.mock('../utils/logger', () => ({
  warn: jest.fn(),
  info: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

const pool = require('../db');
const corporateRolesService = require('../services/corporateRolesService');
const { setOverrides } = require('../controllers/corporateRolesController');

function mockClient() {
  return { query: jest.fn(), release: jest.fn() };
}
function mockReq(overrides) {
  return {
    params: { id: '7' },
    body: { overrides },
    user: { id: 'u-admin', role: 'admin' },
    isSuper: false,
  };
}
function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}
const next = jest.fn();

// Resolves the happy-path query chain: BEGIN, assignment, perms, DELETE,
// INSERT, audit INSERT, COMMIT.
function stubHappyPath(client, { assignmentCode = 'manage_users', permId = 11 } = {}) {
  client.query.mockImplementation((sql) => {
    if (sql === 'BEGIN') return Promise.resolve({ rows: [] });
    if (sql.includes('FROM corporate_assignments ca')) {
      return Promise.resolve({
        rows: [{ id: 7, user_id: 'u-target', seniority_level: 3, is_csuite: false }],
      });
    }
    if (sql.includes('FROM corporate_permissions')) {
      return Promise.resolve({ rows: [{ id: permId, code: assignmentCode }] });
    }
    return Promise.resolve({ rows: [], rowCount: 0 });
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  corporateRolesService.getMaxActiveSeniority.mockResolvedValue(5);
  corporateRolesService.getEffectiveCorporatePermissions.mockResolvedValue({
    // Caller only holds manage_users.
    permissions: new Set(['manage_users']),
  });
});

describe('setOverrides effect validation (CR1)', () => {
  test('rejects an unsupported effect with 400 and persists nothing', async () => {
    const client = mockClient();
    pool.connect.mockResolvedValue(client);

    const req = mockReq([
      // Caller does NOT hold issue_refunds; 'force' is not 'allow', so the old
      // guard skipped it, and the old mapping persisted it as allow.
      { code: 'issue_refunds', effect: 'force', reason: 'escalate' },
    ]);
    const res = mockRes();

    await setOverrides(req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'invalid_override_effect' })
    );
    // Nothing reaches the database: no transaction, no override writes.
    expect(pool.connect).not.toHaveBeenCalled();
    const overrideWrites = client.query.mock.calls.filter(([sql]) =>
      typeof sql === 'string' &&
      sql.includes('corporate_assignment_permission_overrides')
    );
    expect(overrideWrites).toHaveLength(0);
  });

  test('rejects a missing effect and non-object entries with 400', async () => {
    const client = mockClient();
    pool.connect.mockResolvedValue(client);

    for (const badEntry of [
      [{ code: 'manage_users' }],
      [{ code: 'manage_users', effect: 'ALLOW' }],
      [null],
      ['allow'],
    ]) {
      const res = mockRes();
      await setOverrides(mockReq(badEntry), res, next);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ code: 'invalid_override_effect' })
      );
    }
    expect(pool.connect).not.toHaveBeenCalled();
  });

  test('persists allow as allow when the caller holds the permission', async () => {
    const client = mockClient();
    pool.connect.mockResolvedValue(client);
    stubHappyPath(client);

    const res = mockRes();
    await setOverrides(mockReq([{ code: 'manage_users', effect: 'allow' }]), res, next);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ assignment_id: 7 }) })
    );
    const insertCall = client.query.mock.calls.find(([sql]) =>
      typeof sql === 'string' && sql.includes('INSERT INTO corporate_assignment_permission_overrides')
    );
    expect(insertCall).toBeDefined();
    // params: assignment_id, permission_id, effect, reason, granted_by, expires_at
    expect(insertCall[1][2]).toBe('allow');
  });

  test('persists deny as deny', async () => {
    const client = mockClient();
    pool.connect.mockResolvedValue(client);
    stubHappyPath(client);

    const res = mockRes();
    await setOverrides(mockReq([{ code: 'manage_users', effect: 'deny' }]), res, next);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ assignment_id: 7 }) })
    );
    const insertCall = client.query.mock.calls.find(([sql]) =>
      typeof sql === 'string' && sql.includes('INSERT INTO corporate_assignment_permission_overrides')
    );
    expect(insertCall).toBeDefined();
    expect(insertCall[1][2]).toBe('deny');
  });

  test('still rejects granting an unheld permission with a valid allow effect', async () => {
    const client = mockClient();
    pool.connect.mockResolvedValue(client);
    stubHappyPath(client);

    const res = mockRes();
    await setOverrides(
      mockReq([{ code: 'issue_refunds', effect: 'allow' }]),
      res,
      next
    );

    expect(res.status).toHaveBeenCalledWith(403);
    const overrideWrites = client.query.mock.calls.filter(([sql]) =>
      typeof sql === 'string' &&
      sql.includes('corporate_assignment_permission_overrides')
    );
    expect(overrideWrites).toHaveLength(0);
  });
});
