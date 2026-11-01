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

  test('blocks user-facing templates API with 404', () => {
    const gate = launchGate();
    const req = mockReq({ baseUrl: '/api/templates', path: '/catalog' });
    const res = mockRes();
    const next = jest.fn();
    gate(req, res, next);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(next).not.toHaveBeenCalled();
  });

  test.each([
    ['/api/carts', '/cart-1/payment-intent'],
    ['/api/carts', '/cart-1/confirm'],
    ['/api/shared-carts', '/share-1'],
    ['/api/job-kits', '/'],
  ])('P2-652: blocks the unlaunched marketplace purchase path %s%s', (baseUrl, path) => {
    const gate = launchGate();
    const res = mockRes();
    const next = jest.fn();
    gate({ ...mockReq({ baseUrl, path }), method: 'POST' }, res, next);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(next).not.toHaveBeenCalled();
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

  test('blocks OxSteed Media API when not launched', () => {
    jest.isolateModules(() => {
      delete process.env.OXSTEED_MEDIA_LAUNCHED;
      const { launchGate: freshGate } = require('../middleware/launchGate');
      const gate = freshGate();
      const req = mockReq({ baseUrl: '/api/media', path: '/feed' });
      const res = mockRes();
      const next = jest.fn();
      gate(req, res, next);
      expect(res.status).toHaveBeenCalledWith(404);
    });
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
  test('public intake is gated while owners keep their existing requests', () => {
    const gate = launchGate();
    const blockedRes = mockRes();
    const nextBlocked = jest.fn();
    gate(mockReq({ baseUrl: '/api/maintenance-requests', path: '/public/12' }), blockedRes, nextBlocked);
    expect(nextBlocked).not.toHaveBeenCalled();
    expect(blockedRes.statusCode).toBe(404);

    const nextAllowed = jest.fn();
    gate(mockReq({ baseUrl: '/api/maintenance-requests', path: '/my' }), mockRes(), nextAllowed);
    expect(nextAllowed).toHaveBeenCalled();
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

  test('defaults mirror the current client behavior: nothing flips on or off', () => {
    const { getServerLaunchVisibility } = require('../middleware/launchGate');
    const launches = getServerLaunchVisibility();
    expect(Object.keys(launches)).toHaveLength(30);
    expect(launches).toMatchObject({
      templates: false,
      productMarketplace: false,
      specializedProfileTemplates: false,
      oxsteedMedia: false,
      discoverEverything: false,
      subscriptions: false,
      affiliateRewards: true,
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
