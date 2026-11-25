'use strict';

// PWA silent updates (D-444): GET /api/version returns the release id open
// tabs compare against before calling registration.update(). The value comes
// from utils/release (the same source the client build stamps), and the
// route is public and cache-free so a fresh deploy is never hidden from the
// tab asking. No database is needed: the handler reads env only.
const fs = require('fs');
const path = require('path');

describe('GET /api/version (PWA silent updates)', () => {
  test('getRelease honors the release env precedence', () => {
    const { getRelease } = require('../utils/release');
    expect(getRelease({ SENTRY_RELEASE: 'rel-1', COMMIT_SHA: 'abc', SOURCE_COMMIT: 'def' })).toBe('rel-1');
    expect(getRelease({ COMMIT_SHA: 'abc', SOURCE_COMMIT: 'def' })).toBe('abc');
    expect(getRelease({ SOURCE_COMMIT: 'def' })).toBe('def');
    expect(getRelease({})).toBeNull();
  });

  test('server/index.js mounts a public, no-store /api/version route backed by getRelease', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');
    expect(source).toMatch(/app\.get\('\/api\/version'/);
    expect(source).toMatch(/require\('.\/utils\/release'\)/);
    const route = source.slice(source.indexOf("app.get('/api/version'"));
    expect(route).toMatch(/Cache-Control', 'no-store'/);
    expect(route).toMatch(/getRelease\(\)/);
    expect(route).toMatch(/buildId/);
  });
});
