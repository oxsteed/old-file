'use strict';

/**
 * Report writer for the scale harness: machine-readable JSON plus a
 * human-readable Markdown summary with the SLO table, per-scenario stats,
 * the extrapolation math, and an honest statement of what the run proves.
 */

const fs = require('fs');
const path = require('path');
const { evaluateSlo, evaluateGlobal } = require('./slos.cjs');
const { deriveLoad, sliceCoverage } = require('./scaleModel.cjs');

function fmt(n) {
  return typeof n === 'number' ? String(n) : n;
}

function scenarioTable(scenarios, sloResults) {
  const lines = [
    '| Scenario | Requests | Failures | Client 4xx | Skipped | p50 | p95 | p99 | Error % | SLO |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |',
  ];
  for (const [id, s] of Object.entries(scenarios)) {
    const errPct = s.requests ? ((s.failures / s.requests) * 100).toFixed(2) : '0.00';
    const slo = sloResults[id];
    const sloMark = !slo ? 'n/a' : (slo.note ? 'n/a' : (slo.pass ? 'PASS' : 'FAIL'));
    lines.push(`| ${id} | ${s.requests} | ${s.failures} | ${s.clientErrors} | ${s.skipped} | ${fmt(s.p50)} | ${fmt(s.p95)} | ${fmt(s.p99)} | ${errPct} | ${sloMark} |`);
  }
  return lines.join('\n');
}

function stepTable(steps) {
  const lines = [
    '| Step | Requests | Failures | p50 | p95 | p99 | Statuses |',
    '| --- | ---: | ---: | ---: | ---: | ---: | --- |',
  ];
  for (const [id, s] of Object.entries(steps)) {
    const statuses = Object.entries(s.statusCounts).map(([code, n]) => `${code}x${n}`).join(', ') || 'none';
    const errors = Object.entries(s.errorKinds).map(([kind, n]) => `${kind}x${n}`).join(', ');
    const statusCell = errors ? `${statuses} (${errors})` : statuses;
    lines.push(`| ${id} | ${s.requests} | ${s.failures} | ${fmt(s.p50)} | ${fmt(s.p95)} | ${fmt(s.p99)} | ${statusCell} |`);
  }
  return lines.join('\n');
}

function buildReport({ runMeta, snapshot }) {
  const load = deriveLoad();
  const coverage = sliceCoverage(runMeta.vus);
  const sloResults = {};
  for (const [id, agg] of Object.entries(snapshot.scenarios)) {
    sloResults[id] = evaluateSlo(id, agg);
  }
  const globalSlo = evaluateGlobal(snapshot.global);
  const allPass = Object.values(sloResults).every((r) => r.pass) && globalSlo.pass;

  const elapsedSec = Math.max(snapshot.elapsedMs / 1000, 0.001);
  const rps = snapshot.global.requests / elapsedSec;

  const report = {
    generatedAt: new Date().toISOString(),
    tool: 'oxsteed-scale-harness',
    run: runMeta,
    model: {
      totalUsers: 6_000_000,
      totalStaff: 3_500,
      peakConcurrentSessions: load.peakConcurrentSessions,
      peakRequestsPerSecond: load.peakRequestsPerSecond,
    },
    coverage: {
      vus: runMeta.vus,
      coverageFraction: coverage.coverageFraction,
      extrapolationFactor: coverage.extrapolationFactor,
      note: 'Linear extrapolation is a planning input, not proof of 6M-user capacity.',
    },
    throughput: {
      elapsedSec: Math.round(elapsedSec * 10) / 10,
      requests: snapshot.global.requests,
      requestsPerSecond: Math.round(rps * 10) / 10,
      bytes: snapshot.global.bytes,
    },
    global: snapshot.global,
    globalSlo: { pass: globalSlo.pass, checks: globalSlo.checks },
    scenarios: snapshot.scenarios,
    scenarioSlos: Object.fromEntries(
      Object.entries(sloResults).map(([id, r]) => [id, { pass: r.pass, checks: r.checks, note: r.note, owner: r.owner, runbook: r.runbook }]),
    ),
    steps: snapshot.steps,
    sloSummary: { pass: allPass },
  };

  const failedSlos = Object.entries(sloResults).filter(([, r]) => !r.pass);
  const md = [
    '# OxSteed scale harness report',
    '',
    `- Generated: ${report.generatedAt}`,
    `- Target: ${runMeta.target}`,
    `- Profile: ${runMeta.profile || 'custom'} | VUs: ${runMeta.vus} | Duration: ${runMeta.duration}`,
    `- Scenarios: ${(runMeta.scenarios || []).join(', ')}`,
    `- Seed: ${runMeta.seed} | Include AI: ${runMeta.includeAi ? 'yes' : 'no'} | Region latency: ${runMeta.regionLatency || 'none'}`,
    '',
    '## Verdict',
    '',
    allPass
      ? '**PASS**: every scenario SLO and the global SLO held for this run.'
      : `**FAIL**: ${failedSlos.length} scenario SLO(s) breached${globalSlo.pass ? '' : ' plus the global SLO'}.`,
    ...(!allPass && failedSlos.length
      ? ['', 'Breached SLOs:', ...failedSlos.map(([id, r]) => `- ${id}: ${r.checks.filter((c) => !c.pass).map((c) => `${c.name} actual ${c.actual}${c.unit} over budget ${c.budget}${c.unit}`).join('; ')} (owner: ${r.owner}, runbook: ${r.runbook})`)]
      : []),
    ...(!globalSlo.pass ? ['', `Global SLO breached: ${globalSlo.checks.filter((c) => !c.pass).map((c) => `${c.name} actual ${c.actual}${c.unit} over budget ${c.budget}${c.unit}`).join('; ')}`] : []),
    '',
    '## Throughput',
    '',
    `- Elapsed: ${report.throughput.elapsedSec}s | Requests: ${report.throughput.requests} | ${report.throughput.requestsPerSecond} req/s | ${report.throughput.bytes} bytes received`,
    '',
    '## Scenarios',
    '',
    scenarioTable(snapshot.scenarios, sloResults),
    '',
    '## Steps',
    '',
    stepTable(snapshot.steps),
    '',
    '## Scale model and extrapolation',
    '',
    `- Modeled base: 6,000,000 users, 3,500 staff`,
    `- Derived peak: ${load.peakConcurrentSessions.toLocaleString('en-US')} concurrent sessions, ~${load.peakRequestsPerSecond.toLocaleString('en-US')} req/s`,
    `- This run: ${runMeta.vus} VUs = ${(coverage.coverageFraction * 100).toFixed(4)}% of modeled peak (extrapolation factor ${coverage.extrapolationFactor.toFixed(1)}x)`,
    `- ${report.coverage.note}`,
    '',
    '## What this run proves (and does not prove)',
    '',
    '- Proves: the target served this slice of modeled traffic within the stated SLOs for the duration of the run.',
    '- Does not prove: behavior at full 6M-user concurrency, multi-region latency under real networks, provider quota exhaustion, or failover. Those need the staged live runs in the operator runbook.',
    '',
    'Skipped steps are expected when no user/admin token is supplied; they are counted, never failed.',
    '',
  ].join('\n');

  return { report, markdown: md };
}

function writeReport(reportDir, built) {
  fs.mkdirSync(reportDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const jsonPath = path.join(reportDir, `scale-report-${stamp}.json`);
  const mdPath = path.join(reportDir, `scale-report-${stamp}.md`);
  fs.writeFileSync(jsonPath, `${JSON.stringify(built.report, null, 2)}\n`);
  fs.writeFileSync(mdPath, built.markdown);
  return { jsonPath, mdPath };
}

module.exports = { buildReport, writeReport };
