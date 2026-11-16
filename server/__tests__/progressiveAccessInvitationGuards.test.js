'use strict';

/**
 * WP-009: invitation and Vortex entry points require an eligible account.
 * The controller queries are already account/email scoped and transactional;
 * these route contracts ensure an authenticated but unverified account cannot
 * enumerate, preview, accept, decline, or redeem a business relationship.
 */

const vortexRoutes = require('../routes/vortex');
const businessRoutes = require('../routes/businesses');
const requireEmailVerified = require('../middleware/requireEmailVerified');

function routeLayer(router, method, path) {
  const layer = router.stack.find(
    (entry) => entry.route
      && entry.route.path === path
      && entry.route.methods[method],
  );
  expect(layer).toBeDefined();
  return layer;
}

function hasMiddleware(layer, middleware) {
  return layer.route.stack.some((entry) => entry.handle === middleware);
}

describe('WP-009 invitation and Vortex verification guards', () => {
  test.each([
    ['GET', '/invitations'],
    ['POST', '/invitations/:id/accept'],
    ['POST', '/invitations/:id/decline'],
    ['POST', '/vortex/redeem'],
  ])('%s %s requires verified email', (method, path) => {
    expect(hasMiddleware(routeLayer(businessRoutes, method.toLowerCase(), path), requireEmailVerified)).toBe(true);
  });

  test.each([
    ['POST', '/preview'],
    ['POST', '/redeem'],
  ])('top-level Vortex %s requires verified email', (method, path) => {
    expect(hasMiddleware(routeLayer(vortexRoutes, method.toLowerCase(), path), requireEmailVerified)).toBe(true);
  });

  test('unverified accounts are denied before the relationship handler', () => {
    const req = { user: { id: 'u1', email: 'u1@example.invalid', email_verified: false }, method: 'POST', path: '/invitations/1/accept' };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
    const next = jest.fn();

    requireEmailVerified(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'email_not_verified' }));
    expect(next).not.toHaveBeenCalled();
  });

  test('verified accounts continue to the relationship handler', () => {
    const req = { user: { id: 'u1', email: 'u1@example.invalid', email_verified: true }, method: 'POST', path: '/invitations/1/accept' };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
    const next = jest.fn();

    requireEmailVerified(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });
});
