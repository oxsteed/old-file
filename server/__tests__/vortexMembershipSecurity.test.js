'use strict';

/**
 * P1-e: Vortex membership + access-code security tests.
 * - Manager role cap: non-owner requesting role:'manager' gets 'representative'
 * - Deny is pending-only: active memberships are NOT denied
 * - Show-once: create returns the secret, list masks active codes to NULL
 *
 * These unit-test the controller logic with a mocked pool.
 */

jest.mock('../db', () => ({ query: jest.fn() }));
jest.mock('../services/permissionsService', () => ({ invalidateCache: jest.fn() }));
jest.mock('../services/notificationService', () => ({ sendNotification: jest.fn().mockResolvedValue({}) }));

const pool = require('../db');
const access = require('../controllers/businessAccessCodesController');

function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

function baseReq(overrides = {}) {
  return {
    user: { id: 'user-1', email: 'user@example.com' },
    business: { id: 1, business_name: 'Test Biz', owner_id: 'owner-1' },
    params: {},
    body: {},
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  // Default: logBusinessAction is called internally; mock it via the controller's
  // dependency. The controller requires it at top-level, so we stub pool only
  // and let the audit log hit the mocked pool.
  pool.query.mockResolvedValue({ rows: [], rowCount: 0 });
});

describe('manager role cap', () => {
  test('non-owner requesting manager role gets representative', async () => {
    const req = baseReq({
      body: { role: 'manager', label: 'test' },
    });
    // user-1 is not the owner (owner-1)
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: 1, code: 'VRTX-ABC123' }], rowCount: 1 }) // INSERT
      .mockResolvedValue({ rows: [], rowCount: 0 });

    const res = mockRes();
    const next = jest.fn();
    await access.createAccessCode(req, res, next);

    expect(next).not.toHaveBeenCalled();
    // The INSERT should have used 'representative', not 'manager'
    const insertCall = pool.query.mock.calls.find((c) => c[0].includes('INSERT INTO business_access_codes'));
    expect(insertCall).toBeDefined();
    // role is the 4th parameter (business_id, code, role, ...)
    const roleParam = insertCall[1][2];
    expect(roleParam).toBe('representative');
  });

  test('owner requesting manager role keeps manager', async () => {
    const req = baseReq({
      user: { id: 'owner-1', email: 'owner@example.com' },
      body: { role: 'manager', label: 'test' },
    });
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: 1, code: 'VRTX-ABC123' }], rowCount: 1 })
      .mockResolvedValue({ rows: [], rowCount: 0 });

    const res = mockRes();
    const next = jest.fn();
    await access.createAccessCode(req, res, next);

    const insertCall = pool.query.mock.calls.find((c) => c[0].includes('INSERT INTO business_access_codes'));
    expect(insertCall[1][2]).toBe('manager');
  });
});

describe('deny is pending-only', () => {
  test('deny does not touch active memberships', async () => {
    const req = baseReq({ params: { membershipId: '5' } });
    // Simulate: no pending row found (UPDATE ... WHERE status='pending' hits 0)
    pool.query.mockResolvedValue({ rows: [], rowCount: 0 });

    const res = mockRes();
    const next = jest.fn();
    await access.denyMembership(req, res, next);

    expect(res.status).toHaveBeenCalledWith(404);
    // Verify the UPDATE was scoped to pending only
    const updateCall = pool.query.mock.calls.find((c) => c[0].includes('UPDATE business_members'));
    expect(updateCall[0]).toContain("status = 'pending'");
    expect(updateCall[0]).not.toContain("'active'");
  });
});

describe('remove (kick) is active-only', () => {
  test('remove rejects pending memberships', async () => {
    const req = baseReq({ params: { membershipId: '5' } });
    pool.query.mockResolvedValue({ rows: [], rowCount: 0 }); // SELECT finds nothing active

    const res = mockRes();
    const next = jest.fn();
    await access.removeMembership(req, res, next);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('remove rejects self-removal', async () => {
    const req = baseReq({ params: { membershipId: '5' } });
    pool.query.mockResolvedValue({
      rows: [{ id: 5, member_id: 'user-1', role: 'employee' }],
      rowCount: 1,
    });

    const res = mockRes();
    const next = jest.fn();
    await access.removeMembership(req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
  });
});

describe('show-once copy', () => {
  test('create returns the full secret exactly once', async () => {
    const req = baseReq({ body: { role: 'employee' } });
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: 1, code: 'VRTX-SECRET123', role: 'employee' }], rowCount: 1 })
      .mockResolvedValue({ rows: [], rowCount: 0 });

    const res = mockRes();
    await access.createAccessCode(req, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(201);
    const payload = res.json.mock.calls[0][0];
    expect(payload.data.code).toBe('VRTX-SECRET123');
  });

  test('list masks active code secrets to NULL', async () => {
    const req = baseReq();
    // Simulate the SQL CASE: active -> NULL, revoked -> plaintext
    pool.query.mockImplementation(async (sql) => {
      if (sql.includes('CASE WHEN bac.is_active THEN NULL')) {
        return {
          rows: [
            { id: 1, code: null, is_active: true },
            { id: 2, code: 'VRTX-OLD', is_active: false },
          ],
        };
      }
      return { rows: [], rowCount: 0 };
    });

    const res = mockRes();
    await access.listAccessCodes(req, res, jest.fn());

    const payload = res.json.mock.calls[0][0];
    expect(payload.data[0].code).toBeNull();
    expect(payload.data[1].code).toBe('VRTX-OLD');
    // The masking must happen in SQL, not in JS post-processing
    const listCall = pool.query.mock.calls.find((c) => c[0].includes('FROM business_access_codes'));
    expect(listCall[0]).toContain('CASE WHEN bac.is_active THEN NULL');
  });
});

describe('token sweeper', () => {
  test('expireVortexTokens marks expired unused tokens revoked', async () => {
    const { expireVortexTokens } = require('../workers/vortexTokenWorkers');
    pool.query.mockResolvedValue({ rowCount: 3 });

    const result = await expireVortexTokens({ limit: 500 });

    expect(result).toEqual({ expired: 3 });
    const call = pool.query.mock.calls[0];
    expect(call[0]).toContain('expires_at < NOW()');
    expect(call[0]).toContain('used_at IS NULL');
    expect(call[0]).toContain('is_revoked = FALSE');
    expect(call[0]).toContain('SET is_revoked = TRUE');
  });

  test('expireVortexTokens is a no-op when nothing expired', async () => {
    jest.clearAllMocks();
    const { expireVortexTokens } = require('../workers/vortexTokenWorkers');
    pool.query.mockResolvedValue({ rowCount: 0 });

    const result = await expireVortexTokens({});
    expect(result).toEqual({ expired: 0 });
  });
});
