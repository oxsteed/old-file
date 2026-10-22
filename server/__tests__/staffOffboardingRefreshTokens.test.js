'use strict';

/**
 * Staff offboarding revokes refresh tokens (auth-audit finding 32).
 *
 * A refresh token is a long-lived credential, not a membership row.
 * applyStaffOffboarding now deletes every refresh token for the
 * offboarded user inside the same transaction, so a revoked member
 * cannot silently mint new access tokens.
 */

const { applyStaffOffboarding } = require('../services/staffOffboarding');

function fakeClient() {
  const queries = [];
  return {
    queries,
    query: jest.fn(async (sql, params) => {
      queries.push({ sql, params });
      if (/DELETE FROM refresh_tokens/i.test(sql)) return { rows: [{ id: 'rt-1' }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    }),
  };
}

describe('finding 32: applyStaffOffboarding refresh-token revocation', () => {
  test('deletes the user refresh tokens in the same transaction', async () => {
    const client = fakeClient();
    const result = await applyStaffOffboarding(client, {
      businessId: 7, userId: 'user-9', reason: 'Membership revoked',
    });
    const deletes = client.queries.filter((q) => /DELETE FROM refresh_tokens/i.test(q.sql));
    expect(deletes).toHaveLength(1);
    expect(deletes[0].params).toEqual(['user-9']);
    expect(deletes[0].sql).toContain('WHERE user_id = $1');
    expect(result.refreshTokensRevoked).toBe(1);
  });

  test('still ends staff sessions and deactivates PINs alongside', async () => {
    const client = fakeClient();
    const result = await applyStaffOffboarding(client, {
      businessId: 7, userId: 'user-9', reason: 'Membership revoked',
    });
    const sqls = client.queries.map((q) => q.sql);
    expect(sqls.some((s) => /restaurant_staff_sessions/i.test(s))).toBe(true);
    expect(sqls.some((s) => /restaurant_staff_pins/i.test(s))).toBe(true);
    expect(result).toMatchObject({ pinsDeactivated: 0, sessionsEnded: 0, refreshTokensRevoked: 1 });
  });

  test('missing args short-circuit without touching the DB', async () => {
    const client = fakeClient();
    const result = await applyStaffOffboarding(client, { businessId: 7, userId: null });
    expect(client.query).not.toHaveBeenCalled();
    expect(result.refreshTokensRevoked).toBe(0);
  });
});
