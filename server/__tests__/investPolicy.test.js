'use strict';

// OxSteed Invest Track 2: authority matrix (non-DB).
// Pins the registry entries, reviewer authority, legacy non-grant, route
// middleware chains, and the investor-summary removal without a database.

const registry = require('../services/access/policyRegistry');
const resolver = require('../services/access/resolver');
const { mapLegacyUser } = require('../services/access/legacyMapping');
const investFlags = require('../services/invest/flags');
const investRoutes = require('../routes/invest');
const investController = require('../controllers/investController');
const { authenticate } = require('../middleware/auth');
const { requireAdmin } = require('../middleware/adminAuth');
const paymentsRoutes = require('../routes/payments');
const paymentController = require('../controllers/paymentController');

describe('invest authority matrix', () => {
  test('investor.participate has its own review permission and empty legacy mapping', () => {
    const cap = registry.getCapability('investor.participate');
    expect(cap).not.toBeNull();
    expect(cap.reviewPermission).toBe('review_invest_participation');
    expect(cap.reviewPermission).not.toBe('review_investor_access');
    expect(cap.legacyModes).toEqual([]);
    expect(cap.legacyRoles).toEqual([]);
    // G-10: the generic access-request path must never mint participation.
    // Participation comes only from the per-opportunity invest flow, so the
    // capability is not self-service requestable and the public policy list
    // (which filters on applicantMayRequest) never offers it.
    expect(cap.applicantMayRequest).toBe(false);
    expect(registry.publicPolicy('investor.participate').applicantMayRequest).toBe(false);
  });

  test('the generic access-request path cannot file investor.participate', () => {
    // createRequest enforces applicantMayRequest (accessService.js): a
    // self-service request for a non-requestable capability 403s with
    // access_request_not_available before any draft is created.
    expect(registry.getCapability('investor.participate').applicantMayRequest).toBe(false);
  });

  test('investor.reporting is untouched and keeps its own reviewer pool', () => {
    const cap = registry.getCapability('investor.reporting');
    expect(cap.reviewPermission).toBe('review_investor_access');
    expect(cap.legacyModes).toEqual([]);
  });

  test('publish, close, and proceeds release are admin permissions, not registry capabilities', () => {
    // G-39: the three investment.* registry entries were dead (zero issuers,
    // zero consumers); the invest routes enforce admin permissions instead.
    // The registry must no longer describe an authority model the product
    // does not use.
    expect(registry.getCapability('investment_opportunity.publish')).toBeNull();
    expect(registry.getCapability('investment.close')).toBeNull();
    expect(registry.getCapability('investment.release_proceeds')).toBeNull();
    expect(registry.listCapabilities().map((c) => c.key)).not.toContain('investment_opportunity.publish');
    // The real authority still exists, as admin permission codes: publish,
    // close, and release remain three separate authorities, and no single
    // code authorizes more than one step.
    const { PERMISSION_SCOPES } = require('../controllers/adminPermissionController');
    expect(PERMISSION_SCOPES.review_invest_opportunity_publish).toBe('Publish approved investment opportunities');
    expect(PERMISSION_SCOPES.review_invest_close).toBe('Review and execute investment opportunity closings');
    expect(PERMISSION_SCOPES.review_invest_release_proceeds).toBe('Release entity proceeds after an approved closing');
  });

  test('document access is not a blanket capability', () => {
    expect(registry.getCapability('investor.view_documents')).toBeNull();
    expect(registry.getCapability('investor.documents')).toBeNull();
  });

  test('public policy never leaks reviewer permissions', () => {
    const pub = registry.publicPolicy('investor.participate');
    expect(pub.reviewPermission).toBeUndefined();
    expect(pub.capability).toBe('investor.participate');
  });

  test('reviewer authority follows the new permissions, not the reporting pool', () => {
    const request = { applicant_id: 'applicant-1', capability: 'investor.participate' };
    expect(resolver.canReview({ id: 'rev-1', role: 'admin', permissions: ['review_invest_participation'] }, request).allowed).toBe(true);
    expect(resolver.canReview({ id: 'rev-1', role: 'admin', permissions: ['review_investor_access'] }, request).allowed).toBe(false);
    expect(resolver.canReview({ id: 'applicant-1', role: 'admin', permissions: ['review_invest_participation'] }, request).allowed).toBe(false);
    expect(resolver.canReview({ id: 'rev-1', role: 'super_admin', permissions: [] }, request).allowed).toBe(true);
    expect(resolver.canReview({ id: 'rev-1', role: 'admin', permissions: ['review_invest_opportunity_publish'] }, { applicant_id: 'a', capability: 'investment_opportunity.publish' }).allowed).toBe(false);
    expect(resolver.canReview({ id: 'rev-1', role: 'admin', permissions: ['review_invest_close'] }, { applicant_id: 'a', capability: 'investment.release_proceeds' }).allowed).toBe(false);
  });

  test('legacy investor mode grants no participation', () => {
    const withoutAudience = mapLegacyUser({ user: { id: 'u', role: 'customer', default_mode: 'investor' }, investorAudience: false });
    expect(withoutAudience.grants.map((g) => g.capability)).not.toContain('investor.participate');
    const withAudience = mapLegacyUser({ user: { id: 'u', role: 'customer', default_mode: 'investor' }, investorAudience: true });
    expect(withAudience.grants.map((g) => g.capability)).toEqual(['investor.reporting']);
  });
});

describe('invest route middleware chains', () => {
  function routes() {
    const out = [];
    for (const layer of investRoutes.stack) {
      if (!layer.route) continue;
      const methods = Object.keys(layer.route.methods).filter((m) => layer.route.methods[m]);
      for (const method of methods) {
        out.push({ method, path: layer.route.path, handlers: layer.route.stack.map((s) => s.handle) });
      }
    }
    return out;
  }

  test('every route starts with authenticate and carries the invest flag gate', () => {
    const found = routes();
    expect(found.length).toBeGreaterThan(20);
    for (const route of found) {
      expect(route.handlers[0]).toBe(authenticate);
      expect(route.handlers).toContain(investController.requireInvestEnabledMw);
    }
  });

  test('commit, close, proceeds, and distribution writes require the commitments flag', () => {
    const found = routes();
    const gated = [
      ['post', '/opportunities/:id/commitments'],
      ['post', '/opportunities/:id/close'],
      ['post', '/opportunities/:id/release-proceeds'],
      ['post', '/opportunities/:id/distributions'],
    ];
    for (const [method, path] of gated) {
      const route = found.find((r) => r.method === method && r.path === path);
      expect(route).toBeDefined();
      expect(route.handlers).toContain(investController.requireInvestCommitmentsEnabledMw);
    }
  });

  test('reviewer routes sit behind requireAdmin', () => {
    const found = routes();
    const reviewerRoutes = [
      ['post', '/opportunities/:id/review'],
      ['post', '/opportunities/:id/publish'],
      ['post', '/applications/:id/review'],
      ['get', '/review-queue'],
      ['post', '/opportunities/:id/closing-conditions/approve'],
      ['post', '/opportunities/:id/closing-approvals'],
      ['post', '/opportunities/:id/close'],
      ['post', '/opportunities/:id/fail-close'],
      ['post', '/amendments/:id/effective'],
      ['post', '/amendments/:id/reject'],
      ['post', '/commitments/:id/escrow-confirmation'],
      ['post', '/opportunities/:id/release-proceeds'],
      ['post', '/opportunities/:id/distributions'],
    ];
    for (const [method, path] of reviewerRoutes) {
      const route = found.find((r) => r.method === method && r.path === path);
      expect(route).toBeDefined();
      expect(route.handlers).toContain(requireAdmin);
    }
  });
});

describe('invest flag posture (revised 2026-11-17: default on)', () => {
  const ORIGINAL_ENABLED = process.env.INVEST_ENABLED;
  const ORIGINAL_COMMITMENTS = process.env.INVEST_COMMITMENTS_ENABLED;
  const ORIGINAL_PILOT = process.env.INVEST_PILOT_USER_IDS;

  afterEach(() => {
    if (ORIGINAL_ENABLED === undefined) delete process.env.INVEST_ENABLED;
    else process.env.INVEST_ENABLED = ORIGINAL_ENABLED;
    if (ORIGINAL_COMMITMENTS === undefined) delete process.env.INVEST_COMMITMENTS_ENABLED;
    else process.env.INVEST_COMMITMENTS_ENABLED = ORIGINAL_COMMITMENTS;
    if (ORIGINAL_PILOT === undefined) delete process.env.INVEST_PILOT_USER_IDS;
    else process.env.INVEST_PILOT_USER_IDS = ORIGINAL_PILOT;
  });

  test('INVEST_ENABLED defaults on when unset; the commitments gate defaults on', () => {
    delete process.env.INVEST_ENABLED;
    delete process.env.INVEST_COMMITMENTS_ENABLED;
    delete process.env.INVEST_PILOT_USER_IDS;
    expect(investFlags.investEnabled('some-user')).toBe(true);
    expect(investFlags.investCommitmentsEnabled('some-user')).toBe(true);
    expect(investFlags.clientFlags('some-user')).toEqual(
      expect.objectContaining({ investEnabled: true, investCommitmentsEnabled: true, investPilot: false }),
    );
  });

  test('explicitly setting INVEST_ENABLED off still blocks non-commitment surfaces', () => {
    process.env.INVEST_ENABLED = 'false';
    delete process.env.INVEST_PILOT_USER_IDS;
    expect(investFlags.investEnabled('some-user')).toBe(false);
    expect(() => investFlags.requireInvestEnabled('some-user')).toThrow(expect.objectContaining({ code: 'invest_disabled' }));
  });

  test('the commitments gate stays on by default even with the master on', () => {
    delete process.env.INVEST_COMMITMENTS_ENABLED;
    process.env.INVEST_ENABLED = 'true';
    delete process.env.INVEST_PILOT_USER_IDS;
    expect(investFlags.investCommitmentsEnabled('some-user')).toBe(true);
    expect(() => investFlags.requireInvestCommitmentsEnabled('some-user')).not.toThrow();
  });
});

describe('investor-summary removal', () => {
  test('no investor-summary route remains on the payments router', () => {
    const paths = [];
    for (const layer of paymentsRoutes.stack) {
      if (layer.route) paths.push(layer.route.path);
    }
    expect(paths).not.toContain('/investor-summary');
  });

  test('the controller no longer exports getInvestorSummary', () => {
    expect(paymentController.getInvestorSummary).toBeUndefined();
  });
});
