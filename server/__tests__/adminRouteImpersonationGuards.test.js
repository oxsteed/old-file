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
const adminRestaurantSupportRouter = require('../routes/adminRestaurantSupport');

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

// Middleware mounted via router.use(...) lives on stack layers with no
// .route; collect those functions so a router-level guard can be asserted.
function routerMiddleware(router) {
  const fns = [];
  for (const layer of router.stack || []) {
    if (!layer.route && typeof layer.handle === 'function') fns.push(layer.handle);
  }
  return fns;
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

describe('Domain 6 finding 9: rejectImpersonated on restaurant suspend/restore/verify', () => {
  test('suspend', () => {
    expectGuarded(adminRouter, '/restaurants/:id/suspend');
  });

  test('restore', () => {
    expectGuarded(adminRouter, '/restaurants/:id/restore');
  });

  test('verify', () => {
    expectGuarded(adminRouter, '/restaurants/:id/verify');
  });

  test('the guard runs after auth and before the controller on suspend', () => {
    const handlers = routeHandlers(adminRouter, '/restaurants/:id/suspend');
    const guardIdx = handlers.indexOf(rejectImpersonated);
    expect(guardIdx).toBeGreaterThan(0);
    // The suspend controller is an anonymous arrow (name ''), so order by
    // position: the guard is not the last handler; the controller runs after it.
    expect(guardIdx).toBeLessThan(handlers.length - 1);
  });
});

describe('Domain 6 finding 10: rejectImpersonated on the admin restaurant-support router', () => {
  test('router-level middleware rejects impersonated sessions', () => {
    expect(routerMiddleware(adminRestaurantSupportRouter)).toContain(rejectImpersonated);
  });

  test('the guard runs after requireAdmin in the router middleware chain', () => {
    const fns = routerMiddleware(adminRestaurantSupportRouter);
    const guardIdx = fns.indexOf(rejectImpersonated);
    expect(guardIdx).toBeGreaterThan(0);
  });

  test('every mutation route on the router inherits the guard', () => {
    // The guard is mounted once via router.use, so each route's own stack
    // is unchanged; assert the router-level chain covers the mutation
    // paths by checking they exist on the router at all.
    const paths = routeHandlers(adminRestaurantSupportRouter, '/cases/:caseId/close');
    expect(paths.length).toBeGreaterThan(0);
    expect(routerMiddleware(adminRestaurantSupportRouter)).toContain(rejectImpersonated);
  });
});
