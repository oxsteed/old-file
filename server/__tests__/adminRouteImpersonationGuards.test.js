'use strict';

/**
 * rejectImpersonated coverage on money-movement routes (auth-audit findings
 * 28 and 31).
 *
 * Finding 28: the pending-actions maker, the pending-actions decision, and
 * the credit withdrawal approve routes lacked the impersonation guard their
 * sibling money routes carry. Not directly exploitable (impersonation targets
 * non-admin users and requireSuperAdmin re-reads the role from the DB), but
 * the guard is defense-in-depth and must stay.
 *
 * Finding 31: the logistics refund step-up verify route now carries
 * rejectImpersonated, matching the credit step-up verify route.
 *
 * These tests walk the Express router stacks and assert the guard middleware
 * is mounted on the exact routes, so a future route edit cannot silently
 * drop it.
 */

const { rejectImpersonated } = require('../middleware/rejectImpersonated');
const adminRouter = require('../routes/admin');
const logisticsAdminRouter = require('../routes/logisticsAdmin');

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

describe('finding 28: rejectImpersonated on credit money routes', () => {
  test('pending-actions maker', () => {
    expectGuarded(adminRouter, '/super/oxsteed-credit/pending-actions');
  });

  test('pending-actions decision', () => {
    expectGuarded(adminRouter, '/super/oxsteed-credit/pending-actions/:id/decision');
  });

  test('withdrawal approve', () => {
    expectGuarded(adminRouter, '/super/oxsteed-credit/withdrawals/:id/approve');
  });

  test('the guard runs before the mutation limiter on the maker route', () => {
    const handlers = routeHandlers(adminRouter, '/super/oxsteed-credit/pending-actions');
    const guardIdx = handlers.indexOf(rejectImpersonated);
    const ctrlIdx = handlers.findIndex((h) => h && h.name && /requestAdminPendingAction/.test(h.name));
    expect(guardIdx).toBeGreaterThanOrEqual(0);
    if (ctrlIdx >= 0) expect(guardIdx).toBeLessThan(ctrlIdx);
  });
});

describe('finding 31: rejectImpersonated on the logistics refund step-up verify route', () => {
  test('refunds step-up verify', () => {
    expectGuarded(logisticsAdminRouter, '/refunds/stepup/verify');
  });
});
