#!/usr/bin/env node
"use strict";
// D-ENG-08: replica-kill drill for the growth ClickHouse cluster.
// Usage: node scripts/growth/replica-kill-drill.cjs \
//   --replicas=http://ch1:8123,http://ch2:8123 --victim=http://ch2:8123 \
//   --stop-cmd="docker stop ch2" --start-cmd="docker start ch2" \
//   [--write-seconds=60] [--eps=1000] [--catchup-timeout=600] [--execute] [--keep]
// Dry run by default: prints the plan. --execute runs the operator-supplied
// stop/start commands (never anything built from remote data).
const { execSync } = require("child_process");
const lib = require("./loadDrillLib.cjs");
const { ch } = require("./chHttp.cjs");
const { args } = require("./clickhouse-load-test.cjs");
const TABLE = "growth.activity_events";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function countOn(url, runId) {
  return Number(await ch(url, `SELECT count() FROM ${TABLE} WHERE event_name='${lib.MARKER_EVENT}' AND session_key='${runId}'`));
}
async function delayOn(url) {
  return Number(await ch(url, `SELECT max(absolute_delay) + max(queue_size) FROM system.replicas WHERE database='growth'`));
}

async function run(opts) {
  const replicas = String(opts.replicas || "").split(",").filter(Boolean);
  replicas.forEach((r) => lib.assertSafeTarget(r, { allowProduction: Boolean(opts["allow-production"]) }));
  const writeSeconds = Number(opts["write-seconds"] || 60);
  const plan = lib.drillPlan({ replicas, victim: opts.victim, stopCmd: opts["stop-cmd"], startCmd: opts["start-cmd"], writeSeconds });
  if (!opts.execute) return { dryRun: true, plan };
  const log = [];
  const survivor = replicas.find((r) => r !== opts.victim);
  for (const r of replicas) if ((await delayOn(r)) !== 0) throw new Error(`baseline: ${r} has replication lag`);
  log.push({ step: "baseline", ok: true });
  execSync(opts["stop-cmd"], { stdio: "inherit", shell: "/bin/sh" });
  const stoppedAt = Date.now();
  log.push({ step: "stop", ok: true });
  const load = await require("./clickhouse-load-test.cjs").run({ url: survivor, eps: opts.eps || 1000, seconds: writeSeconds, keep: true, table: TABLE, "allow-production": opts["allow-production"] });
  log.push({ step: "write", ok: load.errors === 0, sent: load.sent, errors: load.errors, p99: load.latency.p99 });
  for (const r of replicas.filter((x) => x !== opts.victim)) {
    const c = await countOn(r, load.runId);
    log.push({ step: "read", replica: r, ok: c === load.sent, count: c });
  }
  execSync(opts["start-cmd"], { stdio: "inherit", shell: "/bin/sh" });
  const deadline = Date.now() + Number(opts["catchup-timeout"] || 600) * 1000;
  let caught = false;
  while (Date.now() < deadline) {
    try {
      if ((await delayOn(opts.victim)) === 0 && (await countOn(opts.victim, load.runId)) === load.sent) { caught = true; break; }
    } catch { /* victim still starting */ }
    await sleep(2000);
  }
  log.push({ step: "catch_up", ok: caught, seconds_since_stop: Math.round((Date.now() - stoppedAt) / 1000) });
  if (!opts.keep) await ch(survivor, `ALTER TABLE ${TABLE} ON CLUSTER growth DELETE WHERE event_name='${lib.MARKER_EVENT}' AND session_key='${load.runId}'`).catch(() => {});
  return { dryRun: false, pass: log.every((s) => s.ok), log };
}

if (require.main === module) {
  run(args(process.argv.slice(2))).then((r) => {
    console.log(JSON.stringify(r, null, 2));
    process.exitCode = r.dryRun || r.pass ? 0 : 1;
  }).catch((e) => { console.error(e.message); process.exitCode = 2; });
}
module.exports = { run };
