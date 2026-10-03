'use strict';

/**
 * Service-level objectives for the V2-P1-05 scale scenarios.
 *
 * Budgets apply to harness runs against a staging or staging-like target.
 * A "failure" for error-budget purposes is a 5xx, a timeout, or a
 * connection error. Other 4xx responses are tracked separately as client
 * responses (expected when the target database has no fixture data; see
 * fixtures.cjs). SLO evaluation never touches production and never claims
 * a passing run proves 6M-user capacity; see scaleModel.cjs.
 */

const SLOS = {
  'browse-discover':   { p50Ms: 400,  p95Ms: 1200, p99Ms: 2500, errorBudgetPct: 1.0, owner: 'platform',   runbook: 'RUNBOOK.md#performance' },
  'search-pressure':   { p50Ms: 600,  p95Ms: 1800, p99Ms: 4000, errorBudgetPct: 1.0, owner: 'platform',   runbook: 'RUNBOOK.md#performance' },
  messaging:           { p50Ms: 500,  p95Ms: 1500, p99Ms: 3000, errorBudgetPct: 1.0, owner: 'platform',   runbook: 'RUNBOOK.md#performance' },
  'booking-flow':      { p50Ms: 700,  p95Ms: 2000, p99Ms: 4000, errorBudgetPct: 0.5, owner: 'platform',   runbook: 'RUNBOOK.md#performance' },
  'support-journey':   { p50Ms: 700,  p95Ms: 2000, p99Ms: 4000, errorBudgetPct: 1.0, owner: 'support',    runbook: 'RUNBOOK.md#support' },
  'food-ordering':     { p50Ms: 600,  p95Ms: 1800, p99Ms: 3500, errorBudgetPct: 1.0, owner: 'food',       runbook: 'RUNBOOK.md#food' },
  'delivery-tracking': { p50Ms: 300,  p95Ms: 900,  p99Ms: 2000, errorBudgetPct: 1.0, owner: 'logistics',  runbook: 'RUNBOOK.md#logistics' },
  'wallet-credit':     { p50Ms: 700,  p95Ms: 2500, p99Ms: 5000, errorBudgetPct: 0.5, owner: 'credit',     runbook: 'docs/oxsteed-credit-code-completion-goal.md' },
  payments:            { p50Ms: 800,  p95Ms: 2500, p99Ms: 5000, errorBudgetPct: 0.5, owner: 'payments',   runbook: 'RUNBOOK.md#payments' },
  'websocket-fanout':  { p50Ms: 800,  p95Ms: 2500, p99Ms: 5000, errorBudgetPct: 1.0, owner: 'realtime',   runbook: 'RUNBOOK.md#realtime' },
  uploads:             { p50Ms: 1500, p95Ms: 5000, p99Ms: 10000, errorBudgetPct: 1.0, owner: 'platform',  runbook: 'RUNBOOK.md#uploads' },
  exports:             { p50Ms: 4000, p95Ms: 15000, p99Ms: 30000, errorBudgetPct: 2.0, owner: 'platform',  runbook: 'RUNBOOK.md#exports' },
  'admin-ops':         { p50Ms: 600,  p95Ms: 2000, p99Ms: 4000, errorBudgetPct: 1.0, owner: 'operations', runbook: 'RUNBOOK.md#admin' },
  'ops-liveness':      { p50Ms: 150,  p95Ms: 500,  p99Ms: 1000, errorBudgetPct: 0.1, owner: 'platform',   runbook: 'RUNBOOK.md#liveness' },
};

const GLOBAL_SLO = { p99Ms: 10000, errorBudgetPct: 0.5, owner: 'platform', runbook: 'RUNBOOK.md' };

function getSlo(scenarioId) {
  return SLOS[scenarioId] || null;
}

/**
 * Evaluate one scenario aggregate against its SLO.
 * aggregate: { requests, failures, clientErrors, timeouts, p50, p95, p99 }
 * Returns { pass, checks: [{ name, pass, actual, budget }] }.
 */
function evaluateSlo(scenarioId, aggregate) {
  const slo = getSlo(scenarioId);
  if (!slo) return { pass: true, checks: [], note: 'no SLO defined' };
  if (!aggregate || aggregate.requests === 0) {
    return { pass: true, checks: [], note: 'no requests recorded (all steps skipped)' };
  }
  const errorPct = (aggregate.failures / aggregate.requests) * 100;
  const checks = [
    { name: 'p50 latency', pass: aggregate.p50 <= slo.p50Ms, actual: aggregate.p50, budget: slo.p50Ms, unit: 'ms' },
    { name: 'p95 latency', pass: aggregate.p95 <= slo.p95Ms, actual: aggregate.p95, budget: slo.p95Ms, unit: 'ms' },
    { name: 'p99 latency', pass: aggregate.p99 <= slo.p99Ms, actual: aggregate.p99, budget: slo.p99Ms, unit: 'ms' },
    { name: 'error budget', pass: errorPct <= slo.errorBudgetPct, actual: Math.round(errorPct * 100) / 100, budget: slo.errorBudgetPct, unit: '%' },
  ];
  return { pass: checks.every((c) => c.pass), checks, owner: slo.owner, runbook: slo.runbook };
}

function evaluateGlobal(aggregate) {
  if (!aggregate || aggregate.requests === 0) return { pass: true, checks: [], note: 'no requests recorded' };
  const errorPct = (aggregate.failures / aggregate.requests) * 100;
  const checks = [
    { name: 'global p99 latency', pass: aggregate.p99 <= GLOBAL_SLO.p99Ms, actual: aggregate.p99, budget: GLOBAL_SLO.p99Ms, unit: 'ms' },
    { name: 'global error budget', pass: errorPct <= GLOBAL_SLO.errorBudgetPct, actual: Math.round(errorPct * 100) / 100, budget: GLOBAL_SLO.errorBudgetPct, unit: '%' },
  ];
  return { pass: checks.every((c) => c.pass), checks, owner: GLOBAL_SLO.owner, runbook: GLOBAL_SLO.runbook };
}

module.exports = { SLOS, GLOBAL_SLO, getSlo, evaluateSlo, evaluateGlobal };
