'use strict';

/**
 * authImpersonationGuards.test.js — self-audit 2026-10-22 (auth, roles,
 * permissions) regression coverage for the impersonation cluster:
 *
 *  item 1: credit-spend call sites pass Boolean(req.isImpersonated) — never
 *          the never-assigned req.impersonated — and every credit-spend route
 *          carries rejectImpersonated so the adapter's impersonation_blocked
 *          guard can actually fire.
 *  item 4: 2FA enrollment routes reject impersonated sessions (an impersonated
 *          session must not enroll TOTP on the victim's account).
 *  item 9: starting an impersonation requires a fresh TOTP step-up event;
 *          without one the endpoint 401s with fresh_auth_required.
 */

const { mockQuery, resetMocks } = require('./setup');
const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');

const { requireFreshAuth } = require('../middleware/requireFreshAuth');

const SECRET = process.env.JWT_SECRET;
const SERVER = path.join(__dirname, '..');

function readServerFile(rel) {
  return fs.readFileSync(path.join(SERVER, rel), 'utf8');
}

/** True when the named middleware appears in a route's handler chain. */
function routeHasMiddleware(router, method, routePath, name) {
  const layer = router.stack.find(
    (l) => l.route && l.route.path === routePath && l.route.methods[method]
  );
  expect(layer).toBeDefined();
  return layer.route.stack.some((l) => l.handle && l.handle.name === name);
}

function bearer(claims) {
  return `Bearer ${jwt.sign({ id: 'user-1', ...claims }, SECRET, { algorithm: 'HS256' })}`;
}

function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

// ── item 1: the req.impersonated typo is gone ──────────────────────────────

describe('item 1: credit-spend call sites use req.isImpersonated', () => {
  const callSites = [
    'controllers/directController.js',
    'controllers/jobController.js',
    'controllers/subscriptionController.js',
    'routes/qrPayments.js',
  ];

  test.each(callSites)('no bare req.impersonated remains in %s', (rel) => {
    const src = readServerFile(rel);
    // req.impersonatedBy is legitimate middleware state; everything else
    // matching req.impersonated (without the is) is the old typo.
    const stripped = src.replace(/req\.impersonatedBy/g, '');
    expect(stripped).not.toMatch(/req\.impersonated\b/);
  });

  test('the four spendWithCredit call sites pass Boolean(req.isImpersonated)', () => {
    const counts = {
      'controllers/directController.js': 1,
      'controllers/jobController.js': 2,
      'controllers/subscriptionController.js': 1,
      'routes/qrPayments.js': 1,
    };
    for (const [rel, expected] of Object.entries(counts)) {
      const src = readServerFile(rel);
      const hits = src.match(/isImpersonated: Boolean\(req\.isImpersonated\)/g) || [];
      expect(hits.length).toBe(expected);
    }
  });

  test('zero req.impersonated occurrences anywhere under server/ (excluding tests)', () => {
    const hits = [];
    function walk(dir) {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === '__tests__') continue; // tests pin the regression by name
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) { walk(full); continue; }
        if (!/\.js$/.test(entry.name)) continue;
        const src = fs.readFileSync(full, 'utf8').replace(/req\.impersonatedBy/g, '');
        if (/req\.impersonated\b/.test(src)) hits.push(path.relative(SERVER, full));
      }
    }
    walk(SERVER);
    expect(hits).toEqual([]);
  });
});

// ── item 1: rejectImpersonated on every credit-spend route ─────────────────

describe('item 1: credit-spend routes mount rejectImpersonated', () => {
  test('POST /requests/:id/pay-credit (direct)', () => {
    const router = require('../routes/direct');
    expect(routeHasMiddleware(router, 'post', '/requests/:id/pay-credit', 'rejectImpersonated')).toBe(true);
  });

  test('POST /assign (jobs bid acceptance / escrow collateral hold)', () => {
    const router = require('../routes/jobs');
    expect(routeHasMiddleware(router, 'post', '/assign', 'rejectImpersonated')).toBe(true);
  });

  test('POST /checkout (subscriptions first-period debit)', () => {
    const router = require('../routes/subscription');
    expect(routeHasMiddleware(router, 'post', '/checkout', 'rejectImpersonated')).toBe(true);
  });

  test('QR credit checkout guards the impersonation check on the credit branch', () => {
    // The /pay/:code/checkout route is public (no auth middleware), so the
    // adapter's isImpersonated flag can never be set there; the route must
    // run the self-sufficient token-claim check before the credit branch.
    const src = readServerFile('routes/qrPayments.js');
    const creditBranch = src.slice(src.indexOf("payment_method || '').toLowerCase() === 'credit'"));
    expect(creditBranch).toMatch(/isImpersonatedRequest\(req\)/);
    expect(creditBranch).toMatch(/code: 'impersonation_blocked'/);
  });
});

// ── item 4: 2FA enrollment rejects impersonated sessions ───────────────────

describe('item 4: 2FA routes reject impersonated sessions', () => {
  test.each(['/setup', '/verify-setup', '/disable', '/regenerate-backup'])(
    'POST %s mounts rejectImpersonated',
    (routePath) => {
      const router = require('../routes/twoFactor');
      expect(routeHasMiddleware(router, 'post', routePath, 'rejectImpersonated')).toBe(true);
    }
  );

  describe('behavior: impersonated session cannot enroll TOTP on the victim', () => {
    let app;
    beforeAll(() => {
      app = express();
      app.use(express.json());
      app.use('/2fa', require('../routes/twoFactor'));
      app.use((err, _req, res, _next) => res.status(err.statusCode || 500).json({ code: err.code }));
    });

    beforeEach(() => {
      resetMocks();
      jest.clearAllMocks();
      mockQuery.mockImplementation(async (text) => {
        const sql = String(text);
        // Impersonation session is live (no ended_at).
        if (sql.includes('user_impersonation_log')) return { rows: [{}] };
        // Victim user row for the authenticate middleware.
        if (sql.includes('FROM users u')) {
          return { rows: [{ id: 'victim-1', is_active: true, is_suspended: false, is_restricted: false }] };
        }
        return { rows: [] };
      });
    });

    const impersonationBearer = () => bearer({
      id: 'victim-1',
      impersonation: true,
      impersonated_by: 'admin-1',
      jti: 'jti-1',
    });

    test('POST /2fa/setup from an impersonated session is 403 impersonation_blocked', async () => {
      const res = await request(app)
        .post('/2fa/setup')
        .set('Authorization', impersonationBearer());
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('impersonation_blocked');
    });

    test('POST /2fa/verify-setup from an impersonated session is 403 impersonation_blocked', async () => {
      const res = await request(app)
        .post('/2fa/verify-setup')
        .set('Authorization', impersonationBearer())
        .send({ code: '123456' });
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('impersonation_blocked');
    });
  });
});

// ── item 9: fresh TOTP step-up on impersonation start ──────────────────────

describe('item 9: requireFreshAuth middleware', () => {
  beforeEach(() => {
    resetMocks();
    jest.clearAllMocks();
  });

  test('401 auth_required with no authenticated user', async () => {
    const mw = requireFreshAuth('impersonation_start');
    const res = mockRes();
    const next = jest.fn();
    await mw({ user: null }, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'auth_required' }));
    expect(next).not.toHaveBeenCalled();
  });

  test('401 fresh_auth_required with no step-up event in the TTL window', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    const mw = requireFreshAuth('impersonation_start');
    const res = mockRes();
    const next = jest.fn();
    await mw({ user: { id: 'admin-1' } }, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'fresh_auth_required' }));
    expect(next).not.toHaveBeenCalled();
    // The check is purpose-scoped: an event for another purpose does not pass.
    const askedPurpose = mockQuery.mock.calls[0][1][1];
    expect(askedPurpose).toBe('impersonation_start');
  });

  test('passes and sets req.freshAuth when a recent event exists', async () => {
    const event = {
      completed_at: new Date(),
      auth_hash: 'hash-1',
      method: 'totp',
    };
    mockQuery.mockResolvedValue({ rows: [event] });
    const mw = requireFreshAuth('impersonation_start');
    const res = mockRes();
    const next = jest.fn();
    const req = { user: { id: 'admin-1' } };
    await mw(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(req.freshAuth).toMatchObject({ authHash: 'hash-1', method: 'totp' });
  });

  test('fails closed (500) when the fresh-auth lookup errors', async () => {
    mockQuery.mockRejectedValue(new Error('db down'));
    const mw = requireFreshAuth('impersonation_start');
    const res = mockRes();
    const next = jest.fn();
    await mw({ user: { id: 'admin-1' } }, res, next);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(next).not.toHaveBeenCalled();
  });
});

describe('item 9: POST /admin/users/:userId/impersonate route wiring', () => {
  test('impersonate route mounts the fresh-auth middleware', () => {
    const router = require('../routes/admin');
    expect(
      routeHasMiddleware(router, 'post', '/users/:userId/impersonate', 'requireFreshAuthMiddleware')
    ).toBe(true);
  });

  test('a fresh TOTP step-up verify endpoint exists for super-admins', () => {
    const router = require('../routes/admin');
    const layer = router.stack.find(
      (l) => l.route && l.route.path === '/super/stepup/verify' && l.route.methods.post
    );
    expect(layer).toBeDefined();
  });

  describe('behavior: impersonation start without fresh TOTP is rejected', () => {
    let app;
    beforeAll(() => {
      app = express();
      app.use(express.json());
      app.use('/api/admin', require('../routes/admin'));
      app.use((err, _req, res, _next) => res.status(err.statusCode || 500).json({ code: err.code }));
    });

    const adminBearer = () => bearer({ id: 'admin-1' });
    let freshAuthRows;

    beforeEach(() => {
      resetMocks();
      jest.clearAllMocks();
      freshAuthRows = [];
      mockQuery.mockImplementation(async (text) => {
        const sql = String(text);
        // requireSuperAdmin's admin lookup (TOTP-enrolled super-admin).
        if (sql.includes('COALESCE(totp_enabled')) {
          return { rows: [{ id: 'admin-1', role: 'super_admin', is_active: true, totp_enabled: true }] };
        }
        // Fresh-auth step-up event lookup.
        if (sql.includes('logistics_fresh_auth_events')) return { rows: freshAuthRows };
        // impersonateUser's target-user lookup.
        if (sql.includes('deleted_at IS NULL')) {
          return {
            rows: [{
              id: 'user-9', first_name: 'Vic', last_name: 'Tim',
              email: 'vic@example.invalid', role: 'customer', is_active: true,
            }],
          };
        }
        return { rows: [] };
      });
    });

    test('without a fresh TOTP event: 401 fresh_auth_required, no session minted', async () => {
      const res = await request(app)
        .post('/api/admin/users/user-9/impersonate')
        .set('Authorization', adminBearer());
      expect(res.status).toBe(401);
      expect(res.body.code).toBe('fresh_auth_required');
      // The controller never ran: no target lookup, no impersonation log row.
      const targetLookups = mockQuery.mock.calls.filter(([sql]) =>
        String(sql).includes('deleted_at IS NULL'));
      expect(targetLookups).toHaveLength(0);
    });

    test('with a fresh TOTP event: exchange code minted for the target user', async () => {
      freshAuthRows = [{
        completed_at: new Date(),
        auth_hash: 'hash-1',
        method: 'totp',
      }];
      const res = await request(app)
        .post('/api/admin/users/user-9/impersonate')
        .set('Authorization', adminBearer());
      expect(res.status).toBe(200);
      expect(res.body.exchangeCode).toEqual(expect.any(String));
      expect(res.body.userId).toBe('user-9');
      expect(res.body).not.toHaveProperty('impersonationToken');
    });
  });
});
