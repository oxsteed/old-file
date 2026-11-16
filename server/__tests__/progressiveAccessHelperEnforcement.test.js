'use strict';

/**
 * WP-026 / WP-028: ACCESS_HELPER_ENFORCEMENT off | shadow | enforce on helper
 * writes. The capability decision is mocked here; the resolver itself is
 * covered by progressiveAccessDecisions.test.js and the DB suites.
 */

jest.mock('../services/access/accessService', () => ({ can: jest.fn() }));
const access = require('../services/access/accessService');
const logger = require('../utils/logger');
const { requireHelperCapability, isHelperActor } = require('../middleware/requireAccess');
const { requireHelperWorkEligible } = require('../middleware/helperOnboardingMiddleware');

function run(mw, req) {
  return new Promise((resolve) => {
    const res = { statusCode: 200, body: null };
    res.status = (c) => { res.statusCode = c; return res; };
    res.json = (b) => { res.body = b; resolve({ res, nextCalled: false }); return res; };
    mw(req, res, (err) => resolve({ res, nextCalled: !err, err }));
  });
}

const user = (role) => ({ id: 'u-1', role });

describe('helper capability gate', () => {
  afterEach(() => { delete process.env.ACCESS_HELPER_ENFORCEMENT; jest.clearAllMocks(); });

  test('off: never consults the resolver and legacy roles decide', async () => {
    const { nextCalled } = await run(requireHelperCapability, { user: user('customer') });
    expect(nextCalled).toBe(true);
    expect(access.can).not.toHaveBeenCalled();
    expect(isHelperActor({ user: user('helper') })).toBe(true);
    expect(isHelperActor({ user: user('customer') })).toBe(false);
  });

  test('shadow: logs a mismatch but never blocks', async () => {
    process.env.ACCESS_HELPER_ENFORCEMENT = 'shadow';
    access.can.mockResolvedValue({ allowed: false, reason: 'not_granted' });
    const warn = jest.spyOn(logger, 'warn').mockImplementation(() => {});
    const { nextCalled } = await run(requireHelperCapability, { user: user('helper'), baseUrl: '/api/bids', route: { path: '/' } });
    expect(nextCalled).toBe(true);
    expect(warn).toHaveBeenCalledWith('access.shadow_mismatch', expect.objectContaining({ legacyAllowed: true, capabilityAllowed: false }));
    warn.mockRestore();
  });

  test('shadow: a resolver failure fails open to legacy behaviour', async () => {
    process.env.ACCESS_HELPER_ENFORCEMENT = 'shadow';
    access.can.mockRejectedValue(new Error('db down'));
    const { nextCalled } = await run(requireHelperCapability, { user: user('helper') });
    expect(nextCalled).toBe(true);
  });

  test('enforce: an applicant without a grant gets 403 access_required', async () => {
    process.env.ACCESS_HELPER_ENFORCEMENT = 'enforce';
    access.can.mockResolvedValue({ allowed: false, reason: 'not_granted' });
    const { res, nextCalled } = await run(requireHelperCapability, { user: user('customer') });
    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(403);
    expect(res.body).toMatchObject({ code: 'access_required', capability: 'helper.offer_services', reason: 'not_granted' });
  });

  test('enforce: a legacy helper role with a revoked or suspended grant is denied', async () => {
    process.env.ACCESS_HELPER_ENFORCEMENT = 'enforce';
    access.can.mockResolvedValue({ allowed: false, reason: 'grant_suspended' });
    const { res } = await run(requireHelperCapability, { user: user('helper') });
    expect(res.statusCode).toBe(403);
    expect(isHelperActor({ user: user('helper') })).toBe(false);
  });

  test('enforce: a suspended account is reported as inactive', async () => {
    process.env.ACCESS_HELPER_ENFORCEMENT = 'enforce';
    access.can.mockResolvedValue({ allowed: false, reason: 'account_inactive' });
    const { res } = await run(requireHelperCapability, { user: user('helper') });
    expect(res.body.reason).toBe('account_inactive');
  });

  test('enforce: an approved customer-role helper (e.g. a Credit customer) passes the legacy role check', async () => {
    process.env.ACCESS_HELPER_ENFORCEMENT = 'enforce';
    access.can.mockResolvedValue({ allowed: true, reason: 'grant' });
    const req = { user: user('customer') };
    const { nextCalled } = await run(requireHelperCapability, req);
    expect(nextCalled).toBe(true);
    expect(isHelperActor(req)).toBe(true);
    jest.spyOn(require('../services/helperOnboarding'), 'loadHelperOnboarding').mockResolvedValue({ complete: true });
    const r2 = await run(requireHelperWorkEligible, req);
    expect(r2.nextCalled).toBe(true);
  });

  test('admins bypass unchanged', async () => {
    process.env.ACCESS_HELPER_ENFORCEMENT = 'enforce';
    const { nextCalled } = await run(requireHelperCapability, { user: user('admin') });
    expect(nextCalled).toBe(true);
    expect(access.can).not.toHaveBeenCalled();
  });

  test('unknown enforcement values fall back to off', async () => {
    process.env.ACCESS_HELPER_ENFORCEMENT = 'ENFORCE-ish';
    const { nextCalled } = await run(requireHelperCapability, { user: user('customer') });
    expect(nextCalled).toBe(true);
    expect(access.can).not.toHaveBeenCalled();
  });
});
