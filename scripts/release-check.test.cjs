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
  '/api/monitoring/release-gate': {
    status: 200,
    body: {
      status: 'pass',
      checkedAt: '2026-09-30T00:00:00.000Z',
      signals: {
        auditIntegrity: { status: 'pass', detail: '12 entries verified' },
        backup: { status: 'pass', detail: 'last successful backup 3.5h ago' },
        webhooks: { status: 'pass', detail: 'no failed or overdue webhooks' },
        deliveryEvents: { status: 'pass', detail: 'no failed delivery events' },
        reconciliation: { status: 'pass', detail: 'no failed or stuck refunds' },
        queues: { status: 'pass', detail: 'no stale queued items' },
      },
    },
  },
};

const failingGateRoutes = {
  ...healthyRoutes,
  '/api/monitoring/release-gate': {
    status: 503,
    body: {
      status: 'fail',
      checkedAt: '2026-09-30T00:00:00.000Z',
      signals: {
        auditIntegrity: { status: 'fail', detail: '4 admin audit chain entries are invalid', brokenCount: 4 },
        backup: { status: 'fail', detail: 'no successful backup recorded' },
        webhooks: { status: 'pass', detail: 'no failed or overdue webhooks' },
        deliveryEvents: { status: 'pass', detail: 'no failed delivery events' },
        reconciliation: { status: 'warn', detail: '2 refunds stuck pending over 1h' },
        queues: { status: 'pass', detail: 'no stale queued items' },
      },
    },
  },
};

test('parseArgs requires a valid http(s) base URL', () => {
  assert.throws(() => parseArgs([]), /--base/);
  assert.throws(() => parseArgs(['--base', 'not-a-url']), /valid URL/);
  assert.throws(() => parseArgs(['--base', 'ftp://x.com']), /http\(s\)/);
  const args = parseArgs(['--base', 'https://oxsteed.com/']);
  assert.equal(args.base, 'https://oxsteed.com');
});

test('parseArgs accepts an admin token via --token or OXSTEED_ADMIN_TOKEN', () => {
  assert.equal(parseArgs(['--base', 'https://oxsteed.com', '--token', 'abc']).token, 'abc');
  assert.equal(parseArgs(['--base', 'https://oxsteed.com', '--admin-token', 'xyz']).token, 'xyz');
  process.env.OXSTEED_ADMIN_TOKEN = 'from-env';
  try {
    assert.equal(parseArgs(['--base', 'https://oxsteed.com']).token, 'from-env');
  } finally {
    delete process.env.OXSTEED_ADMIN_TOKEN;
  }
});

test('healthy release passes every check', async () => {
  const report = await releaseCheck({ base: 'https://oxsteed.com', fetchImpl: mockFetch(healthyRoutes) });
  assert.equal(report.ok, true);
  assert.equal(report.checks.length, 4);
  assert.ok(report.checks.every((c) => c.ok));
});

test('release gate is skipped without a token and reported as SKIP', async () => {
  const report = await releaseCheck({ base: 'https://oxsteed.com', fetchImpl: mockFetch(healthyRoutes) });
  const gate = report.checks.find((c) => c.name === 'release-gate');
  assert.equal(gate.ok, true);
  assert.equal(gate.skipped, true);
  assert.match(formatHuman(report), /\[SKIP\] release-gate/);
  assert.equal(report.ok, true);
});

test('passing release gate with a token keeps the release healthy', async () => {
  const seen = [];
  const fetchImpl = async (url, opts) => {
    seen.push([url, opts?.headers?.Authorization]);
    return mockFetch(healthyRoutes)(url);
  };
  const report = await releaseCheck({ base: 'https://oxsteed.com', token: 't', fetchImpl });
  const gate = report.checks.find((c) => c.name === 'release-gate');
  assert.equal(gate.ok, true);
  assert.equal(gate.skipped, undefined);
  assert.match(gate.detail, /all operational signals pass/);
  assert.equal(report.ok, true);
  const gateCall = seen.find(([url]) => new URL(url).pathname === '/api/monitoring/release-gate');
  assert.equal(gateCall[1], 'Bearer t');
});

test('failing release gate blocks the release and names failing signals', async () => {
  const report = await releaseCheck({
    base: 'https://oxsteed.com', token: 't', fetchImpl: mockFetch(failingGateRoutes),
  });
  assert.equal(report.ok, false);
  const gate = report.checks.find((c) => c.name === 'release-gate');
  assert.equal(gate.ok, false);
  assert.match(gate.detail, /auditIntegrity/);
  assert.match(gate.detail, /backup/);
  assert.equal(gate.warnings.length, 1);
  assert.match(gate.warnings[0], /reconciliation/);
  assert.match(formatHuman(report), /RESULT: release unhealthy/);
});

test('release gate 401 fails closed', async () => {
  const routes = {
    ...healthyRoutes,
    '/api/monitoring/release-gate': { status: 401, body: { error: 'Unauthorized' } },
  };
  const report = await releaseCheck({
    base: 'https://oxsteed.com', token: 'bad', fetchImpl: mockFetch(routes),
  });
  assert.equal(report.ok, false);
  const gate = report.checks.find((c) => c.name === 'release-gate');
  assert.equal(gate.ok, false);
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
  const publicChecks = report.checks.filter((c) => c.name !== 'release-gate');
  assert.ok(publicChecks.every((c) => c.ok === false));
  const gate = report.checks.find((c) => c.name === 'release-gate');
  assert.equal(gate.skipped, true);
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
