'use strict';

/**
 * E13 — Controlled investigation access.
 *
 * Failing reproduction: there is no purpose-limited, approver-tied read
 * path for investigations. An admin with a broad grant can read any user's
 * full PII bundle with no recorded purpose, no approver, no expiry, and no
 * scope limit.
 *
 * The contract we need:
 *   1. investigation_access_grants: requester names a purpose, a scope
 *      (explicit user ids, capped), an expiry (capped), and an approver.
 *      Self-approval is rejected; the approver must be authorized.
 *   2. The grant starts pending; only the named approver (or a
 *      super-admin, never the requester) can activate it.
 *   3. Every elevated read through the investigation endpoint checks for
 *      an active, unexpired, unrevoked grant covering the target user,
 *      and writes an audit row with purpose + approver. No grant (and not
 *      super-admin) -> 403, fail closed.
 */

const { mockQuery, resetMocks } = require('./setup');

const {
  requestInvestigationAccess,
  approveInvestigationAccess,
  revokeInvestigationAccess,
  checkInvestigationAccess,
} = require('../services/investigationAccessService');

beforeEach(() => {
  resetMocks();
});

function grantRow(overrides = {}) {
  return {
    id: 1,
    investigation_ref: 'fraud-case-9',
    requester_admin_id: 'admin-requester',
    approver_admin_id: 'admin-approver',
    purpose: 'Follow up on disputed payout for fraud case 9',
    scope_user_ids: ['user-1', 'user-2'],
    status: 'active',
    expires_at: new Date(Date.now() + 3600_000).toISOString(),
    revoked_at: null,
    ...overrides,
  };
}

describe('E13 grant lifecycle', () => {
  test('request validates purpose, scope, expiry, and approver', async () => {
    mockQuery.mockImplementation(async () => ({ rows: [{ id: 1 }], rowCount: 1 }));

    // Empty purpose rejected.
    await expect(requestInvestigationAccess({
      requesterId: 'a1', approverId: 'a2', purpose: '  ',
      scopeUserIds: ['u1'], investigationRef: 'x',
    })).rejects.toThrow(/purpose/i);

    // Self-approval rejected.
    await expect(requestInvestigationAccess({
      requesterId: 'a1', approverId: 'a1', purpose: 'Valid purpose here',
      scopeUserIds: ['u1'], investigationRef: 'x',
    })).rejects.toThrow(/self-approval/i);

    // Oversized scope rejected (fail closed).
    await expect(requestInvestigationAccess({
      requesterId: 'a1', approverId: 'a2', purpose: 'Valid purpose here',
      scopeUserIds: Array.from({ length: 26 }, (_, i) => `u${i}`),
      investigationRef: 'x',
    })).rejects.toThrow(/scope/i);

    // Expiry beyond the cap rejected.
    await expect(requestInvestigationAccess({
      requesterId: 'a1', approverId: 'a2', purpose: 'Valid purpose here',
      scopeUserIds: ['u1'], investigationRef: 'x',
      expiresAt: new Date(Date.now() + 30 * 24 * 3600_000).toISOString(),
    })).rejects.toThrow(/72 hours/);
  });

  test('only the named approver (never the requester) can activate', async () => {
    const pending = grantRow({ status: 'pending' });
    mockQuery.mockImplementation(async (sql, params) => {
      if (sql.includes('FROM investigation_access_grants')) return { rows: [pending], rowCount: 1 };
      if (sql.includes('SELECT role')) return { rows: [{ role: 'super_admin' }], rowCount: 1 };
      if (sql.includes('UPDATE investigation_access_grants')) {
        return { rows: [{ ...pending, status: 'active' }], rowCount: 1 };
      }
      return { rows: [{ id: 1 }], rowCount: 1 };
    });

    // Requester trying to approve their own request -> rejected.
    await expect(approveInvestigationAccess({
      grantId: 1, approverId: 'admin-requester',
    })).rejects.toThrow(/approver/i);

    // The named approver -> activated.
    const updated = await approveInvestigationAccess({ grantId: 1, approverId: 'admin-approver' });
    expect(updated.status).toBe('active');
  });

  test('checkInvestigationAccess enforces active, unexpired, in-scope', async () => {
    const active = grantRow({ status: 'active' });
    // Simulate Postgres: the ANY(scope_user_ids) filter really filters.
    const scopedMock = (grant) => async (sql, params) => {
      if (sql.includes('FROM investigation_access_grants')) {
        const target = params && params[1];
        const inScope = grant.scope_user_ids.includes(target);
        const live = grant.status === 'active' && !grant.revoked_at &&
          new Date(grant.expires_at).getTime() > Date.now();
        return { rows: inScope && live ? [grant] : [], rowCount: inScope && live ? 1 : 0 };
      }
      return { rows: [], rowCount: 0 };
    };
    mockQuery.mockImplementation(scopedMock(active));

    const ok = await checkInvestigationAccess('admin-requester', 'user-1');
    expect(ok.granted).toBe(true);
    expect(ok.grant.purpose).toContain('fraud case 9');

    // Out-of-scope target -> denied.
    const denied = await checkInvestigationAccess('admin-requester', 'user-999');
    expect(denied.granted).toBe(false);

    // Expired grant -> denied.
    mockQuery.mockImplementation(scopedMock(
      grantRow({ status: 'active', expires_at: new Date(Date.now() - 1000).toISOString() })
    ));
    expect((await checkInvestigationAccess('admin-requester', 'user-1')).granted).toBe(false);

    // Revoked grant -> denied.
    mockQuery.mockImplementation(scopedMock(
      grantRow({ status: 'revoked', revoked_at: new Date().toISOString() })
    ));
    expect((await checkInvestigationAccess('admin-requester', 'user-1')).granted).toBe(false);
  });

  test('revoke marks the grant revoked with an audit trail', async () => {
    const existing = grantRow({ status: 'active' });
    mockQuery.mockImplementation(async (sql) => {
      if (sql.includes('SELECT role')) return { rows: [{ role: 'admin' }], rowCount: 1 };
      if (sql.includes('FROM investigation_access_grants') && sql.includes('WHERE id')) {
        return { rows: [existing], rowCount: 1 };
      }
      if (sql.includes('UPDATE investigation_access_grants')) {
        return { rows: [{ ...existing, status: 'revoked' }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });
    const revoked = await revokeInvestigationAccess({ grantId: 1, revokedBy: 'admin-approver', reason: 'Case closed' });
    expect(revoked.status).toBe('revoked');
    const updateSql = mockQuery.mock.calls.map(([sql]) => String(sql)).join('\n');
    expect(updateSql).toContain('revoked_at');
  });
});
