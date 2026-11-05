'use strict';

const { launchGate, _resolveRequestPath } = require('../middleware/launchGate');

function mockReq({ baseUrl = '', path = '', originalUrl } = {}) {
  return { baseUrl, path, originalUrl, method: 'GET' };
}

function mockRes() {
  const res = { statusCode: 200 };
  res.status = jest.fn((code) => {
    res.statusCode = code;
    return res;
  });
  res.json = jest.fn(() => res);
  return res;
}

describe('launchGate middleware', () => {
  const prevDisabled = process.env.LAUNCH_GATE_DISABLED;

  afterEach(() => {
    process.env.LAUNCH_GATE_DISABLED = prevDisabled;
  });

  beforeEach(() => {
    delete process.env.LAUNCH_GATE_DISABLED;
  });

  test('_resolveRequestPath joins mount baseUrl and relative path', () => {
    expect(_resolveRequestPath(mockReq({
      baseUrl: '/api/templates',
      path: '/user-list',
    }))).toBe('/api/templates/user-list');
  });

  // All-launch flip (2026-11-04): templates defaults on, so the block
  // case needs an explicit env false (same pattern as the marketplace
  // explicit-false tests below); the boot snapshot is computed at require
  // time, so the case re-requires the middleware in isolation.
  test('blocks user-facing templates API with 404 when templates is explicitly off', () => {
    const prev = process.env.OXSTEED_LAUNCH_TEMPLATES;
    process.env.OXSTEED_LAUNCH_TEMPLATES = 'false';
    try {
      jest.isolateModules(() => {
        const { launchGate: freshGate } = require('../middleware/launchGate');
        const gate = freshGate();
        const req = mockReq({ baseUrl: '/api/templates', path: '/catalog' });
        const res = mockRes();
        const next = jest.fn();
        gate(req, res, next);
        expect(res.status).toHaveBeenCalledWith(404);
        expect(next).not.toHaveBeenCalled();
      });
    } finally {
      if (prev === undefined) delete process.env.OXSTEED_LAUNCH_TEMPLATES;
      else process.env.OXSTEED_LAUNCH_TEMPLATES = prev;
    }
  });

  test('user-facing templates API passes by default after the all-launch flip', () => {
    const gate = launchGate();
    const req = mockReq({ baseUrl: '/api/templates', path: '/catalog' });
    const res = mockRes();
    const next = jest.fn();
    gate(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  // Marketplace checkout flip (2026-11-04): the purchase path defaults on,
  // so the block case needs an explicit env false, and the default/on case
  // must pass through. The boot snapshot is computed at require time, so
  // both cases re-require the middleware in isolation.
  test.each([
    ['/api/carts', '/cart-1/payment-intent'],
    ['/api/carts', '/cart-1/confirm'],
    ['/api/shared-carts', '/share-1'],
    ['/api/job-kits', '/'],
  ])('P2-652: blocks the marketplace purchase path when productMarketplace is off %s%s', (baseUrl, path) => {
    const prev = process.env.OXSTEED_LAUNCH_PRODUCT_MARKETPLACE;
    process.env.OXSTEED_LAUNCH_PRODUCT_MARKETPLACE = 'false';
    try {
      jest.isolateModules(() => {
        const { launchGate: freshGate } = require('../middleware/launchGate');
        const gate = freshGate();
        const res = mockRes();
        const next = jest.fn();
        gate({ ...mockReq({ baseUrl, path }), method: 'POST' }, res, next);
        expect(res.status).toHaveBeenCalledWith(404);
        expect(next).not.toHaveBeenCalled();
      });
    } finally {
      if (prev === undefined) delete process.env.OXSTEED_LAUNCH_PRODUCT_MARKETPLACE;
      else process.env.OXSTEED_LAUNCH_PRODUCT_MARKETPLACE = prev;
    }
  });

  test.each([
    ['/api/carts', '/cart-1/payment-intent'],
    ['/api/shared-carts', '/share-1'],
    ['/api/job-kits', '/'],
  ])('P2-652: marketplace purchase path passes by default after the flip %s%s', (baseUrl, path) => {
    const prev = process.env.OXSTEED_LAUNCH_PRODUCT_MARKETPLACE;
    delete process.env.OXSTEED_LAUNCH_PRODUCT_MARKETPLACE;
    try {
      jest.isolateModules(() => {
        const { launchGate: freshGate } = require('../middleware/launchGate');
        const gate = freshGate();
        const res = mockRes();
        const next = jest.fn();
        gate({ ...mockReq({ baseUrl, path }), method: 'POST' }, res, next);
        expect(next).toHaveBeenCalled();
        expect(res.status).not.toHaveBeenCalled();
      });
    } finally {
      if (prev === undefined) delete process.env.OXSTEED_LAUNCH_PRODUCT_MARKETPLACE;
      else process.env.OXSTEED_LAUNCH_PRODUCT_MARKETPLACE = prev;
    }
  });

  test('allows admin templates path through', () => {
    const gate = launchGate();
    const req = mockReq({ baseUrl: '/api/templates', path: '/admin/preview' });
    const res = mockRes();
    const next = jest.fn();
    gate(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  // All-launch flip (2026-11-04): media defaults on, so the block case
  // needs an explicit env false; deleting the var no longer blocks.
  test('blocks OxSteed Media API when explicitly unlaunched', () => {
    const prev = process.env.OXSTEED_MEDIA_LAUNCHED;
    process.env.OXSTEED_MEDIA_LAUNCHED = 'false';
    try {
      jest.isolateModules(() => {
        const { launchGate: freshGate } = require('../middleware/launchGate');
        const gate = freshGate();
        const req = mockReq({ baseUrl: '/api/media', path: '/feed' });
        const res = mockRes();
        const next = jest.fn();
        gate(req, res, next);
        expect(res.status).toHaveBeenCalledWith(404);
      });
    } finally {
      if (prev === undefined) delete process.env.OXSTEED_MEDIA_LAUNCHED;
      else process.env.OXSTEED_MEDIA_LAUNCHED = prev;
    }
  });

  test('OxSteed Media API passes by default after the all-launch flip', () => {
    const gate = launchGate();
    const req = mockReq({ baseUrl: '/api/media', path: '/feed' });
    const res = mockRes();
    const next = jest.fn();
    gate(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  test('LAUNCH_GATE_DISABLED bypasses the gate', () => {
    process.env.LAUNCH_GATE_DISABLED = 'true';
    const gate = launchGate();
    const req = mockReq({ baseUrl: '/api/templates', path: '/catalog' });
    const res = mockRes();
    const next = jest.fn();
    gate(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });
});

describe('maintenance intake gate (P1-210)', () => {
  // All-launch flip (2026-11-04): specializedProfileTemplates defaults on,
  // so the block case needs an explicit env false; the boot snapshot is
  // computed at require time, so the case re-requires in isolation.
  // Owners keep their existing requests in both states: /my is not a
  // gated prefix, so it passes regardless of the flag.
  test('public intake is gated while owners keep their existing requests', () => {
    const prev = process.env.OXSTEED_LAUNCH_SPECIALIZED_PROFILE_TEMPLATES;
    process.env.OXSTEED_LAUNCH_SPECIALIZED_PROFILE_TEMPLATES = 'false';
    try {
      jest.isolateModules(() => {
        const { launchGate: freshGate } = require('../middleware/launchGate');
        const gate = freshGate();
        const blockedRes = mockRes();
        const nextBlocked = jest.fn();
        gate(mockReq({ baseUrl: '/api/maintenance-requests', path: '/public/12' }), blockedRes, nextBlocked);
        expect(nextBlocked).not.toHaveBeenCalled();
        expect(blockedRes.statusCode).toBe(404);

        const nextAllowed = jest.fn();
        gate(mockReq({ baseUrl: '/api/maintenance-requests', path: '/my' }), mockRes(), nextAllowed);
        expect(nextAllowed).toHaveBeenCalled();
      });
    } finally {
      if (prev === undefined) delete process.env.OXSTEED_LAUNCH_SPECIALIZED_PROFILE_TEMPLATES;
      else process.env.OXSTEED_LAUNCH_SPECIALIZED_PROFILE_TEMPLATES = prev;
    }
  });

  test('public intake passes by default after the all-launch flip', () => {
    const gate = launchGate();
    const next = jest.fn();
    gate(mockReq({ baseUrl: '/api/maintenance-requests', path: '/public/12' }), mockRes(), next);
    expect(next).toHaveBeenCalled();
  });
});

describe('server launch visibility map (Nov 1 audit item 11)', () => {
  const TOUCHED = [
    'AFFILIATE_ENABLED',
    'VORTEX_ENABLED',
    'OXSTEED_MEDIA_LAUNCHED',
    'OXSTEED_LAUNCH_TEMPLATES',
    'OXSTEED_LAUNCH_DISCOVER_EVERYTHING',
    'OXSTEED_LAUNCH_PRODUCT_MARKETPLACE',
    'OXSTEED_LAUNCH_SUBSCRIPTIONS',
  ];
  let saved;

  beforeEach(() => {
    saved = Object.fromEntries(TOUCHED.map((key) => [key, process.env[key]]));
    for (const key of TOUCHED) delete process.env[key];
  });

  afterEach(() => {
    for (const key of TOUCHED) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  test('defaults mirror the current client behavior: all 33 keys on after the all-launch flip', () => {
    const { getServerLaunchVisibility } = require('../middleware/launchGate');
    const launches = getServerLaunchVisibility();
    expect(Object.keys(launches)).toHaveLength(33);
    // All-launch flip (2026-11-04, Emile-authorized): nothing defaults
    // off anymore, including the three dead keys with zero consumers
    // (businessHubAdvancedOps, businessHubFinancialPlanning,
    // businessHubSpecializedTemplates), which flip for completeness.
    expect(Object.values(launches).every((v) => v === true)).toBe(true);
    expect(launches).toMatchObject({
      consulting: true,
      franchise: true,
      investor: true,
      templates: true,
      productMarketplace: true,
      specializedProfileTemplates: true,
      oxsteedMedia: true,
      discoverEverything: true,
      subscriptions: true,
      affiliateRewards: true,
      businessHubVortexAccess: true,
      vortexWorkspaceEntry: true,
      footerUtilityPills: true,
      helperEarnings: true,
      helperInvoices: true,
      jobEscrowLabels: true,
      toolRentals: true,
    });
  });

  test('env overrides flip individual keys without touching the rest', () => {
    process.env.OXSTEED_LAUNCH_TEMPLATES = 'true';
    process.env.OXSTEED_LAUNCH_DISCOVER_EVERYTHING = '1';
    process.env.AFFILIATE_ENABLED = 'false';
    process.env.OXSTEED_LAUNCH_SUBSCRIPTIONS = 'false';
    const { getServerLaunchVisibility } = require('../middleware/launchGate');
    const launches = getServerLaunchVisibility();
    expect(launches.templates).toBe(true);
    expect(launches.discoverEverything).toBe(true);
    expect(launches.affiliateRewards).toBe(false);
    expect(launches.subscriptions).toBe(false);
    expect(launches.helperEarnings).toBe(true);
  });

  test('an env-enabled templates launch unblocks its API in the gate', () => {
    jest.isolateModules(() => {
      process.env.OXSTEED_LAUNCH_TEMPLATES = 'true';
      const { launchGate: freshGate } = require('../middleware/launchGate');
      const gate = freshGate();
      const res = mockRes();
      const next = jest.fn();
      gate(mockReq({ baseUrl: '/api/templates', path: '/catalog' }), res, next);
      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });
  });
});
