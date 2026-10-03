'use strict';

/**
 * OxSteed scale harness (V2-P1-05).
 *
 * Node-based load/soak runner. Models slices of the 6M-user / 3,500-staff
 * scale model (see scaleModel.cjs) with weighted scenarios over the real
 * API routes (see scenarios.cjs), evaluates per-scenario SLOs
 * (see slos.cjs), and writes JSON + Markdown reports.
 *
 * Live runs against real infrastructure are an operator step and are never
 * attempted by this tool on its own: non-local targets require
 * --confirm-remote, AI-spending steps are opt-in, and auth-gated steps are
 * skipped (counted, never failed) without tokens.
 *
 * Usage:
 *   node scripts/scale/harness.cjs --target http://localhost:5000 --profile smoke
 *   node scripts/scale/harness.cjs --target https://staging.example.test --profile load --confirm-remote
 */

const { SCENARIOS, validateScenarios } = require('./scenarios.cjs');
const { SCALE_MODEL } = require('./scaleModel.cjs');
const { StatsCollector } = require('./stats.cjs');
const { createHttpClient, buildMultipart } = require('./httpClient.cjs');
const { connectWs } = require('./wsClient.cjs');
const { buildReport, writeReport } = require('./report.cjs');
const { mulberry32 } = require('./fixtures.cjs');

const PROFILES = {
  smoke: { vus: 2, duration: '15s', rampUp: '2s' },
  load: { vus: 50, duration: '5m', rampUp: '30s' },
  soak: { vus: 50, duration: '30m', rampUp: '1m' },
  spike: { stages: [{ duration: '30s', target: 200 }, { duration: '60s', target: 200 }, { duration: '30s', target: 20 }] },
};

function parseDuration(text) {
  if (typeof text === 'number') return text * 1000;
  const m = /^(\d+(?:\.\d+)?)\s*(ms|s|m|h)?$/.exec(String(text).trim());
  if (!m) throw new Error(`invalid duration: ${text}`);
  const value = Number(m[1]);
  const unit = m[2] || 's';
  return Math.round(value * { ms: 1, s: 1000, m: 60000, h: 3600000 }[unit]);
}

function parseArgs(argv) {
  const args = {
    target: null,
    scenarios: null,
    profile: 'load',
    vus: null,
    duration: null,
    iterations: null,
    rampUp: null,
    thinkScale: 1,
    seed: 42,
    userToken: process.env.OXSTEED_SCALE_USER_TOKEN || null,
    adminToken: process.env.OXSTEED_SCALE_ADMIN_TOKEN || null,
    includeAi: false,
    regionLatency: 'none',
    timeout: 15000,
    reportDir: 'scale-reports',
    confirmRemote: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--target') args.target = next();
    else if (a === '--scenarios') args.scenarios = next().split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--profile') args.profile = next();
    else if (a === '--vus') args.vus = Number(next());
    else if (a === '--duration') args.duration = next();
    else if (a === '--iterations') args.iterations = Number(next());
    else if (a === '--ramp-up') args.rampUp = next();
    else if (a === '--think-scale') args.thinkScale = Number(next());
    else if (a === '--seed') args.seed = Number(next());
    else if (a === '--user-token') args.userToken = next();
    else if (a === '--admin-token') args.adminToken = next();
    else if (a === '--include-ai') args.includeAi = true;
    else if (a === '--region-latency') args.regionLatency = next();
    else if (a === '--timeout') args.timeout = Number(next());
    else if (a === '--report-dir') args.reportDir = next();
    else if (a === '--confirm-remote') args.confirmRemote = true;
    else if (a === '--help' || a === '-h') args.help = true;
    else throw new Error(`unknown argument: ${a}`);
  }
  return args;
}

function printHelp() {
  console.log(`OxSteed scale harness (V2-P1-05)

Usage: node scripts/scale/harness.cjs --target URL [options]

  --target URL            Base URL of the target (required)
  --scenarios a,b         Scenario ids (default: all)
  --profile NAME          smoke | load | soak | spike (default: load)
  --vus N                 Virtual users (overrides profile)
  --duration 5m           Hold duration (overrides profile); or --iterations N
  --ramp-up 30s           Ramp-up time (overrides profile)
  --think-scale F         Multiply all think times by F (default 1)
  --seed N                Deterministic run seed (default 42)
  --user-token TOK        Bearer token for auth=user steps (or OXSTEED_SCALE_USER_TOKEN)
  --admin-token TOK       Bearer token for auth=admin steps (or OXSTEED_SCALE_ADMIN_TOKEN)
  --include-ai            Opt in to AI-spending steps (default: skipped)
  --region-latency MODE   none | model | "us-east=25,africa=190" (default none)
  --timeout MS            Per-request timeout (default 15000)
  --report-dir DIR        Report output directory (default scale-reports)
  --confirm-remote        Required when the target is not localhost

Safety: non-local targets are refused without --confirm-remote. Auth-gated
steps are skipped (counted) when no token is supplied.`);
}

function isLocalTarget(target) {
  try {
    const host = new URL(target).hostname.toLowerCase();
    return (
      host === 'localhost'
      || host === '127.0.0.1'
      || host === '::1'
      || host.endsWith('.test')
      || host.endsWith('.local')
      || host.endsWith('.example')
    );
  } catch {
    return false;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function pickWeighted(rand, scenarios) {
  const total = scenarios.reduce((acc, s) => acc + s.weight, 0);
  let r = rand() * total;
  for (const s of scenarios) {
    r -= s.weight;
    if (r <= 0) return s;
  }
  return scenarios[scenarios.length - 1];
}

function buildStages(args) {
  if (args.iterations) return [{ durationMs: Infinity, target: args.vus || PROFILES[args.profile]?.vus || 50, iterations: args.iterations }];
  const profile = PROFILES[args.profile];
  if (!profile) throw new Error(`unknown profile: ${args.profile}`);
  if (profile.stages) {
    return profile.stages.map((s) => ({ durationMs: parseDuration(s.duration), target: s.target }));
  }
  const vus = args.vus || profile.vus;
  const durationMs = parseDuration(args.duration || profile.duration);
  const rampUpMs = parseDuration(args.rampUp || profile.rampUp);
  return [
    { durationMs: rampUpMs, target: vus, rampFrom: 0 },
    { durationMs, target: vus },
    { durationMs: Math.min(30000, Math.max(5000, rampUpMs)), target: 0, rampFrom: vus },
  ];
}

function resolveRegionLatency(mode) {
  if (!mode || mode === 'none') return null;
  if (mode === 'model') {
    return Object.fromEntries(SCALE_MODEL.regions.map((r) => [r.id, r.baseRttMs]));
  }
  const map = {};
  for (const pair of String(mode).split(',')) {
    const [id, ms] = pair.split('=').map((s) => s.trim());
    if (!id || Number.isNaN(Number(ms))) throw new Error(`invalid --region-latency entry: ${pair}`);
    map[id] = Number(ms);
  }
  return map;
}

async function runStep(ctx, scenario, step, vu) {
  const { stats, http, tokens, options } = ctx;
  const record = (sample) => stats.record(scenario.id, step.name, sample);

  if (step.requiresAi && !options.includeAi) {
    record({ skipped: true });
    return;
  }
  if (step.auth === 'user' && !tokens.user) {
    record({ skipped: true });
    return;
  }
  if (step.auth === 'admin' && !tokens.admin) {
    record({ skipped: true });
    return;
  }

  const headers = {};
  if (step.auth === 'user') headers.authorization = `Bearer ${tokens.user}`;
  if (step.auth === 'admin') headers.authorization = `Bearer ${tokens.admin}`;

  // Simulated regional latency: applied client-side before the request so
  // user-perceived p95 includes the region RTT on top of server time.
  if (vu.regionLatencyMs) await sleep(vu.regionLatencyMs);

  if (step.method === 'ws') {
    const holdRange = step.ws.holdMs;
    const holdMs = (Array.isArray(holdRange)
      ? holdRange[0] + vu.rand() * (holdRange[1] - holdRange[0])
      : holdRange) * options.thinkScale;
    try {
      const handle = await connectWs(`${options.target}${step.path}`, {
        namespace: step.ws.namespace || '/',
        auth: step.auth === 'user' ? { token: tokens.user } : step.auth === 'admin' ? { token: tokens.admin } : null,
        timeoutMs: step.timeoutMs || options.timeout,
        onEvent: () => {},
      });
      await sleep(holdMs);
      const { pings, events } = handle.stats;
      const latencyMs = handle.stats.connectLatencyMs;
      handle.close();
      record({ latencyMs, status: 101, ok: true, failure: false, bytes: pings + events });
    } catch (err) {
      record({ latencyMs: options.timeout, status: 0, ok: false, failure: true, errorKind: 'ws-error', bytes: 0 });
    }
    return;
  }

  const path = typeof step.path === 'function' ? step.path(vu) : step.path;
  const url = `${options.target}${path}`;
  let body;
  let extraHeaders = {};
  if (step.multipart) {
    const mp = buildMultipart(step.multipart);
    body = mp.body;
    extraHeaders = mp.headers;
  } else if (step.body !== undefined) {
    body = typeof step.body === 'function' ? step.body(vu) : step.body;
  }
  const timeout = step.timeoutMs || options.timeout;
  const res = await http.request({ method: step.method, url, headers: { ...extraHeaders, ...headers }, body, timeout });
  const failure = res.status >= 500 || (res.errorKind !== undefined && res.status === 0);
  const ok = !failure && step.expect.includes(res.status);
  record({ latencyMs: res.latencyMs, status: res.status, ok, failure, bytes: res.bytes, errorKind: res.errorKind });

  const think = step.thinkMs
    ? (step.thinkMs[0] + vu.rand() * (step.thinkMs[1] - step.thinkMs[0])) * options.thinkScale
    : 0;
  if (think > 0) await sleep(think);
}

async function vuLoop(ctx, vuIndex, state) {
  const vu = {
    index: vuIndex,
    rand: mulberry32(ctx.options.seed + vuIndex * 7919),
    pick: (list) => list[Math.floor(vu.rand() * list.length)],
    int: (min, max) => min + Math.floor(vu.rand() * (max - min + 1)),
    region: null,
    regionLatencyMs: 0,
  };
  if (ctx.regionLatency) {
    const region = pickWeighted(vu.rand, SCALE_MODEL.regions);
    vu.region = region.id;
    vu.regionLatencyMs = ctx.regionLatency[region.id] || 0;
  }
  try {
    for (;;) {
      if (state.stopping || vu.index >= state.currentTarget) return;
      if (state.iterationsLeft !== null) {
        if (state.iterationsLeft <= 0) return;
        state.iterationsLeft -= 1;
      }
      const scenario = pickWeighted(vu.rand, ctx.scenarios);
      for (const step of scenario.steps) {
        if (state.stopping || vu.index >= state.currentTarget) return;
        await runStep(ctx, scenario, step, vu);
      }
      // Yield to the event loop once per iteration. A scenario whose steps
      // are all skipped performs no real async work, and without this yield
      // the loop becomes an infinite microtask chain that starves timers.
      await sleep(0);
    }
  } finally {
    state.active.delete(vuIndex);
  }
}

async function main(argv) {
  const args = parseArgs(argv);
  if (args.help) {
    printHelp();
    return { exitCode: 0 };
  }

  const scenarioErrors = validateScenarios();
  if (scenarioErrors.length) throw new Error(`scenario catalog invalid:\n- ${scenarioErrors.join('\n- ')}`);

  if (!args.target) throw new Error('--target is required (e.g. --target http://localhost:5000)');
  let target;
  try {
    target = new URL(args.target).toString().replace(/\/$/, '');
  } catch {
    throw new Error(`invalid --target: ${args.target}`);
  }
  const remote = !isLocalTarget(target);
  if (remote && !args.confirmRemote) {
    throw new Error(`refusing remote target ${target} without --confirm-remote (load runs against real infrastructure are an operator step)`);
  }

  let scenarios = SCENARIOS;
  if (args.scenarios) {
    const wanted = new Set(args.scenarios);
    scenarios = SCENARIOS.filter((s) => wanted.has(s.id));
    const missing = [...wanted].filter((id) => !SCENARIOS.some((s) => s.id === id));
    if (missing.length) throw new Error(`unknown scenarios: ${missing.join(', ')}`);
    if (!scenarios.length) throw new Error('no scenarios selected');
  }

  const stages = buildStages(args);
  const regionLatency = resolveRegionLatency(args.regionLatency);
  const options = {
    target,
    thinkScale: args.thinkScale,
    seed: args.seed,
    includeAi: args.includeAi,
    timeout: args.timeout,
  };
  const tokens = { user: args.userToken, admin: args.adminToken };
  const stats = new StatsCollector();
  const http = createHttpClient({ timeoutMs: args.timeout });
  const ctx = { stats, http, tokens, options, scenarios, regionLatency };

  console.log('OxSteed scale harness (V2-P1-05)');
  console.log(`target: ${target}${remote ? ' (REMOTE: --confirm-remote accepted)' : ' (local)'}`);
  console.log(`scenarios: ${scenarios.map((s) => s.id).join(', ')}`);
  console.log(`stages: ${stages.map((s) => `${Math.round(s.durationMs / 1000)}s@${s.target}`).join(' -> ')}`);
  console.log(`seed=${args.seed} includeAi=${args.includeAi} regionLatency=${args.regionLatency}`);
  console.log(`auth: user=${tokens.user ? 'supplied' : 'missing (steps skipped)'} admin=${tokens.admin ? 'supplied' : 'missing (steps skipped)'}`);
  console.log('');

  const state = { stopping: false, currentTarget: 0, active: new Set(), iterationsLeft: stages[0].iterations ?? null };
  let vuCounter = 0;
  const spawnVu = () => {
    const index = vuCounter++;
    state.active.add(index);
    vuLoop(ctx, index, state).catch((err) => {
      console.error(`VU ${index} crashed: ${err.message}`);
      state.active.delete(index);
    });
  };

  process.on('SIGINT', () => {
    console.log('\nSIGINT received, stopping after current iterations...');
    state.stopping = true;
  });

  const startedAt = Date.now();
  for (const stage of stages) {
    if (state.stopping) break;
    if (stage.iterations != null) {
      state.currentTarget = stage.target;
      while (state.active.size < stage.target) spawnVu();
      while (!state.stopping && state.iterationsLeft > 0) await sleep(250);
      break;
    }
    const stageStart = Date.now();
    const from = stage.rampFrom !== undefined ? stage.rampFrom : state.currentTarget;
    const to = stage.target;
    while (!state.stopping && Date.now() - stageStart < stage.durationMs) {
      const progress = Math.min((Date.now() - stageStart) / Math.max(stage.durationMs, 1), 1);
      state.currentTarget = Math.round(from + (to - from) * progress);
      while (state.active.size < state.currentTarget) spawnVu();
      await sleep(250);
    }
    state.currentTarget = state.stopping ? state.currentTarget : to;
  }
  state.currentTarget = 0;
  while (state.active.size > 0) await sleep(250);
  http.close();

  const snapshot = stats.snapshot();
  const built = buildReport({
    runMeta: {
      target,
      profile: args.profile,
      vus: Math.max(...stages.map((s) => s.target), 0),
      duration: args.iterations ? `${args.iterations} iterations` : `${Math.round((Date.now() - startedAt) / 1000)}s`,
      scenarios: scenarios.map((s) => s.id),
      seed: args.seed,
      includeAi: args.includeAi,
      regionLatency: args.regionLatency,
      userToken: Boolean(tokens.user),
      adminToken: Boolean(tokens.admin),
    },
    snapshot,
  });
  const { jsonPath, mdPath } = writeReport(args.reportDir, built);

  const g = snapshot.global;
  console.log('');
  console.log(`requests=${g.requests} failures=${g.failures} clientErrors=${g.clientErrors} skipped=${g.skipped}`);
  console.log(`p50=${g.p50}ms p95=${g.p95}ms p99=${g.p99}ms`);
  console.log(`SLO verdict: ${built.report.sloSummary.pass ? 'PASS' : 'FAIL'}`);
  console.log(`report: ${jsonPath}`);
  console.log(`report: ${mdPath}`);
  return { exitCode: built.report.sloSummary.pass ? 0 : 2, report: built.report };
}

if (require.main === module) {
  main(process.argv.slice(2)).then(
    ({ exitCode }) => process.exit(exitCode),
    (err) => {
      console.error(`harness error: ${err.message}`);
      process.exit(1);
    },
  );
}

module.exports = { main, parseArgs, parseDuration, buildStages, isLocalTarget, PROFILES };
