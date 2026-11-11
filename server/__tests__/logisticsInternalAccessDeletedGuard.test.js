'use strict';

const jwt = require('jsonwebtoken');
const { mockQuery, resetMocks } = require('./setup');

jest.mock('bcrypt', () => ({ compare: jest.fn().mockResolvedValue(true), hash: jest.fn() }));

const controller = require('../controllers/logisticsInternalAccessController');

function response() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

beforeEach(() => resetMocks());

test('re-checks soft deletion when exchanging an internal access token for a session', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [{
    id: 'user-1', role: 'admin', is_active: true, deleted_at: '2026-11-01T00:00:00.000Z',
    internal_access_id: 'access-1', internal_access_active: true,
    operations_enabled: true, compliance_enabled: false, admin_portal_enabled: false,
    password_hash: 'hash', email: 'admin@example.com', totp_enabled: false,
  }] });
  const token = jwt.sign({
    isInternalAccessToken: true, userId: 'user-1', internalAccessId: 'access-1', route: 'operations',
  }, process.env.JWT_SECRET, { expiresIn: '15m' });
  const res = response();

  await controller.loginWithInternalAccess({ body: { internalAccessToken: token, password: 'secret' }, headers: {} }, res, jest.fn());

  expect(res.status).toHaveBeenCalledWith(401);
  expect(res.json).toHaveBeenCalledWith({ error: 'Internal access session is no longer valid.' });
  expect(mockQuery.mock.calls[0][0]).toMatch(/u\.deleted_at IS NULL/i);
});
