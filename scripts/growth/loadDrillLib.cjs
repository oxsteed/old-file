"use strict";
// Shared, side-effect-free helpers for the growth ClickHouse load test and
// replica-kill drill (D-ENG-08). Network/process work lives in the CLIs.
const crypto = require("crypto");

const MARKER_EVENT = "loadtest.synthetic";

function percentile(sorted, p) {
  if (!sorted.length) return null;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

function summarize(latenciesMs) {
  const s = [...latenciesMs].sort((a, b) => a - b);
  return { count: s.length, p50: percentile(s, 50), p95: percentile(s, 95), p99: percentile(s, 99), max: s.length ? s[s.length - 1] : null };
}

// Plan of batches for a target rate: rows per batch and ms between batch
// starts so rate * duration rows are sent evenly.
function schedule({ eventsPerSecond, durationSeconds, batchSize }) {
  if (!(eventsPerSecond > 0) || !(durationSeconds > 0) || !(batchSize > 0)) throw new Error("rate, duration and batch size must be positive");
  const total = Math.round(eventsPerSecond * durationSeconds);
  const batches = Math.ceil(total / batchSize);
  return { total, batches, batchSize, intervalMs: (batchSize / eventsPerSecond) * 1000 };
}

// Synthetic rows only: random subject keys, internal flag set and a fixed
// marker event so the run can be measured and deleted afterwards.
function syntheticRow(runId, now = Date.now()) {
  const iso = new Date(now).toISOString();
  const ts = iso.replace("T", " ").replace("Z", "");
  return {
    day: iso.slice(0, 10), event_id: crypto.randomUUID(), occurred_at: ts, received_at: ts,
    event_name: MARKER_EVENT, schema_ver: 1, subject_key: crypto.randomBytes(32).toString("hex"),
    device_key: "", session_key: runId, role: "customer", surface: "web", app_version: "0.0.0-load",
    locale: "en", country: "", postal_ref: 0, jurisdiction: "", basis: "notice",
    route: "/loadtest", element_key: "", entity_type: "", entity_id: "", props: "{}",
    is_bot: false, is_internal: true,
  };
}

const PROD_HINT = /(^|[.-])(prod|production|live)([.-]|$)/i;
// Refuse production-looking hosts unless the operator says so explicitly.
function assertSafeTarget(url, { allowProduction = false } = {}) {
  let host;
  try { host = new URL(url).hostname; } catch { throw new Error("invalid ClickHouse URL"); }
  if (PROD_HINT.test(host) && !allowProduction) throw new Error(`refusing production-looking host ${host}; pass --allow-production after scheduling the run`);
  return host;
}

function evaluate(result, { eventsPerSecond, p99Ms }) {
  const failures = [];
  if (result.errors > 0) failures.push(`${result.errors} insert errors`);
  if (result.achievedEps < eventsPerSecond * 0.95) failures.push(`achieved ${result.achievedEps.toFixed(0)} ev/s < 95% of ${eventsPerSecond}`);
  if (result.latency.p99 != null && result.latency.p99 > p99Ms) failures.push(`insert p99 ${result.latency.p99}ms > ${p99Ms}ms`);
  if (result.counted != null && result.counted < result.sent) failures.push(`only ${result.counted}/${result.sent} rows readable`);
  return { pass: failures.length === 0, failures };
}

// Replica-kill drill steps; a dry run prints exactly this.
function drillPlan({ replicas, victim, stopCmd, startCmd, writeSeconds }) {
  if (!Array.isArray(replicas) || replicas.length < 2) throw new Error("at least two replica URLs are required");
  if (!replicas.includes(victim)) throw new Error("victim must be one of the replicas");
  if (!stopCmd || !startCmd) throw new Error("stop and start commands are required");
  const survivors = replicas.filter((r) => r !== victim);
  return [
    { step: "baseline", detail: "check every replica answers and replication queues are empty" },
    { step: "stop", detail: `run stop command for ${victim}`, command: stopCmd },
    { step: "write", detail: `write synthetic rows for ${writeSeconds}s through ${survivors[0]}` },
    { step: "read", detail: "confirm reads on survivors see every row" },
    { step: "start", detail: `run start command for ${victim}`, command: startCmd },
    { step: "catch_up", detail: `wait for ${victim} absolute_delay=0 and identical marker counts` },
    { step: "cleanup", detail: "delete marker rows unless --keep" },
  ];
}

module.exports = { MARKER_EVENT, percentile, summarize, schedule, syntheticRow, assertSafeTarget, evaluate, drillPlan };
