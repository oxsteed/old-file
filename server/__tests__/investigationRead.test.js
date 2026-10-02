'use strict';

/**
 * E13 — the investigation read endpoint: fail closed without a grant, and
 * every served read is audit-logged with purpose + approver.
 */

const { mockQuery, resetMocks } = require('./setup');

const investigationController = require('../controllers/investigationController');

const GRANT = {
  id: 7,
  investigation_ref: 'fraud-case-9',
  requester_admin_id: 'admin-requester',
  approver_admin_id: 'admin-approver',
  purpose: 'Follow up on disputed payout for fraud case 9',
  scope_user_ids: ['user-1'],
  status: 'active',
  expires_at: new Date(Date.now() + 3600_000).toISOString(),
  revoked_at: null,
};

function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

const next = jest.fn();

beforeEach(() => {
  resetMocks();
  next.mockClear();
});

describe('E13 investigation read endpoint', () => {
  test('no grant and not super-admin -> 403, no user data', async () => {
    mockQuery.mockImplementation(async (sql) => {
      if (sql.includes('FROM investigation_access_grants')) return { rows: [], rowCount: 0 };
      return { rows: [], rowCount: 0 };
    });
    const req = {
      user: { id: 'admin-requester', role: 'admin' },
      isSuper: false,
      params: { userId: 'user-1' },
      ip: '127.0.0.1',
      get: () => null,
    };
    const res = mockRes();
    await investigationController.readInvestigationProfile(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'investigation_access_required' })
    );
    // The user row was never fetched.
    expect(mockQuery.mock.calls.some(([sql]) => String(sql).includes('FROM users u'))).toBe(false);
  });

  test('active grant -> 200 and the read is audit-logged with purpose + approver', async () => {
    mockQuery.mockImplementation(async (sql) => {
      if (sql.includes('FROM investigation_access_grants')) return { rows: [GRANT], rowCount: 1 };
      if (sql.includes('FROM users u')) {
        return { rows: [{ id: 'user-1', email: 'u@example.com' }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });
    const req = {
      user: { id: 'admin-requester', role: 'admin' },
      isSuper: false,
      params: { userId: 'user-1' },
      ip: '127.0.0.1',
      get: () => null,
    };
    const res = mockRes();
    await investigationController.readInvestigationProfile(req, res, next);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ user: expect.objectContaining({ id: 'user-1' }) })
    );

    const auditCall = mockQuery.mock.calls.find(([sql]) =>
      String(sql).includes('INSERT INTO admin_audit_log')
    );
    expect(auditCall).toBeDefined();
    const flat = JSON.stringify(auditCall[1]);
    expect(flat).toContain('investigation_read');
    expect(flat).toContain('fraud case 9'); // purpose
    expect(flat).toContain('admin-approver'); // approver
  });

  test('super-admin reads are allowed and still audit-logged', async () => {
    mockQuery.mockImplementation(async (sql) => {
      if (sql.includes('FROM users u')) {
        return { rows: [{ id: 'user-9', email: 'u9@example.com' }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });
    const req = {
      user: { id: 'super-1', role: 'super_admin' },
      isSuper: true,
      params: { userId: 'user-9' },
      ip: '127.0.0.1',
      get: () => null,
    };
    const res = mockRes();
    await investigationController.readInvestigationProfile(req, res, next);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ user: expect.objectContaining({ id: 'user-9' }) })
    );
    const auditCall = mockQuery.mock.calls.find(([sql]) =>
      String(sql).includes('INSERT INTO admin_audit_log')
    );
    expect(auditCall).toBeDefined();
    expect(JSON.stringify(auditCall[1])).toContain('investigation_read');
  });
});
