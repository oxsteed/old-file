'use strict';

const fs = require('fs');
const path = require('path');

/**
 * WP-026 / WP-028: ACCESS_HELPER_ENFORCEMENT off | shadow | enforce on helper
 * writes. The capability decision is mocked here; the resolver itself is
 * covered by progressiveAccessDecisions.test.js and the DB suites.
 */

jest.mock('../services/access/accessService', () => ({ can: jest.fn() }));
const access = require('../services/access/accessService');
const logger = require('../utils/logger');
const flags = require('../services/access/flags');
const { requireHelperCapability, requireInvestorCapability, requireFranchiseCapability, isHelperActor } = require('../middleware/requireAccess');
const { requireHelperWorkEligible, requireHelperStep, requireTaxIdentity } = require('../middleware/helperOnboardingMiddleware');
const requireRole = require('../middleware/requireRole');

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
    // B1: the helper default is now enforce, so "off" must be set explicitly.
    process.env.ACCESS_HELPER_ENFORCEMENT = 'off';
    const req = { user: user('customer') };
    const { nextCalled } = await run(requireHelperCapability, req);
    expect(nextCalled).toBe(true);
    expect(access.can).not.toHaveBeenCalled();
    expect(req.accessCapabilities).toBeUndefined();
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

  test('shadow (B1): an allowed decision is recorded so downstream legacy checks pass for a customer-role helper', async () => {
    process.env.ACCESS_HELPER_ENFORCEMENT = 'shadow';
    access.can.mockResolvedValue({ allowed: true, reason: 'grant' });
    const warn = jest.spyOn(logger, 'warn').mockImplementation(() => {});
    const req = { user: user('customer'), baseUrl: '/api/bids', route: { path: '/' } };
    const { nextCalled } = await run(requireHelperCapability, req);
    expect(nextCalled).toBe(true);
    expect(warn).toHaveBeenCalledWith('access.shadow_mismatch', expect.objectContaining({ legacyAllowed: false, capabilityAllowed: true }));
    warn.mockRestore();
    expect(req.accessCapabilities).toEqual({ 'helper.offer_services': true });
    expect(isHelperActor(req)).toBe(true);
    const rolePass = await run(requireRole('helper', 'helper_pro', 'broker'), req);
    expect(rolePass.nextCalled).toBe(true);
    jest.spyOn(require('../services/helperOnboarding'), 'loadHelperOnboarding').mockResolvedValue({ complete: true });
    const work = await run(requireHelperWorkEligible, req);
    expect(work.nextCalled).toBe(true);
  });

  test('shadow (B1): a denied decision records nothing and grants nothing', async () => {
    process.env.ACCESS_HELPER_ENFORCEMENT = 'shadow';
    access.can.mockResolvedValue({ allowed: false, reason: 'not_granted' });
    const warn = jest.spyOn(logger, 'warn').mockImplementation(() => {});
    const req = { user: user('customer'), baseUrl: '/api/bids', route: { path: '/' } };
    const { nextCalled } = await run(requireHelperCapability, req);
    expect(nextCalled).toBe(true);
    warn.mockRestore();
    expect(req.accessCapabilities).toBeUndefined();
    expect(isHelperActor(req)).toBe(false);
    const roleDeny = await run(requireRole('helper', 'helper_pro', 'broker'), req);
    expect(roleDeny.nextCalled).toBe(false);
    expect(roleDeny.res.statusCode).toBe(403);
    // The legacy role path is untouched: a legacy helper still passes.
    const legacyReq = { user: user('helper'), baseUrl: '/api/bids', route: { path: '/' } };
    await run(requireHelperCapability, legacyReq);
    expect(isHelperActor(legacyReq)).toBe(true);
  });

  test('shadow (B1): investor and franchise gates record an allowed decision too', async () => {
    process.env.ACCESS_INVESTOR_ENFORCEMENT = 'shadow';
    process.env.ACCESS_FRANCHISE_ENFORCEMENT = 'shadow';
    access.can.mockResolvedValue({ allowed: true, reason: 'grant' });
    const warn = jest.spyOn(logger, 'warn').mockImplementation(() => {});
    const investorReq = { user: user('customer'), baseUrl: '/api/investor', route: { path: '/' } };
    const franchiseReq = { user: user('customer'), baseUrl: '/api/franchise', route: { path: '/' } };
    expect((await run(requireInvestorCapability, investorReq)).nextCalled).toBe(true);
    expect((await run(requireFranchiseCapability, franchiseReq)).nextCalled).toBe(true);
    warn.mockRestore();
    expect(investorReq.accessCapabilities).toEqual({ 'investor.reporting': true });
    expect(franchiseReq.accessCapabilities).toEqual({ 'franchise.operate': true });
    delete process.env.ACCESS_INVESTOR_ENFORCEMENT;
    delete process.env.ACCESS_FRANCHISE_ENFORCEMENT;
  });

  test('enforce (B1): a denied decision records nothing allowing', async () => {
    process.env.ACCESS_HELPER_ENFORCEMENT = 'enforce';
    access.can.mockResolvedValue({ allowed: false, reason: 'not_granted' });
    const req = { user: user('customer') };
    const { res, nextCalled } = await run(requireHelperCapability, req);
    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(403);
    expect(req.accessCapabilities).toBeUndefined();
    expect(isHelperActor(req)).toBe(false);
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

  test('legacy helper-only role gates accept the live capability marker only', async () => {
    process.env.ACCESS_HELPER_ENFORCEMENT = 'enforce';
    const allowed = { user: user('customer'), accessCapabilities: { 'helper.offer_services': true } };
    const blocked = { user: user('customer') };
    const pass = await run(requireRole('helper', 'helper_pro', 'broker'), allowed);
    const deny = await run(requireRole('helper', 'helper_pro', 'broker'), blocked);
    expect(pass.nextCalled).toBe(true);
    expect(deny.res.statusCode).toBe(403);
  });

  test('helper onboarding steps accept an approved customer-role helper', async () => {
    process.env.ACCESS_HELPER_ENFORCEMENT = 'enforce';
    access.can.mockResolvedValue({ allowed: true, reason: 'grant' });
    const req = { user: user('customer') };
    await run(requireHelperCapability, req);
    const onboarding = require('../services/helperOnboarding');
    jest.spyOn(onboarding, 'loadHelperOnboarding').mockResolvedValue({
      user: { role: 'customer' },
      steps: { email: true },
    });
    const result = await run(requireHelperStep('profile'), req);
    expect(result.nextCalled).toBe(true);
    expect(result.res.statusCode).toBe(200);
  });

  test('tax identity keeps the capability marker as the helper authority', async () => {
    process.env.ACCESS_HELPER_ENFORCEMENT = 'enforce';
    const approved = { user: { ...user('customer'), w9_completed: true, didit_status: 'verified', didit_verified_at: new Date().toISOString() }, accessCapabilities: { 'helper.offer_services': true } };
    const result = await run(requireTaxIdentity, approved);
    expect(result.nextCalled).toBe(true);
    const blocked = await run(requireTaxIdentity, { user: user('customer') });
    expect(blocked.res.statusCode).toBe(403);
    expect(blocked.res.body.code).toBe('helper_required');
  });

  test('enforce: approved helper capability remains usable when subscription access is expired', async () => {
    process.env.ACCESS_HELPER_ENFORCEMENT = 'enforce';
    access.can.mockResolvedValue({ allowed: true, reason: 'grant' });
    const req = {
      user: {
        ...user('customer'),
        tier: 'pro',
        subscription_status: 'cancelled',
      },
    };
    const { nextCalled } = await run(requireHelperCapability, req);
    expect(nextCalled).toBe(true);
    expect(req.accessCapabilities).toEqual({ 'helper.offer_services': true });
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

  test('conditional helper quote and product mutations are capability-gated', () => {
    const chat = fs.readFileSync(path.join(__dirname, '../routes/chat.js'), 'utf8');
    const products = fs.readFileSync(path.join(__dirname, '../routes/helperProducts.js'), 'utf8');
    expect(chat).toMatch(/quotes\/share.*requireHelperQuoteCapability/);
    expect(chat).toMatch(/quotes\/:kind\/:id\/revise.*requireHelperQuoteCapability/);
    expect(products).toMatch(/router\.post\('\/', authenticate, requireHelperCapability/);
    expect(products).toMatch(/router\.patch\('\/:id', authenticate, requireHelperCapability/);
    expect(products).toMatch(/router\.delete\('\/:id', authenticate, requireHelperCapability/);
  });

  test('booking provider mutations use the same helper capability boundary', () => {
    const bookings = fs.readFileSync(path.join(__dirname, '../routes/bookings.js'), 'utf8');
    const controller = fs.readFileSync(path.join(__dirname, '../controllers/bookingController.js'), 'utf8');
    const chat = fs.readFileSync(path.join(__dirname, '../routes/chat.js'), 'utf8');
    const chatController = fs.readFileSync(path.join(__dirname, '../controllers/chatBookingRequestsController.js'), 'utf8');
    expect(bookings).toMatch(/router\.post\('\/:bookingId\/accept', requireAuth, requireBookingProviderCapability, requireBookingProviderActivation/);
    expect(bookings).toMatch(/router\.post\('\/:bookingId\/decline', requireAuth, requireBookingProviderCapability/);
    expect(bookings).toMatch(/router\.post\('\/:bookingId\/helper-cancel', requireAuth, requireBookingProviderCapability/);
    expect(bookings).toMatch(/router\.post\('\/:bookingId\/counter-propose', requireAuth, requireBookingProviderCapability, requireBookingProviderActivation/);
    expect(controller).toMatch(/publicHelperStandingPredicate\('u'\)/);
    expect(controller).toMatch(/helper_capability_granted/);
    expect(chat).toMatch(/booking-requests.*requireChatHelperProviderCapability/);
    expect(chatController).toMatch(/publicHelperStandingPredicate\('users'\)/);
    expect(chatController).toMatch(/req\.accessCapabilities\?\.\['helper\.offer_services'\]/);
  });

  test('planned-need acceptance requires active helper access while decline remains recovery-safe', () => {
    const plannedNeeds = fs.readFileSync(path.join(__dirname, '../routes/plannedNeeds.js'), 'utf8');
    expect(plannedNeeds).toMatch(/router\.post\('\/:id\/helper\/accept',\s+authenticate, requireHelperCapability, requireOnboardingStep\('active'\), ctrl\.helperAccept\)/);
    expect(plannedNeeds).toMatch(/router\.post\('\/:id\/helper\/decline',\s+authenticate, ctrl\.helperDecline\)/);
  });

  test('agreements and disputes gate helper-party mutations without gating customers', () => {
    const chat = fs.readFileSync(path.join(__dirname, '../routes/chat.js'), 'utf8');
    const agreements = fs.readFileSync(path.join(__dirname, '../routes/workAgreements.js'), 'utf8');
    const disputes = fs.readFileSync(path.join(__dirname, '../routes/disputes.js'), 'utf8');
    expect(chat).toMatch(/agreements\/share.*requireChatHelperAgreementCapability/);
    expect(chat).toMatch(/agreements\/:id\/revise.*requireChatHelperAgreementCapability/);
    expect(agreements).toMatch(/requireAgreementHelperCapability/);
    expect(agreements).toMatch(/router\.post\('\/:id\/sign', authenticate, requireAgreementHelperCapability/);
    expect(disputes).toMatch(/requireDisputeHelperCapability/);
    expect(disputes).toMatch(/router\.post\('\/:disputeId\/evidence',[\s\S]*requireDisputeHelperCapability/);
  });

  test('marketplace product review writes use progressive helper access', () => {
    const route = fs.readFileSync(path.join(__dirname, '../routes/marketplaceProducts.js'), 'utf8');
    const controller = fs.readFileSync(path.join(__dirname, '../controllers/marketplaceProductsController.js'), 'utf8');
    expect(route).toMatch(/router\.post\('\/:productId\/reviews', authenticate, requireHelperCapability/);
    expect(controller).toMatch(/req\.accessCapabilities\?\.\['helper\.offer_services'\]/);
  });

  describe('hiring a helper (jobs.assign)', () => {
    const { assertHelperCanBeHired } = require('../controllers/jobController');

    test('off: no resolver call', async () => {
      // B1: the helper default is now enforce, so "off" must be set explicitly.
      process.env.ACCESS_HELPER_ENFORCEMENT = 'off';
      await expect(assertHelperCanBeHired({}, 'h-1')).resolves.toBeUndefined();
      expect(access.can).not.toHaveBeenCalled();
    });

    test('shadow: a revoked helper is logged, not blocked', async () => {
      process.env.ACCESS_HELPER_ENFORCEMENT = 'shadow';
      access.can.mockResolvedValue({ allowed: false, reason: 'grant_revoked' });
      await expect(assertHelperCanBeHired({}, 'h-1')).resolves.toBeUndefined();
    });

    test('enforce: a revoked or suspended helper cannot be hired', async () => {
      process.env.ACCESS_HELPER_ENFORCEMENT = 'enforce';
      access.can.mockResolvedValue({ allowed: false, reason: 'grant_suspended' });
      await expect(assertHelperCanBeHired({}, 'h-1')).rejects.toMatchObject({ statusCode: 409, code: 'helper_access_inactive' });
    });

    test('enforce: an approved helper can be hired', async () => {
      process.env.ACCESS_HELPER_ENFORCEMENT = 'enforce';
      access.can.mockResolvedValue({ allowed: true, reason: 'grant' });
      await expect(assertHelperCanBeHired({}, 'h-1')).resolves.toBeUndefined();
    });
  });
});

describe('enforcement flag defaults (Domain 6 B1)', () => {
  const KEYS = [
    'ACCESS_HELPER_ENFORCEMENT',
    'ACCESS_BUSINESS_ENFORCEMENT',
    'ACCESS_CONSULTANT_ENFORCEMENT',
    'ACCESS_INVESTOR_ENFORCEMENT',
    'ACCESS_FRANCHISE_ENFORCEMENT',
    'ACCESS_TOOL_OWNER_ENFORCEMENT',
  ];
  afterEach(() => { KEYS.forEach((k) => delete process.env[k]); });

  test('helper defaults to enforce; every other enforcement flag defaults to off', () => {
    KEYS.forEach((k) => delete process.env[k]);
    expect(flags.helperEnforcement()).toBe('enforce');
    expect(flags.businessEnforcement()).toBe('off');
    expect(flags.consultantEnforcement()).toBe('off');
    expect(flags.investorEnforcement()).toBe('off');
    expect(flags.franchiseEnforcement()).toBe('off');
    expect(flags.toolOwnerEnforcement()).toBe('off');
  });

  test('an explicit off still opts helper enforcement out', () => {
    process.env.ACCESS_HELPER_ENFORCEMENT = 'off';
    expect(flags.helperEnforcement()).toBe('off');
  });
});

describe('dedicated helper registration under customer-first signup (WP-006)', () => {
  const express = require('express');
  const request = require('supertest');
  const app = express();
  app.use(express.json());
  app.use('/api/helper-registration', require('../routes/helperRegistration'));
  afterEach(() => { delete process.env.ACCESS_CUSTOMER_FIRST_SIGNUP; });

  test.each(['/start', '/verify-otp', '/resend-otp', '/send-otp', '/registration-terms'])(
    'POST %s is closed with a pointer to the general signup when the flag is on', async (path) => {
      process.env.ACCESS_CUSTOMER_FIRST_SIGNUP = 'true';
      const res = await request(app).post(`/api/helper-registration${path}`).send({ email: 'x@example.invalid' });
      expect(res.status).toBe(410);
      expect(res.body).toMatchObject({ code: 'use_general_signup', signupIntent: 'offer_services', next: '/join?mode=helper' });
    },
  );

  test('flag off: the dedicated route still reaches its handler', async () => {
    // WP-104 flipped the default on, so "flag off" must be set explicitly;
    // the ambient default no longer means off.
    process.env.ACCESS_CUSTOMER_FIRST_SIGNUP = 'false';
    const res = await request(app).post('/api/helper-registration/start').send({});
    expect(res.status).not.toBe(410);
  });
});
