'use strict';

/**
 * assistantGuideRoutes.test.js
 *
 * Gap #2: the AI product guide is a hardcoded prompt constant that goes
 * stale when routes ship or move. This test extracts every route-like path
 * from PLATFORM_GUIDE and asserts it matches a real client route, so a
 * renamed or deleted page breaks CI instead of silently teaching the
 * assistant a dead link.
 */

const fs = require('fs');
const path = require('path');
const { PLATFORM_GUIDE } = require('../services/assistantGuide');

function declaredRoutes() {
  const app = fs.readFileSync(
    path.join(__dirname, '../../client/src/App.jsx'),
    'utf8'
  );
  return [...app.matchAll(/path="([^"]+)"/g)].map((m) => m[1]);
}

function guidePaths() {
  const found = [...PLATFORM_GUIDE.matchAll(/(\/[a-z0-9][a-z0-9\-/]*)/g)].map((m) => m[1]);
  return [...new Set(found)];
}

function routeMatches(routePattern, concretePath) {
  const re = new RegExp(
    '^' + routePattern.replace(/:[a-zA-Z0-9_]+/g, '[^/]+').replace(/\*/g, '.*') + '$'
  );
  return re.test(concretePath);
}

describe('assistant product guide routes', () => {
  test('every path named in the guide matches a declared client route', () => {
    const routes = declaredRoutes();
    expect(routes.length).toBeGreaterThan(0);
    const paths = guidePaths();
    expect(paths.length).toBeGreaterThan(0);
    const missing = paths.filter((p) => !routes.some((r) => routeMatches(r, p)));
    expect(missing).toEqual([]);
  });
});
