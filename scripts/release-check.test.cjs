'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { parseArgs, releaseCheck, formatHuman } = require('./release-check.cjs');

function mockFetch(routes) {
  return async (url) => {
    const route = routes[new URL(url).pathname];
    if (!route) throw new Error(`no mock for ${url}`);
    if (route instanceof Error) throw route;
    return {
      status: route.status,
      json: async () => route.body,
    };
  };
}

const healthyRoutes = {
  '/health': { status: 200, body: { status: 'ok', uptimeSeconds: 42 } },
  '/ready': {
    status: 200,
    body: {
      status: 'ready',
      checks: {
        database: { ok: true },
        migrations: { ok: true },
        workers: { ok: true },
        redis: { ok: true, configured: true },
        realtime: { ok: true },
        traffic: { ok: true },
        shutdown: { ok: true },
      },
    },
  },
  '/api/health/deep': {
    status: 200,
    body: { status: 'ok', checks: { database: { ok: true }, redis: { ok: true, enabled: true } } },
  },
};

test('parseArgs requires a valid http(s) base URL', () => {
  assert.throws(() => parseArgs([]), /--base/);
  assert.throws(() => parseArgs(['--base', 'not-a-url']), /valid URL/);
  assert.throws(() => parseArgs(['--base', 'ftp://x.com']), /http\(s\)/);
  const args = parseArgs(['--base', 'https://oxsteed.com/']);
  assert.equal(args.base, 'https://oxsteed.com');
});

test('healthy release passes every check', async () => {
  const report = await releaseCheck({ base: 'https://oxsteed.com', fetchImpl: mockFetch(healthyRoutes) });
  assert.equal(report.ok, true);
  assert.equal(report.checks.length, 3);
  assert.ok(report.checks.every((c) => c.ok));
});

test('not-ready /ready fails the release with failing subchecks named', async () => {
  const routes = {
    ...healthyRoutes,
    '/ready': {
      status: 503,
      body: { status: 'not_ready', checks: { database: { ok: true }, workers: { ok: false, error: 'stalled' } } },
    },
  };
  const report = await releaseCheck({ base: 'https://oxsteed.com', fetchImpl: mockFetch(routes) });
  assert.equal(report.ok, false);
  const readiness = report.checks.find((c) => c.name === 'readiness');
  assert.equal(readiness.ok, false);
  assert.match(readiness.detail, /workers/);
});

test('unreachable host fails closed instead of passing silently', async () => {
  const report = await releaseCheck({
    base: 'https://oxsteed.com',
    fetchImpl: async () => { throw new Error('fetch failed'); },
  });
  assert.equal(report.ok, false);
  assert.ok(report.checks.every((c) => c.ok === false));
});

test('degraded deep-health fails the release', async () => {
  const routes = {
    ...healthyRoutes,
    '/api/health/deep': { status: 503, body: { status: 'degraded', checks: { database: { ok: false } } } },
  };
  const report = await releaseCheck({ base: 'https://oxsteed.com', fetchImpl: mockFetch(routes) });
  assert.equal(report.ok, false);
  assert.match(formatHuman(report), /RESULT: release unhealthy/);
});

test('human format lists each check with a final verdict', async () => {
  const report = await releaseCheck({ base: 'https://oxsteed.com', fetchImpl: mockFetch(healthyRoutes) });
  const out = formatHuman(report);
  assert.match(out, /\[PASS\] liveness/);
  assert.match(out, /\[PASS\] readiness/);
  assert.match(out, /\[PASS\] deep-health/);
  assert.match(out, /RESULT: healthy release/);
});
