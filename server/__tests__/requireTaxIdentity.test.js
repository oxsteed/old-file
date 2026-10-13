'use strict';

// Review P2-2-F11: tax identity (W-9 + fresh Didit) gates helper money moves.
const { requireTaxIdentity } = require('../middleware/helperOnboardingMiddleware');

function mockRes() {
  const res = {};
  res.statusCode = null;
  res.body = null;
  res.status = jest.fn((code) => { res.statusCode = code; return res; });
  res.json = jest.fn((body) => { res.body = body; return res; });
  return res;
}

describe('requireTaxIdentity', () => {
  test('403s with missing=w9 when no W-9 is on file', () => {
    const res = mockRes();
    let nextCalled = false;
    requireTaxIdentity(
      { user: { id: 1, w9_completed: false, didit_status: 'verified', didit_verified_at: new Date() } },
      res,
      () => { nextCalled = true; },
    );
    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(403);
    expect(res.body.code).toBe('tax_identity_required');
    expect(res.body.missing).toBe('w9');
  });

  test('403s with missing=identity_verification when Didit is stale', () => {
    const res = mockRes();
    let nextCalled = false;
    const threeYearsAgo = new Date();
    threeYearsAgo.setUTCFullYear(threeYearsAgo.getUTCFullYear() - 3);
    requireTaxIdentity(
      { user: { id: 1, w9_completed: true, didit_status: 'verified', didit_verified_at: threeYearsAgo } },
      res,
      () => { nextCalled = true; },
    );
    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(403);
    expect(res.body.code).toBe('tax_identity_required');
    expect(res.body.missing).toBe('identity_verification');
  });

  test('403s when Didit was never verified', () => {
    const res = mockRes();
    let nextCalled = false;
    requireTaxIdentity(
      { user: { id: 1, w9_completed: true, didit_status: 'pending', didit_verified_at: null } },
      res,
      () => { nextCalled = true; },
    );
    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(403);
    expect(res.body.missing).toBe('identity_verification');
  });

  test('passes when W-9 is on file and Didit is fresh', () => {
    const res = mockRes();
    let nextCalled = false;
    requireTaxIdentity(
      { user: { id: 1, w9_completed: true, didit_status: 'verified', didit_verified_at: new Date() } },
      res,
      () => { nextCalled = true; },
    );
    expect(nextCalled).toBe(true);
    expect(res.statusCode).toBeNull();
  });

  test('fails closed with no user', () => {
    const res = mockRes();
    let nextCalled = false;
    requireTaxIdentity({}, res, () => { nextCalled = true; });
    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(403);
  });
});
