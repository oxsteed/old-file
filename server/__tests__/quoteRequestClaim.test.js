'use strict';
const { mockQuery, resetMocks } = require('./setup');
const { claimGuestQuoteRequestsForUser } = require('../services/quoteRequestClaim');

beforeEach(() => resetMocks());

describe('claimGuestQuoteRequestsForUser (P1-4-F01)', () => {
  test('claims ownerless requests matching the account email', async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 2 });
    const claimed = await claimGuestQuoteRequestsForUser('user-1', 'Guest@Example.com');
    expect(claimed).toBe(2);
    expect(mockQuery).toHaveBeenCalledTimes(1);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/WHERE user_id IS NULL/);
    expect(params).toEqual(['user-1', 'guest@example.com']);
  });

  test('claims nothing without a user or email', async () => {
    expect(await claimGuestQuoteRequestsForUser(null, 'a@b.c')).toBe(0);
    expect(await claimGuestQuoteRequestsForUser('user-1', '')).toBe(0);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test('never throws: a DB failure returns 0', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db down'));
    await expect(claimGuestQuoteRequestsForUser('user-1', 'a@b.c')).resolves.toBe(0);
  });
});
