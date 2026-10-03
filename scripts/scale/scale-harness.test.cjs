'use strict';

/**
 * Regression tests for the V2-P1-05 scale harness.
 * Run: node --test scripts/scale/scale-harness.test.cjs
 * Spins stub HTTP/WebSocket servers; no live target needed.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const net = require('net');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { SCALE_MODEL, validateModel, deriveLoad, sliceCoverage } = require('./scaleModel.cjs');
const { SCENARIOS, validateScenarios, totalWeight } = require('./scenarios.cjs');
const { evaluateSlo, evaluateGlobal, getSlo } = require('./slos.cjs');
const { StatsCollector, percentile } = require('./stats.cjs');
const { createHttpClient, buildMultipart } = require('./httpClient.cjs');
const { connectWs, encodeFrame, createFrameParser, acceptKey } = require('./wsClient.cjs');
const { generateFixtures, buildSeedSql, mulberry32 } = require('./fixtures.cjs');
const { buildReport, writeReport } = require('./report.cjs');
const { main, parseArgs, parseDuration, buildStages, isLocalTarget } = require('./harness.cjs');

// ---------- scale model ----------

test('scale model shares sum to 1 and derives the documented peak', () => {
  assert.deepEqual(validateModel(), []);
  assert.equal(SCALE_MODEL.totalUsers, 6_000_000);
  assert.equal(SCALE_MODEL.totalStaff, 3_500);
  const load = deriveLoad();
  assert.equal(load.peakConcurrentUsers, 120_000);
  assert.equal(load.peakConcurrentStaff, 1_225);
  assert.equal(load.peakConcurrentSessions, 121_225);
  assert.ok(Math.abs(load.peakRequestsPerSecond - 6061.3) < 0.05);
});

test('slice coverage states the extrapolation factor honestly', () => {
  const c = sliceCoverage(50);
  assert.equal(c.vus, 50);
  assert.ok(c.coverageFraction < 0.001);
  assert.ok(Math.abs(c.extrapolationFactor - 121225 / 50) < 0.01);
});

// ---------- scenario catalog ----------

test('scenario catalog is valid and covers the audit pressure points', () => {
  assert.deepEqual(validateScenarios(), []);
  assert.ok(totalWeight() > 0);
  const ids = SCENARIOS.map((s) => s.id);
  for (const required of ['browse-discover', 'search-pressure', 'websocket-fanout', 'uploads', 'food-ordering', 'delivery-tracking', 'wallet-credit', 'payments', 'support-journey', 'exports', 'admin-ops', 'messaging']) {
    assert.ok(ids.includes(required), `missing scenario ${required}`);
  }
  for (const scenario of SCENARIOS) {
    assert.ok(['customer', 'helper', 'business', 'staff', 'anonymous'].includes(scenario.persona), `scenario ${scenario.id} bad persona`);
    assert.ok(Array.isArray(scenario.pressurePoints) && scenario.pressurePoints.length > 0, `scenario ${scenario.id} missing pressurePoints`);
    for (const step of scenario.steps) {
      if (typeof step.path === 'string') assert.ok(step.path.startsWith('/'), `step ${step.name} path must be absolute`);
    }
  }
});

test('AI-spending steps are flagged opt-in', () => {
  const aiSteps = SCENARIOS.flatMap((s) => s.steps.filter((st) => st.requiresAi));
  assert.ok(aiSteps.length > 0, 'expected at least one AI-gated step');
});

// ---------- fixtures ----------

test('fixture generator is deterministic per seed', () => {
  const dirA = fs.mkdtempSync(path.join(os.tmpdir(), 'scale-a-'));
  const dirB = fs.mkdtempSync(path.join(os.tmpdir(), 'scale-b-'));
  const dirC = fs.mkdtempSync(path.join(os.tmpdir(), 'scale-c-'));
  generateFixtures({ seed: 7, sampleUsers: 200, sampleStaff: 20, outDir: dirA });
  generateFixtures({ seed: 7, sampleUsers: 200, sampleStaff: 20, outDir: dirB });
  generateFixtures({ seed: 8, sampleUsers: 200, sampleStaff: 20, outDir: dirC });
  const hash = (dir, file) => crypto.createHash('sha256').update(fs.readFileSync(path.join(dir, file))).digest('hex');
  for (const file of ['users.jsonl', 'staff.jsonl', 'seed.sql']) {
    assert.equal(hash(dirA, file), hash(dirB, file), `${file} not deterministic`);
  }
  assert.notEqual(hash(dirA, 'users.jsonl'), hash(dirC, 'users.jsonl'), 'different seed should differ');
  const sql = fs.readFileSync(path.join(dirA, 'seed.sql'), 'utf8');
  assert.ok(sql.includes('scale_fixture_users'));
  assert.ok(!/DROP TABLE/i.test(sql), 'fixture SQL must never drop tables');
  assert.ok(sql.includes('TEST-ONLY'));
});

test('mulberry32 PRNG is stable', () => {
  const a = mulberry32(42);
  const b = mulberry32(42);
  for (let i = 0; i < 10; i += 1) assert.equal(a(), b());
});

test('seed SQL escapes quotes', () => {
  const sql = buildSeedSql(
    [{ synthetic_id: "u_o'brien", region: 'us-east', persona: 'customer', locale: 'en', device: 'web', created_days_ago: 1 }],
    [],
  );
  assert.ok(sql.includes("u_o''brien"));
});

// ---------- stats ----------

test('percentile math is correct', () => {
  assert.equal(percentile([10, 20, 30, 40], 50), 25);
  assert.equal(percentile([10, 20, 30, 40], 0), 10);
  assert.equal(percentile([10, 20, 30, 40], 100), 40);
  assert.equal(percentile([], 95), 0);
});

test('stats collector aggregates requests, failures and skips', () => {
  const stats = new StatsCollector();
  stats.record('s1', 'step-a', { latencyMs: 100, status: 200, ok: true, failure: false, bytes: 10 });
  stats.record('s1', 'step-a', { latencyMs: 300, status: 500, ok: false, failure: true, bytes: 5, errorKind: 'timeout' });
  stats.record('s1', 'step-a', { skipped: true });
  stats.record('s1', 'step-b', { latencyMs: 50, status: 404, ok: false, failure: false, bytes: 2 });
  const snap = stats.snapshot();
  assert.equal(snap.scenarios.s1.requests, 3);
  assert.equal(snap.scenarios.s1.failures, 1);
  assert.equal(snap.scenarios.s1.clientErrors, 1);
  assert.equal(snap.scenarios.s1.skipped, 1);
  assert.equal(snap.global.requests, 3);
  assert.deepEqual(snap.steps['s1/step-a'].errorKinds, { timeout: 1 });
  assert.equal(snap.steps['s1/step-a'].statusCounts[500], 1);
});

// ---------- SLOs ----------

test('SLO evaluation passes a healthy aggregate and fails breaches', () => {
  const healthy = { requests: 1000, failures: 2, clientErrors: 10, p50: 100, p95: 400, p99: 800 };
  const sloId = 'browse-discover';
  assert.ok(getSlo(sloId), 'expected an SLO for browse-discover');
  assert.equal(evaluateSlo(sloId, healthy).pass, true);
  const slow = { ...healthy, p95: 5000 };
  const slowResult = evaluateSlo(sloId, slow);
  assert.equal(slowResult.pass, false);
  assert.ok(slowResult.checks.some((c) => c.name === 'p95 latency' && !c.pass));
  const errory = { ...healthy, failures: 50 };
  assert.equal(evaluateSlo(sloId, errory).pass, false);
  assert.equal(evaluateSlo('no-such-scenario', healthy).pass, true);
  assert.equal(evaluateSlo(sloId, { requests: 0, failures: 0, p50: 0, p95: 0, p99: 0 }).pass, true);
  assert.equal(evaluateGlobal(healthy).pass, true);
  assert.equal(evaluateGlobal({ ...healthy, failures: 100 }).pass, false);
});

// ---------- http client ----------

function startStubHttp(routes) {
  const server = http.createServer((req, res) => {
    const route = routes[`${req.method} ${req.url.split('?')[0]}`] || routes.default;
    if (!route) {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end('{}');
      return;
    }
    const delay = route.delayMs || 0;
    setTimeout(() => {
      res.writeHead(route.status || 200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(route.body || { ok: true }));
    }, delay);
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, base: `http://127.0.0.1:${server.address().port}` }));
  });
}

test('http client measures latency and classifies timeouts', async () => {
  const { server, base } = await startStubHttp({
    'GET /fast': { status: 200, delayMs: 20 },
    'GET /slow': { status: 200, delayMs: 5000 },
  });
  try {
    const client = createHttpClient({ timeoutMs: 2000 });
    const fast = await client.request({ method: 'GET', url: `${base}/fast` });
    assert.equal(fast.status, 200);
    assert.ok(fast.latencyMs >= 15, `expected measured latency, got ${fast.latencyMs}`);
    assert.equal(fast.errorKind, undefined);
    const slow = await client.request({ method: 'GET', url: `${base}/slow`, timeout: 100 });
    assert.equal(slow.status, 0);
    assert.equal(slow.errorKind, 'timeout');
    const dead = await client.request({ method: 'GET', url: 'http://127.0.0.1:1/nope', timeout: 500 });
    assert.equal(dead.errorKind, 'connection-error');
    client.close();
  } finally {
    server.close();
  }
});

test('multipart builder produces a valid body', () => {
  const mp = buildMultipart({ field: 'image', filename: 't.png', bytes: 1024 });
  assert.ok(Buffer.isBuffer(mp.body));
  assert.ok(mp.body.length > 1024);
  assert.ok(mp.headers['content-type'].startsWith('multipart/form-data; boundary='));
  assert.ok(mp.body.toString('latin1').includes('filename="t.png"'));
});

// ---------- websocket client ----------

function serverEncodeText(text) {
  const data = Buffer.from(text);
  if (data.length >= 126) throw new Error('stub frame too large');
  return Buffer.concat([Buffer.from([0x81, data.length]), data]);
}

function startStubWs() {
  const server = net.createServer();
  const state = { pongs: 0, events: [] };
  const sockets = new Set();
  const closeAll = () => {
    for (const socket of sockets) socket.destroy();
    server.close();
  };
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('end', () => socket.end());
    let header = '';
    const parser = createFrameParser(({ opcode, payload }) => {
      if (opcode === 0x8) {
        socket.end();
        return;
      }
      if (opcode !== 0x1) return;
      const text = payload.toString('utf8');
      if (text.startsWith('40')) {
        socket.write(serverEncodeText('40/chat,{"sid":"stub-sio"}'));
        setTimeout(() => socket.write(serverEncodeText('2')), 20);
        setTimeout(() => socket.write(serverEncodeText('42/chat,["scale-broadcast",{"n":1}]')), 40);
      } else if (text === '3') {
        state.pongs += 1;
      } else if (text.startsWith('42')) {
        state.events.push(text);
      } else if (text.startsWith('41') || opcode === 0x8) {
        socket.end();
      }
    });
    socket.on('data', (chunk) => {
      if (header !== 'done') {
        header += chunk.toString('latin1');
        const idx = header.indexOf('\r\n\r\n');
        if (idx === -1) return;
        const key = (header.match(/sec-websocket-key:\s*(\S+)/i) || [])[1];
        socket.write(
          `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${acceptKey(key)}\r\n\r\n`,
        );
        const rest = Buffer.from(header.slice(idx + 4), 'latin1');
        socket.write(serverEncodeText('0{"sid":"stub","upgrades":[],"pingInterval":25000,"pingTimeout":20000}'));
        if (rest.length) parser.push(rest);
        header = 'done';
        return;
      }
      parser.push(chunk);
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, state, port: server.address().port, closeAll }));
  });
}

test('websocket client completes the socket.io handshake and answers pings', async () => {
  const { state, port, closeAll } = await startStubWs();
  try {
    const received = [];
    const handle = await connectWs(`http://127.0.0.1:${port}/socket.io/`, {
      namespace: '/chat',
      timeoutMs: 5000,
      onEvent: (event, args) => received.push([event, args]),
    });
    assert.ok(handle.connected);
    assert.ok(handle.stats.connectLatencyMs > 0);
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.ok(handle.stats.pings >= 1, 'expected at least one engine.io ping answered');
    assert.ok(received.some(([event]) => event === 'scale-broadcast'), 'expected the broadcast event');
    handle.emit('client-hello', { n: 2 });
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.ok(state.events.some((e) => e.includes('client-hello')));
    handle.close();
  } finally {
    closeAll();
  }
});

test('websocket client rejects a bad handshake', async () => {
  const plain = http.createServer((req, res) => {
    res.writeHead(200);
    res.end('nope');
  });
  await new Promise((resolve) => plain.listen(0, '127.0.0.1', resolve));
  try {
    await assert.rejects(
      connectWs(`http://127.0.0.1:${plain.address().port}/socket.io/`, { namespace: '/chat', timeoutMs: 2000 }),
      /upgrade failed/,
    );
  } finally {
    plain.close();
  }
});

// ---------- harness arg handling ----------

test('harness arg parsing, durations, stages and locality checks', () => {
  assert.equal(parseDuration('30s'), 30000);
  assert.equal(parseDuration('5m'), 300000);
  assert.equal(parseDuration('1h'), 3600000);
  assert.equal(parseDuration('250ms'), 250);
  assert.throws(() => parseDuration('bogus'), /invalid duration/);
  assert.equal(isLocalTarget('http://localhost:5000'), true);
  assert.equal(isLocalTarget('http://127.0.0.1:5000'), true);
  assert.equal(isLocalTarget('https://staging.example.test'), true);
  assert.equal(isLocalTarget('https://oxsteed.example.com'), false);
  const stages = buildStages(parseArgs(['--target', 'http://localhost:1', '--profile', 'load', '--vus', '10', '--duration', '60s', '--ramp-up', '10s']));
  assert.equal(stages.length, 3);
  assert.equal(stages[1].target, 10);
  assert.throws(() => parseArgs(['--bogus']), /unknown argument/);
  assert.throws(() => buildStages(parseArgs(['--target', 'http://localhost:1', '--profile', 'nope'])), /unknown profile/);
});

test('harness refuses to run without a target', async () => {
  await assert.rejects(main([]), /--target is required/);
});

test('harness refuses remote targets without --confirm-remote', async () => {
  await assert.rejects(
    main(['--target', 'https://oxsteed.example.com', '--profile', 'smoke']),
    /--confirm-remote/,
  );
});

test('harness rejects unknown scenarios', async () => {
  await assert.rejects(
    main(['--target', 'http://localhost:1', '--scenarios', 'nope', '--profile', 'smoke']),
    /unknown scenarios/,
  );
});

// ---------- end-to-end smoke run ----------

function stubRoutes() {
  const ok = { status: 200 };
  return {
    'GET /health': ok,
    'GET /ready': ok,
    'GET /api/discover': { status: 200, delayMs: 5 },
    'GET /api/helpers': ok,
    'GET /api/learn/guides': ok,
    'GET /api/food/markets': ok,
    'GET /api/food/restaurants': ok,
    'GET /api/food/restaurants/1': ok,
    'POST /api/food/restaurants/1/orders/quote': ok,
    'GET /api/food/orders/track/demo-token-a1b2': { status: 404 },
    'GET /api/qr-payments/pay/scale-harness-demo': { status: 404 },
    'POST /api/support-chat/initiate': { status: 201 },
    'POST /api/support/request': { status: 201 },
    'POST /api/chat/message': ok,
  };
}

function startStubTarget() {
  const routes = stubRoutes();
  const sockets = new Set();
  const server = http.createServer((req, res) => {
    const route = routes[`${req.method} ${req.url.split('?')[0]}`];
    if (!route) {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end('{}');
      return;
    }
    setTimeout(() => {
      res.writeHead(route.status || 200, { 'content-type': 'application/json' });
      res.end('{}');
    }, route.delayMs || 0);
  });
  // Minimal socket.io endpoint for the websocket-fanout scenario.
  server.on('upgrade', (req, socket) => {
    if (!req.url.startsWith('/socket.io/')) {
      socket.destroy();
      return;
    }
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('end', () => socket.end());
    const key = req.headers['sec-websocket-key'];
    socket.write(
      `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${acceptKey(key)}\r\n\r\n`,
    );
    socket.write(serverEncodeText('0{"sid":"stub","upgrades":[],"pingInterval":25000,"pingTimeout":20000}'));
    const parser = createFrameParser(({ opcode, payload }) => {
      if (opcode === 0x8) {
        socket.end();
        return;
      }
      if (opcode !== 0x1) return;
      const text = payload.toString('utf8');
      if (text.startsWith('40')) socket.write(serverEncodeText('40/chat,{"sid":"stub-sio"}'));
      else if (text === '2') socket.write(serverEncodeText('3'));
      else if (text.startsWith('41') || text === '') socket.end();
    });
    socket.on('data', (chunk) => parser.push(chunk));
    setTimeout(() => {
      try {
        socket.write(serverEncodeText('2'));
      } catch { /* harness may have closed */ }
    }, 30);
  });
  const closeAll = () => {
    for (const socket of sockets) socket.destroy();
    server.close();
  };
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, closeAll, base: `http://127.0.0.1:${server.address().port}` }));
  });
}

test('harness smoke run passes against the stub target and writes reports', async () => {
  const { closeAll, base } = await startStubTarget();
  const reportDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scale-reports-'));
  try {
    const { exitCode, report } = await main([
      '--target', base,
      '--profile', 'smoke',
      '--vus', '2',
      '--duration', '3s',
      '--ramp-up', '1s',
      '--think-scale', '0.1',
      '--seed', '1',
      '--report-dir', reportDir,
      '--scenarios', 'browse-discover,search-pressure,food-ordering,delivery-tracking,payments,support-journey,ops-liveness,websocket-fanout',
    ]);
    assert.equal(exitCode, 0, `expected PASS, got ${exitCode}`);
    assert.ok(report.throughput.requests > 20, `expected traffic, got ${report.throughput.requests}`);
    assert.equal(report.global.failures, 0);
    assert.ok(report.scenarios['websocket-fanout'].requests > 0, 'expected websocket steps to run');
    assert.ok(report.sloSummary.pass);
    const files = fs.readdirSync(reportDir);
    assert.ok(files.some((f) => f.endsWith('.json')), 'expected a JSON report');
    assert.ok(files.some((f) => f.endsWith('.md')), 'expected a Markdown report');
    const md = fs.readFileSync(path.join(reportDir, files.find((f) => f.endsWith('.md'))), 'utf8');
    assert.ok(md.includes('**PASS**'));
    assert.ok(md.includes('extrapolation factor'));
  } finally {
    closeAll();
  }
});

test('AI-gated steps are skipped by default and run with --include-ai', async () => {
  const { closeAll, base } = await startStubTarget();
  const dirA = fs.mkdtempSync(path.join(os.tmpdir(), 'scale-ai-off-'));
  const dirB = fs.mkdtempSync(path.join(os.tmpdir(), 'scale-ai-on-'));
  const common = ['--target', base, '--vus', '1', '--duration', '2s', '--ramp-up', '0s', '--think-scale', '0.1', '--seed', '3', '--scenarios', 'messaging', '--user-token', 'test-user-token'];
  try {
    const off = await main([...common, '--report-dir', dirA]);
    assert.equal(off.exitCode, 0);
    const offStep = off.report.steps['messaging/ai-chat-message'];
    assert.ok(offStep, 'expected the AI step in the report');
    assert.ok(offStep.skipped > 0 && offStep.requests === 0, 'AI step should be skipped without --include-ai');

    const on = await main([...common, '--include-ai', '--report-dir', dirB]);
    assert.equal(on.exitCode, 0);
    const onStep = on.report.steps['messaging/ai-chat-message'];
    assert.ok(onStep.requests > 0, 'AI step should run with --include-ai');
  } finally {
    closeAll();
  }
});

test('auth-gated steps are skipped without tokens', async () => {
  const { closeAll, base } = await startStubTarget();
  const reportDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scale-auth-'));
  try {
    const { exitCode, report } = await main([
      '--target', base, '--vus', '1', '--duration', '2s', '--ramp-up', '0s',
      '--think-scale', '0.1', '--seed', '5', '--report-dir', reportDir,
      '--scenarios', 'wallet-credit,admin-ops',
    ]);
    assert.equal(exitCode, 0);
    assert.ok(report.global.skipped > 0, 'expected skipped auth steps');
    assert.equal(report.global.requests, 0);
  } finally {
    closeAll();
  }
});

// ---------- reports ----------

test('report builder marks breached SLOs as FAIL', () => {
  const snapshot = {
    elapsedMs: 1000,
    global: { requests: 100, failures: 50, clientErrors: 0, skipped: 0, bytes: 1000, min: 10, max: 9000, mean: 500, p50: 400, p95: 2000, p99: 8000, statusCounts: { 500: 50, 200: 50 }, errorKinds: {} },
    scenarios: {
      'browse-discover': { requests: 100, failures: 50, clientErrors: 0, skipped: 0, bytes: 1000, min: 10, max: 9000, mean: 500, p50: 400, p95: 2000, p99: 8000, statusCounts: {}, errorKinds: {} },
    },
    steps: {},
  };
  const built = buildReport({ runMeta: { target: 'http://localhost:1', profile: 'smoke', vus: 2, duration: '1s', scenarios: ['browse-discover'], seed: 1, includeAi: false, regionLatency: 'none' }, snapshot });
  assert.equal(built.report.sloSummary.pass, false);
  assert.ok(built.markdown.includes('**FAIL**'));
  assert.ok(built.markdown.includes('browse-discover'));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scale-md-'));
  const { jsonPath, mdPath } = writeReport(dir, built);
  assert.ok(fs.existsSync(jsonPath));
  assert.ok(fs.existsSync(mdPath));
});
