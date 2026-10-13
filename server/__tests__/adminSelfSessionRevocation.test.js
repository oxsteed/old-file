'use strict';
jest.unmock('../utils/transaction');
const { mockQuery, resetMocks } = require('./setup');
jest.unmock('../services/tokenRevocationService');
const mockStore = new Map();
const mockRedis = { get: jest.fn(async (key) => mockStore.get(key) || null),
  set: jest.fn(async (key, value) => { mockStore.set(key, value); return 'OK'; }) };
jest.mock('../utils/redis', () => mockRedis);
const service = require('../services/tokenRevocationService');
const { revokeMySession } = require('../controllers/adminSelfSettingsController');
const { hashAccessToken, hashRefreshToken } = require('../utils/sessionContext');
const { REFRESH_COOKIE_NAME } = require('../utils/authCookies');
const accessId = hashAccessToken('synthetic-target-access');
const request = () => ({ user: { id: 'admin-one' }, params: { sessionId: '12' }, headers: {} });
const response = () => ({ json: jest.fn() });
function target(row) {
  mockQuery.mockImplementation(async (sql) => {
    if (/SELECT refresh_token/.test(sql)) return { rows: row ? [row] : [] };
    return { rows: [], rowCount: 1 };
  });
}
beforeEach(() => { resetMocks(); mockStore.clear(); jest.clearAllMocks(); });
test('revokes the stored access JWT identifier immediately without hashing it again', async () => {
  target({ refresh_token: 'other-refresh', access_token_hash: accessId });
  expect(await service.isRevoked(accessId, 'admin-one', 1)).toBe(false);
  const res = response(); const next = jest.fn();
  await revokeMySession(request(), res, next);
  expect(next).not.toHaveBeenCalled();
  expect(await service.isRevoked(accessId, 'admin-one', 1)).toBe(true);
  expect(await service.isRevoked(hashAccessToken('synthetic-other-access'), 'admin-one', 1)).toBe(false);
  expect(mockRedis.set).toHaveBeenCalledWith(`revoked:${accessId}`, 'access', 'EX', 900);
  expect(mockQuery.mock.calls[1][0]).toContain('FOR UPDATE');
  expect(res.json).toHaveBeenCalledWith({ revoked: true });
});
test('legacy sessions fall back to immediate user-wide token revocation', async () => {
  target({ refresh_token: 'legacy-refresh', access_token_hash: null });
  const next = jest.fn();
  await revokeMySession(request(), response(), next);
  expect(next).not.toHaveBeenCalled();
  expect(await service.isRevoked(accessId, 'admin-one', 1)).toBe(true);
  expect(await service.isRevoked(accessId, 'different-user', 1)).toBe(false);
});
test('denylist failure rolls back and never reports a revoked session', async () => {
  target({ refresh_token: 'other-refresh', access_token_hash: accessId });
  mockRedis.set.mockRejectedValueOnce(new Error('synthetic storage failure'));
  const res = response(); const next = jest.fn();
  await revokeMySession(request(), res, next);
  expect(next).toHaveBeenCalledWith(expect.objectContaining({ code: 'token_revocation_unavailable' }));
  expect(res.json).not.toHaveBeenCalled();
  expect(mockQuery.mock.calls.some(([sql]) => /UPDATE sessions/.test(sql))).toBe(false);
  expect(mockQuery).toHaveBeenCalledWith('ROLLBACK');
});
test('cannot revoke the current session or another user\'s session', async () => {
  target({ refresh_token: hashRefreshToken('synthetic-current-refresh'), access_token_hash: accessId });
  const req = request(); req.headers.cookie = `${REFRESH_COOKIE_NAME}=synthetic-current-refresh`;
  const next = jest.fn();
  await revokeMySession(req, response(), next);
  expect(next).toHaveBeenCalledWith(expect.objectContaining({ code: 'cannot_revoke_current' }));
  expect(mockRedis.set).not.toHaveBeenCalled();
  target(null); next.mockClear();
  await revokeMySession(request(), response(), next);
  expect(next).toHaveBeenCalledWith(expect.objectContaining({ code: 'not_found' }));
  expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('user_id = $2'), ['12', 'admin-one']);
});
