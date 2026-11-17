'use strict';

/**
 * Domain 6 audit (2026-11-17, auth/roles/permissions) — Track E findings
 * 7, 11, 12: rejectImpersonated gaps.
 *
 *  Finding 7:  POST /switch-role (routes/auth.js) had no rejectImpersonated;
 *              an impersonated session could rewrite the victim's
 *              role/default_mode and rotate their session.
 *  Finding 11: POST /api/admin/jobs/:jobId/cancel (routes/agentJobActions.js)
 *              had requireAdmin + issue_refunds but no rejectImpersonated;
 *              only the step-up issuance route carried it.
 *  Finding 12: POST /super/oxsteed-credit/participants/:participantId/activation,
 *              POST /super/oxsteed-credit/partners/:partnerId/agreements and
 *              POST /super/oxsteed-credit/agreements/:agreementId/transition
 *              (routes/admin.js) carried only requireSuperAdmin +
 *              creditAdminMutationLimiter; neighbouring credit mutations
 *              carry rejectImpersonated.
 *
 * Each finding is pinned twice: a router-stack inspection (the guard is
 * mounted on the exact route, in the right position) and a behavioural
 * test (an impersonated session gets 403 impersonation_blocked and the
 * handler never runs).
 *
 * Non-DB suite: all auth/DB access is via the shared mockQuery, following
 * authImpersonationGuards.test.js and agentJobCancel.test.js.
 */

const { mockQuery, resetMocks } = require('./setup');
const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');

const { rejectImpersonated } = require('../middleware/rejectImpersonated');

const SECRET = process.env.JWT_SECRET;

// ── Finding 11 only: skip token/session auth on the agent-job router ──────
// Mirrors agentJobCancel.test.js ("tests exercise grant gating, not session
// auth"), extended with a toggle so the same app can present an
// impersonated admin session. requireSuperAdmin stays real: finding 12
// relies on it.
let mockAgentImpersonated = false;
jest.mock('../middleware/adminAuth', () => {
  const actual = jest.requireActual('../middleware/adminAuth');
  return {
    ...actual,
    requireAdmin: (req, _res, next) => {
      req.user = { id: 'admin-9' };
      req.isSuper = false;
      req.isImpersonated = mockAgentImpersonated;
      if (mockAgentImpersonated) req.impersonatedBy = 'admin-1';
      next();
    },
  };
});

jest.mock('../services/stepupChallengeService', () => ({
  verifyStepupChallenge: jest.fn(async () => ({ ok: true })),
  issueStepupChallenge: jest.fn(async () => ({ challengeId: 'test-challenge' })),
}));

jest.mock('../services/jobCancellationService', () => ({
  cancelJobTransaction: jest.fn(),
  finalizeJobCancellation: jest.fn().mockResolvedValue(undefined),
  PRE_ACCEPTANCE_STATUSES: ['draft', 'published', 'matched', 'negotiating'],
}));

const agentJobActionsRoutes = require('../routes/agentJobActions');
const jobCancellationService = require('../services/jobCancellationService');

function bearer(claims) {
  return `Bearer ${jwt.sign(
    { typ: 'access', sid: 'test-session', id: 'user-1', ...claims },
    SECRET,
    { algorithm: 'HS256' },
  )}`;
}

const impersonationBearer = (id = 'victim-1') => bearer({
  id,
  impersonation: true,
  impersonated_by: 'admin-1',
  jti: 'jti-1',
});

/** Handlers mounted on one route path of a router (stack inspection). */
function routeHandlers(router, path) {
  const matches = [];
  for (const layer of router.stack || []) {
    if (!layer.route) continue;
    const routePath = layer.route.path;
    const paths = Array.isArray(routePath) ? routePath : [routePath];
    if (paths.includes(path)) {
      matches.push(...layer.route.stack.map((l) => l.handle));
    }
  }
  return matches;
}

function expectGuarded(router, path) {
  const handlers = routeHandlers(router, path);
  expect(handlers.length).toBeGreaterThan(0);
  expect(handlers).toContain(rejectImpersonated);
}

function buildApp(mountPath, router) {
  const app = express();
  app.use(express.json());
  app.use(mountPath, router);
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => res.status(err.statusCode || 500).json({ code: err.code }));
  return app;
}

beforeEach(() => {
  resetMocks();
  jest.clearAllMocks();
  mockAgentImpersonated = false;
});

// ── Finding 7: POST /switch-role ───────────────────────────────────────────

describe('finding 7: rejectImpersonated on POST /switch-role', () => {
  const authRouter = require('../routes/auth');

  test('the guard is mounted on /switch-role', () => {
    expectGuarded(authRouter, '/switch-role');
  });

  test('the guard runs after authenticate and before the handler', () => {
    const handlers = routeHandlers(authRouter, '/switch-role');
    const guardIdx = handlers.indexOf(rejectImpersonated);
    expect(guardIdx).toBeGreaterThan(0);
    expect(guardIdx).toBeLessThan(handlers.length - 1);
  });

  describe('behavior: impersonated session cannot switch the victim role', () => {
    let app;
    beforeAll(() => {
      app = buildApp('/auth', require('../routes/auth'));
    });

    beforeEach(() => {
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

    test('impersonated session is 403 impersonation_blocked', async () => {
      const res = await request(app)
        .post('/auth/switch-role')
        .set('Authorization', impersonationBearer())
        .send({ mode: 'helper' });
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('impersonation_blocked');
      // The handler never ran: no role/mode write was attempted.
      const writes = mockQuery.mock.calls.filter(([sql]) =>
        /UPDATE users SET/i.test(String(sql)));
      expect(writes).toHaveLength(0);
    });

    test('control: a non-impersonated session is not blocked by the guard', async () => {
      const res = await request(app)
        .post('/auth/switch-role')
        .set('Authorization', bearer({ id: 'victim-1' }))
        .send({ mode: 'customer' });
      expect(res.body.code).not.toBe('impersonation_blocked');
      expect(res.body.error).not.toBe('Impersonated sessions cannot perform this action.');
    });
  });
});

// ── Finding 11: POST /api/admin/jobs/:jobId/cancel ─────────────────────────

describe('finding 11: rejectImpersonated on POST /jobs/:jobId/cancel', () => {
  test('the guard is mounted on the cancel route', () => {
    expectGuarded(agentJobActionsRoutes, '/jobs/:jobId/cancel');
  });

  test('the guard matches the step-up issuance route order (requireAdmin, guard, grant)', () => {
    const handlers = routeHandlers(agentJobActionsRoutes, '/jobs/:jobId/cancel');
    const guardIdx = handlers.indexOf(rejectImpersonated);
    expect(guardIdx).toBeGreaterThan(0);
    expect(guardIdx).toBeLessThan(handlers.length - 1);
  });

  describe('behavior: impersonated admin session cannot cancel a job', () => {
    let app;
    beforeAll(() => {
      app = buildApp('/api/admin', agentJobActionsRoutes);
    });

    test('impersonated session is 403 impersonation_blocked before the grant check', async () => {
      mockAgentImpersonated = true;
      const res = await request(app)
        .post('/api/admin/jobs/123/cancel')
        .send({ reason: 'Duplicate job' });
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('impersonation_blocked');
      // The guard fires before requirePermission, so no grant lookup ran
      // and the cancellation transaction never started.
      expect(mockQuery).not.toHaveBeenCalled();
      expect(jobCancellationService.cancelJobTransaction).not.toHaveBeenCalled();
    });

    test('control: a non-impersonated admin with the grant still cancels', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ id: 1, region_id: null, grant_source: 'direct' }] });
      mockQuery.mockResolvedValueOnce({ rows: [{ status: 'cancelled' }] }); // fast-path check
      const res = await request(app)
        .post('/api/admin/jobs/123/cancel')
        .send({ reason: 'Second attempt' });
      expect(res.status).toBe(200);
      expect(res.body.alreadyCancelled).toBe(true);
      expect(jobCancellationService.cancelJobTransaction).not.toHaveBeenCalled();
    });
  });
});

// ── Finding 12: participant activation / agreement routes ──────────────────

describe('finding 12: rejectImpersonated on participant activation / agreement routes', () => {
  const adminRouter = require('../routes/admin');
  const routes = [
    '/super/oxsteed-credit/participants/:participantId/activation',
    '/super/oxsteed-credit/partners/:partnerId/agreements',
    '/super/oxsteed-credit/agreements/:agreementId/transition',
  ];

  test.each(routes)('the guard is mounted on %s', (routePath) => {
    expectGuarded(adminRouter, routePath);
  });

  test('the guard runs after requireSuperAdmin and before the limiter on each route', () => {
    for (const routePath of routes) {
      const handlers = routeHandlers(adminRouter, routePath);
      const guardIdx = handlers.indexOf(rejectImpersonated);
      expect(guardIdx).toBeGreaterThan(0);
      expect(guardIdx).toBeLessThan(handlers.length - 1);
    }
  });

  describe('behavior: impersonated session cannot run the credit mutations', () => {
    let app;
    beforeAll(() => {
      app = buildApp('/api/admin', require('../routes/admin'));
    });

    beforeEach(() => {
      mockQuery.mockImplementation(async (text) => {
        const sql = String(text);
        // requireSuperAdmin's admin lookup (TOTP-enrolled super-admin).
        if (sql.includes('COALESCE(totp_enabled')) {
          return { rows: [{ id: 'admin-1', role: 'super_admin', is_active: true, totp_enabled: true }] };
        }
        return { rows: [] };
      });
    });

    test.each([
      ['participant activation', '/api/admin/super/oxsteed-credit/participants/p-1/activation', {}],
      ['agreement create', '/api/admin/super/oxsteed-credit/partners/p-1/agreements', {}],
      ['agreement transition', '/api/admin/super/oxsteed-credit/agreements/a-1/transition', {}],
    ])('%s from an impersonated session is 403 impersonation_blocked', async (_label, url, body) => {
      const res = await request(app)
        .post(url)
        .set('Authorization', impersonationBearer('admin-1'))
        .send(body);
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('impersonation_blocked');
    });

    test('control: a non-impersonated super-admin is not blocked by the guard', async () => {
      const res = await request(app)
        .post('/api/admin/super/oxsteed-credit/participants/p-1/activation')
        .set('Authorization', bearer({ id: 'admin-1' }))
        .send({});
      expect(res.body.code).not.toBe('impersonation_blocked');
    });
  });
});
