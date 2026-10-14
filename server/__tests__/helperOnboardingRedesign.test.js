'use strict';

// Review W6: P2-476, P2-477, P2-593, P2-594, P2-595, P2-596.
const { mockQuery, resetMocks } = require('./setup');
const { deriveHelperOnboarding, missingFor, isIdentityVerified } = require('../services/helperOnboarding');
const { requireHelperStep, requireListingEligible } = require('../middleware/helperOnboardingMiddleware');
const ctrl = require('../controllers/helperRegistrationController');

function res() {
  const r = { statusCode: 200 };
  r.status = jest.fn((c) => { r.statusCode = c; return r; });
  r.json = jest.fn((b) => { r.body = b; return r; });
  return r;
}

const done = {
  id: 'u1', role: 'helper', email_verified: true, profile_completed: true, contact_completed: true,
  terms_accepted: true, terms_accepted_at: new Date(), terms_version: 'v1', didit_status: 'verified',
  onboarding_completed: true,
};

beforeEach(() => resetMocks());

describe('deriveHelperOnboarding', () => {
  test('skipping Didit permits no helper work or public listing', () => {
    const onboarding = deriveHelperOnboarding({ ...done, didit_status: 'skipped', id_verified: false, identity_verified: false });
    expect(onboarding.complete).toBe(false);
    expect(onboarding.canAppearInSearch).toBe(false);
    expect(onboarding.missing).toEqual(['identity']);
    expect(missingFor('finalize', onboarding)).toEqual(['identityVerified']);
  });
  test('fresh helper is not complete and lists missing steps', () => {
    const o = deriveHelperOnboarding({ email_verified: true, terms_accepted: true, terms_accepted_at: new Date(), terms_version: 'v1' });
    expect(o.complete).toBe(false);
    expect(o.missing).toEqual(['profile', 'identity']);
    expect(o.canAppearInSearch).toBe(false);
  });
  test('terms flag without a record does not count (P2-477)', () => {
    expect(deriveHelperOnboarding({ ...done, terms_accepted_at: null }).missing).toContain('terms');
  });
  test('identity from Didit or legacy columns', () => {
    expect(isIdentityVerified({ didit_status: 'verified' })).toBe(true);
    expect(isIdentityVerified({ identity_verified: true })).toBe(true);
    expect(isIdentityVerified({ didit_status: 'pending' })).toBe(false);
    expect(deriveHelperOnboarding(done).complete).toBe(true);
  });
  test('every step is reachable in order (P2-594)', () => {
    const fresh = deriveHelperOnboarding({ email_verified: true });
    expect(missingFor('profile', fresh)).toEqual([]);
    expect(missingFor('identity', fresh)).toEqual(['profile']);
    const withProfile = deriveHelperOnboarding({ email_verified: true, profile_completed: true, contact_completed: true });
    expect(missingFor('identity', withProfile)).toEqual([]);
  });
});

describe('requireHelperStep', () => {
  test('blocks finalize until identity is verified (P2-593)', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ ...done, didit_status: 'pending', onboarding_completed: false }] });
    const r = res(); const next = jest.fn();
    await requireHelperStep('finalize')({ user: { id: 'u1' } }, r, next);
    expect(next).not.toHaveBeenCalled();
    expect(r.statusCode).toBe(403);
    expect(r.body.missing).toEqual(['identityVerified']);
  });
  test('passes when prerequisites are met', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [done] });
    const next = jest.fn();
    await requireHelperStep('finalize')({ user: { id: 'u1' } }, res(), next);
    expect(next).toHaveBeenCalledWith();
  });
});

describe('requireListingEligible (P2-596)', () => {
  test('unlisting needs no checks', async () => {
    const next = jest.fn();
    await requireListingEligible({ user: { id: 'u1' }, body: { is_listed: false } }, res(), next);
    expect(next).toHaveBeenCalled();
    expect(mockQuery).not.toHaveBeenCalled();
  });
  test('publishing blocked until onboarding is finalized', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ ...done, onboarding_completed: false }] });
    const r = res(); const next = jest.fn();
    await requireListingEligible({ user: { id: 'u1' }, body: { is_listed: true } }, r, next);
    expect(next).not.toHaveBeenCalled();
    expect(r.body.code).toBe('listing_requires_onboarding');
    expect(r.body.missing).toContain('finalize');
  });
  test('publishing allowed for a fully onboarded helper', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [done] });
    const next = jest.fn();
    await requireListingEligible({ user: { id: 'u1' }, body: { is_listed: true } }, res(), next);
    expect(next).toHaveBeenCalledWith();
  });
});

describe('controller', () => {
  test('acceptPendingTerms records version, hashed IP and UA (P2-477)', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 1 }] });
    const r = res();
    await ctrl.acceptPendingTerms({ body: { token: 't', accepted: true }, ip: '1.2.3.4', headers: { 'user-agent': 'UA' } }, r);
    expect(r.statusCode).toBe(200);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/UPDATE pending_registrations/);
    expect(params[0]).toBe('t');
    expect(params[2]).not.toBe('1.2.3.4');
    expect(params[3]).toBe('UA');
  });
  test('acceptPendingTerms requires explicit acceptance', async () => {
    const r = res();
    await ctrl.acceptPendingTerms({ body: { token: 't' }, headers: {} }, r);
    expect(r.statusCode).toBe(400);
    expect(mockQuery).not.toHaveBeenCalled();
  });
  test('finalize refuses when the guarded UPDATE matches nothing', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const r = res();
    await ctrl.finalizeRegistration({ user: { id: 'u1' } }, r);
    expect(r.statusCode).toBe(409);
    expect(mockQuery.mock.calls[0][0]).toMatch(/didit_status = 'verified'/);
  });
  test('background consent never overwrites an existing result (P2-595)', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ background_check_status: 'passed', background_check_passed: true }] });
    const r = res();
    await ctrl.submitBackgroundCheck({ user: { id: 'u1' }, body: { background_check_consent: true } }, r);
    expect(mockQuery.mock.calls[0][0]).not.toMatch(/background_check_passed\s*=\s*false/);
    expect(r.body.background_check_status).toBe('passed');
  });
  test('PUT /onboarding/id-verification is removed; identity is Didit-owned (P2-2-F08/P2-7-F05)', async () => {
    expect(ctrl.submitIdVerification).toBeUndefined();
  });
  test('verifyOTP refuses a pending registration without recorded terms (P2-476/477)', async () => {
    const crypto = require('crypto');
    const otp = '123456';
    mockQuery
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({ rows: [{ id: 1, email: 'a@b.c', otp_code: crypto.createHash('sha256').update(otp).digest('hex'),
        otp_expires_at: new Date(Date.now() + 60000), otp_attempts: 0, account_created: false }] });
    const r = res();
    await ctrl.verifyOTP({ body: { token: 't', otp }, headers: {} }, r);
    expect(r.statusCode).toBe(400);
    expect(r.body.code).toBe('terms_required');
    expect(mockQuery.mock.calls.some(([sql]) => /INSERT INTO users/.test(sql))).toBe(false);
  });
});

describe('requireHelperWorkEligible (P2-7-F01)', () => {
  const { requireHelperWorkEligible } = require('../middleware/helperOnboardingMiddleware');
  const completeFacts = {
    id: 'u1', role: 'helper', email_verified: true, profile_completed: true, contact_completed: true,
    terms_accepted: true, terms_accepted_at: new Date(), terms_version: 'v1', didit_status: 'verified',
    onboarding_completed: false, onboarding_status: 'verified_pending_onboarding',
  };
  test('403s a helper whose DB facts are incomplete even if the JWT flag claims complete', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ ...completeFacts, didit_status: 'pending', id_verified: false, identity_verified: false }] });
    const r = res(); const next = jest.fn();
    // The JWT claim lies (onboarding_completed=true); DB facts must win.
    await requireHelperWorkEligible({ user: { id: 'u1', role: 'helper', onboarding_completed: true } }, r, next);
    expect(next).not.toHaveBeenCalled();
    expect(r.statusCode).toBe(403);
    expect(r.body.code).toBe('helper_onboarding_incomplete');
    expect(r.body.missing).toContain('identity');
  });
  test('passes a helper whose DB facts are complete', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [completeFacts] });
    const r = res(); const next = jest.fn();
    await requireHelperWorkEligible({ user: { id: 'u1', role: 'helper' } }, r, next);
    expect(next).toHaveBeenCalled();
  });
  test('403s non-helper roles', async () => {
    const r = res(); const next = jest.fn();
    await requireHelperWorkEligible({ user: { id: 'u1', role: 'customer' } }, r, next);
    expect(next).not.toHaveBeenCalled();
    expect(r.statusCode).toBe(403);
    expect(mockQuery).not.toHaveBeenCalled();
  });
});
