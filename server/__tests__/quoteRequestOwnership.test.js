'use strict';
require('./setup');
const { optionalAuth } = require('../middleware/auth');

const handlersFor = (router, method, path) => router.stack
  .find((l) => l.route && l.route.path === path && l.route.methods[method])
  .route.stack.map((s) => s.handle);

test('quote request create routes resolve the signed-in owner (P1-173)', () => {
  expect(handlersFor(require('../routes/direct'), 'post', '/requests')).toContain(optionalAuth);
  expect(handlersFor(require('../routes/quoteRequests'), 'post', '/')).toContain(optionalAuth);
});

test('the flow is always direct, whatever the caller sends (P1-182)', () => {
  const src = require('fs').readFileSync(require.resolve('../controllers/quoteRequestsController'), 'utf8');
  expect(src).not.toMatch(/req\.body\.flow/);
});
