'use strict';

/**
 * Auth audit item 10: logout invalidates the CSRF token.
 *   - module level: generate, invalidate, regenerate yields a different
 *     token (the old entry is gone; getOrGenerateToken reuses an existing
 *     entry, so a different token proves deletion);
 *   - handler level: driving auth.logout through the refresh-token path
 *     invalidates the user's token, so a pre-logout token no longer
 *     validates (the next getOrGenerateToken mints a fresh one) while the
 *     logout itself still succeeds with 'Logged out'.
 * Per-session scoping is NOT asserted here: it was deferred with reasons
 * (access tokens carry no session id), and logout invalidation is the
 * implemented half.
 */

const { mockQuery, resetMocks } = require('./setup');

jest.mock('../services/supportChatThreads', () => ({
  clearSupportThread: jest.fn().mockResolvedValue(undefined),
}));

const { getOrGenerateToken, invalidateToken } = require('../middleware/csrf');
const auth = require('../controllers/authController');

function mockRes() {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  res.cookie = jest.fn(() => res);
  res.clearCookie = jest.fn(() => res);
  res.setHeader = jest.fn();
  res.getHeader = jest.fn(() => undefined);
  return res;
}

beforeEach(() => {
  resetMocks();
  jest.clearAllMocks();
});

describe('item 10: CSRF logout invalidation', () => {
  test('invalidateToken deletes the stored token', async () => {
    const before = await getOrGenerateToken('csrf-user-a');
    expect(await getOrGenerateToken('csrf-user-a')).toBe(before);
    await invalidateToken('csrf-user-a');
    const after = await getOrGenerateToken('csrf-user-a');
    expect(after).not.toBe(before);
  });

  test('logout invalidates the user CSRF token and still succeeds', async () => {
    const userId = 'csrf-user-b';
    const before = await getOrGenerateToken(userId);
    mockQuery.mockImplementation(async (text) => {
      const sql = String(text);
      if (sql.includes('WHERE refresh_token')) {
        return { rows: [{ id: 'sess-1', user_id: userId }] };
      }
      return { rows: [] };
    });
    const req = { body: { refreshToken: 'rt-1' }, headers: {}, get: () => undefined };
    const res = mockRes();
    await auth.logout(req, res);
    expect(res.json).toHaveBeenCalledWith({ message: 'Logged out' });
    const after = await getOrGenerateToken(userId);
    expect(after).not.toBe(before);
  });
});
