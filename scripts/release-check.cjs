'use strict';

/**
 * Release verification script.
 *
 * Hits the public readiness endpoints of a deployed OxSteed release and
 * reports whether the release is healthy:
 *   - /health            process liveness
 *   - /ready             dependency/worker/migration readiness (gates traffic)
 *   - /api/health/deep   database + Redis detail
 *
 * With --token <admin-bearer-token> (or OXSTEED_ADMIN_TOKEN), it also hits
 * the authenticated operational release gate:
 *   - /api/monitoring/release-gate
 *                        audit-chain integrity, backup freshness, webhook /
 *                        delivery failures, queue backlog, reconciliation
 *                        backlog. This is the gate /ready intentionally does
 *                        not cover.
 *
 * Usage:
 *   node scripts/release-check.cjs --base https://oxsteed.com
 *   node scripts/release-check.cjs --base https://oxsteed.com --token "$ADMIN_TOKEN"
 *   node scripts/release-check.cjs --base https://oxsteed.com --json
 *
 * Exit code 0 when every check passes, 1 otherwise. Without a token the
 * operational gate is reported as skipped, not passed.
 */

const CHECKS = [
  { name: 'liveness', path: '/health' },
  { name: 'readiness', path: '/ready' },
  { name: 'deep-health', path: '/api/health/deep' },
  { name: 'release-gate', path: '/api/monitoring/release-gate', auth: true },
];

function parseArgs(argv) {
  const args = { base: null, json: false, token: process.env.OXSTEED_ADMIN_TOKEN || null };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--base' && argv[i + 1]) args.base = argv[i + 1].replace(/\/+$/, '');
    if ((argv[i] === '--token' || argv[i] === '--admin-token') && argv[i + 1]) args.token = argv[i + 1];
    if (argv[i] === '--json') args.json = true;
  }
  if (!args.base) throw new Error('Pass --base <url>, e.g. --base https://oxsteed.com');
  let url;
  try { url = new URL(args.base); } catch { throw new Error('--base must be a valid URL'); }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('--base must be http(s)');
  return args;
}

async function fetchJson(fetchImpl, url, { timeoutMs = 15000, token = null } = {}) {
  const headers = { Accept: 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetchImpl(url, {
    headers,
    redirect: 'error',
    signal: AbortSignal.timeout(timeoutMs),
  });
  const body = await response.json().catch(() => ({}));
  return { statusCode: response.status, body };
}

function evaluateLiveness(result) {
  if (result.error) return { ok: false, detail: result.error };
  if (result.statusCode !== 200) return { ok: false, detail: `HTTP ${result.statusCode}` };
  if (result.body?.status !== 'ok') return { ok: false, detail: `status=${result.body?.status}` };
  return { ok: true, detail: `uptime ${result.body.uptimeSeconds ?? '?'}s` };
}

function evaluateReadiness(result) {
  if (result.error) return { ok: false, detail: result.error, subchecks: {} };
  if (result.statusCode !== 200) {
    const checks = result.body?.checks ?? {};
    const failing = Object.entries(checks)
      .filter(([, v]) => v && typeof v === 'object' && 'ok' in v && v.ok !== true)
      .map(([k]) => k);
    const where = failing.length > 0 ? `; failing: ${failing.join(', ')}` : '';
    return { ok: false, detail: `HTTP ${result.statusCode} (not ready)${where}`, subchecks: checks };
  }
  const checks = result.body?.checks ?? {};
  const failing = Object.entries(checks)
    .filter(([, v]) => v && typeof v === 'object' && 'ok' in v && v.ok !== true)
    .map(([k]) => k);
  if (result.body?.status !== 'ready' || failing.length > 0) {
    return { ok: false, detail: `failing: ${failing.join(', ') || result.body?.status}`, subchecks: checks };
  }
  return { ok: true, detail: `${Object.keys(checks).length} checks green`, subchecks: checks };
}

function evaluateDeepHealth(result) {
  if (result.error) return { ok: false, detail: result.error };
  if (result.statusCode !== 200) return { ok: false, detail: `HTTP ${result.statusCode}` };
  if (result.body?.status !== 'ok') return { ok: false, detail: `status=${result.body?.status}` };
  if (result.body?.checks?.database?.ok !== true) return { ok: false, detail: 'database check failed' };
  return { ok: true, detail: `db ok, redis ${result.body.checks?.redis?.ok ? 'ok' : 'optional/off'}` };
}

const EVALUATORS = { liveness: evaluateLiveness, readiness: evaluateReadiness, 'deep-health': evaluateDeepHealth };

function evaluateReleaseGate(result) {
  if (result.skipped) return { ok: true, skipped: true, detail: result.detail, signals: {} };
  if (result.error) return { ok: false, detail: result.error, signals: {} };
  const body = result.body && typeof result.body === 'object' ? result.body : null;
  // Fail closed: only an explicit pass/warn gate verdict counts. A 503 with
  // a gate body is how the server reports failing signals, so evaluate it.
  if (!body || !['pass', 'warn', 'fail'].includes(body.status)) {
    return { ok: false, detail: `HTTP ${result.statusCode} (gate unreachable)`, signals: {} };
  }
  const signals = body.signals ?? {};
  const failing = Object.entries(signals)
    .filter(([, s]) => s && s.status === 'fail')
    .map(([k, s]) => `${k}: ${s.detail}`);
  const warnings = Object.entries(signals)
    .filter(([, s]) => s && (s.status === 'warn' || s.status === 'unknown' || s.status === 'waived'))
    .map(([k, s]) => `${k} (${s.status}): ${s.detail}`);
  if (body.status === 'fail' || failing.length > 0) {
    return { ok: false, detail: failing.join('; ') || 'gate reported fail', signals, warnings };
  }
  return {
    ok: true,
    detail: warnings.length > 0 ? `pass with ${warnings.length} warning(s)` : 'all operational signals pass',
    signals,
    warnings,
  };
}

EVALUATORS['release-gate'] = evaluateReleaseGate;

async function releaseCheck({ base, token = null, fetchImpl = fetch, timeoutMs = 15000 } = {}) {
  const results = [];
  for (const { name, path, auth } of CHECKS) {
    if (auth && !token) {
      results.push({
        name,
        path,
        ...EVALUATORS[name]({ skipped: true, detail: 'no admin token: pass --token or set OXSTEED_ADMIN_TOKEN' }),
      });
      continue;
    }
    let fetched;
    try {
      fetched = await fetchJson(fetchImpl, `${base}${path}`, { timeoutMs, token: auth ? token : null });
    } catch (err) {
      fetched = { error: err.message };
    }
    const verdict = EVALUATORS[name](fetched);
    results.push({ name, path, ...verdict });
  }
  return { base, ok: results.every((r) => r.ok), checks: results, at: new Date().toISOString() };
}

function formatHuman(report) {
  const lines = [`release-check ${report.base} @ ${report.at}`];
  for (const c of report.checks) {
    const flag = c.skipped ? 'SKIP' : c.ok ? 'PASS' : 'FAIL';
    lines.push(`  [${flag}] ${c.name} (${c.path}): ${c.detail}`);
    if (c.subchecks) {
      for (const [k, v] of Object.entries(c.subchecks)) {
        const ok = !(v && typeof v === 'object' && 'ok' in v) || v.ok === true;
        lines.push(`         - ${k}: ${ok ? 'ok' : `NOT OK${v?.error ? ` (${v.error})` : ''}`}`);
      }
    }
    if (c.signals) {
      for (const [k, s] of Object.entries(c.signals)) {
        lines.push(`         - ${k}: ${s.status}${s.detail ? ` (${s.detail})` : ''}`);
      }
    }
    for (const w of c.warnings ?? []) {
      lines.push(`         ! ${w}`);
    }
  }
  lines.push(report.ok ? 'RESULT: healthy release' : 'RESULT: release unhealthy, do not route traffic');
  return lines.join('\n');
}

async function main(argv = process.argv.slice(2), deps = {}) {
  let args;
  try {
    args = parseArgs(argv);
  } catch (err) {
    console.error(`error: ${err.message}`);
    return 2;
  }
  const report = await releaseCheck({ base: args.base, token: args.token, fetchImpl: deps.fetchImpl });
  console.log(args.json ? JSON.stringify(report, null, 2) : formatHuman(report));
  return report.ok ? 0 : 1;
}

module.exports = { parseArgs, releaseCheck, formatHuman, main, CHECKS };

if (require.main === module) {
  main().then((code) => { process.exitCode = code; });
}
