'use strict';

/**
 * rejectImpersonated.test.js — ADM-040
 *
 * The middleware must block impersonated sessions on money routes even when
 * the admin auth middleware (requireAdmin) never set req.isImpersonated:
 * detection is self-sufficient and reads the impersonation claims off the
 * presented credential.
 */

require('./setup');

const jwt = require('jsonwebtoken');
const { rejectImpersonated, isImpersonatedRequest } = require('../middleware/rejectImpersonated');

const SECRET = process.env.JWT_SECRET;

function signedToken(claims) {
  return jwt.sign({ id: 'user-1', ...claims }, SECRET, { algorithm: 'HS256' });
}

function mockReq({ isImpersonated, authHeader, cookie } = {}) {
  const headers = {};
  if (authHeader !== undefined) headers.authorization = authHeader;
  if (cookie !== undefined) headers.cookie = cookie;
  return { headers, isImpersonated };
}

function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

describe('isImpersonatedRequest', () => {
  test('false for plain requests', () => {
    expect(isImpersonatedRequest(mockReq())).toBe(false);
  });

  test('true when req.isImpersonated is set (user auth path)', () => {
    expect(isImpersonatedRequest(mockReq({ isImpersonated: true }))).toBe(true);
  });

  test('true for a Bearer token with the impersonation claim (admin route path)', () => {
    const token = signedToken({ impersonation: true, impersonated_by: 'admin-1', jti: 'jti-1' });
    expect(isImpersonatedRequest(mockReq({ authHeader: `Bearer ${token}` }))).toBe(true);
  });

  test('true for a Bearer token with impersonated_by only', () => {
    const token = signedToken({ impersonated_by: 'admin-1' });
    expect(isImpersonatedRequest(mockReq({ authHeader: `Bearer ${token}` }))).toBe(true);
  });

  test('false for a normal Bearer token', () => {
    const token = signedToken({ role: 'admin' });
    expect(isImpersonatedRequest(mockReq({ authHeader: `Bearer ${token}` }))).toBe(false);
  });

  test('false for a malformed Bearer token', () => {
    expect(isImpersonatedRequest(mockReq({ authHeader: 'Bearer not-a-jwt' }))).toBe(false);
  });

  test('true for an impersonation token in the session cookie', () => {
    const token = signedToken({ impersonation: true, impersonated_by: 'admin-1' });
    expect(isImpersonatedRequest(mockReq({ cookie: `oxsteed_access=${token}` }))).toBe(true);
  });
});

describe('rejectImpersonated middleware', () => {
  test('passes through for normal sessions', () => {
    const req = mockReq({ authHeader: `Bearer ${signedToken({ role: 'admin' })}` });
    const res = mockRes();
    const next = jest.fn();
    rejectImpersonated(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  test('403s impersonated sessions with the impersonation_blocked code', () => {
    const token = signedToken({ impersonation: true, impersonated_by: 'admin-1', jti: 'jti-1' });
    const req = mockReq({ authHeader: `Bearer ${token}` });
    const res = mockRes();
    const next = jest.fn();
    rejectImpersonated(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Impersonated sessions cannot perform this action.',
      code: 'impersonation_blocked',
    });
  });

  test('403s when req.isImpersonated is set even without token claims', () => {
    const req = mockReq({ isImpersonated: true });
    const res = mockRes();
    const next = jest.fn();
    rejectImpersonated(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });
});
