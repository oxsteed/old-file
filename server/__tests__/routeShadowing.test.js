'use strict';

/**
 * Route shadowing regressions.
 *
 * Express matches routes in registration order, so a static path registered
 * after a parameter path (/:id) is unreachable. These tests lock in the
 * registration order that keeps the static paths reachable, and guard the
 * whole routes/ directory against undefined handlers (the class of bug that
 * crashed production at startup).
 */

const fs = require('fs');
const path = require('path');

// setup.js partially mocks templateController (only grantFreeTrialToUser).
// For route-registration checks we need the real handlers.
jest.mock('../controllers/templateController', () => ({
  ...jest.requireActual('../controllers/templateController'),
  grantFreeTrialToUser: jest.fn().mockResolvedValue(true),
}));

function routeIndex(router, method, routePath) {
  const layers = router.stack.filter((l) => l.route);
  return layers.findIndex(
    (l) => l.route.path === routePath && l.route.methods[method.toLowerCase()],
  );
}

describe('static routes are registered before parameter routes', () => {
  test('shopping carts: GET /templates before GET /:cartId', () => {
    const router = require('../routes/shoppingCarts');
    const templates = routeIndex(router, 'GET', '/templates');
    const byId = routeIndex(router, 'GET', '/:cartId');
    expect(templates).toBeGreaterThanOrEqual(0);
    expect(byId).toBeGreaterThanOrEqual(0);
    expect(templates).toBeLessThan(byId);
  });

  test('tool rentals: /payment-method before /:id and /:toolId/*', () => {
    const router = require('../routes/toolRentals');
    const getPm = routeIndex(router, 'GET', '/payment-method');
    const deletePm = routeIndex(router, 'DELETE', '/payment-method');
    const deleteById = routeIndex(router, 'DELETE', '/:id');
    const availability = routeIndex(router, 'GET', '/:toolId/availability');
    for (const i of [getPm, deletePm, deleteById, availability]) {
      expect(i).toBeGreaterThanOrEqual(0);
    }
    expect(getPm).toBeLessThan(availability);
    expect(deletePm).toBeLessThan(deleteById);
  });
});

describe('all route files register without undefined handlers', () => {
  const routesDir = path.join(__dirname, '..', 'routes');
  const files = fs.readdirSync(routesDir).filter((f) => f.endsWith('.js'));

  test.each(files)('%s loads', (file) => {
    expect(() => require(path.join(routesDir, file))).not.toThrow();
  });

  test('every registered layer has a function handler', () => {
    for (const file of files) {
      const router = require(path.join(routesDir, file));
      const stack = router.stack || [];
      for (const layer of stack) {
        if (!layer.route) continue; // middleware layers are out of scope
        for (const handle of layer.route.stack) {
          expect(typeof handle.handle).toBe('function');
        }
      }
    }
  });
});
