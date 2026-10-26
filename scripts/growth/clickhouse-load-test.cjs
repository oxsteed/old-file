#!/usr/bin/env node
"use strict";
// D-ENG-08: sustained-insert load test for growth.activity_events.
// Usage: node scripts/growth/clickhouse-load-test.cjs --url=http://ch:8123 \
//   [--eps=5000] [--seconds=60] [--batch=500] [--concurrency=8] [--p99-ms=1000]
//   [--table=growth.activity_events] [--keep] [--allow-production] [--json]
// Writes only synthetic, internal-flagged rows with a marker event name and
// deletes them afterwards unless --keep. Exit code 1 when targets are missed.
const lib = require("./loadDrillLib.cjs");
const { ch } = require("./chHttp.cjs");

function args(argv) {
  const o = {};
  for (const a of argv) { const m = /^--([\w-]+)(?:=(.*))?$/.exec(a); if (m) o[m[1]] = m[2] ?? true; }
  return o;
}

async function run(opts) {
  const url = opts.url || process.env.CLICKHOUSE_URL;
  if (!url) throw new Error("--url or CLICKHOUSE_URL is required");
  lib.assertSafeTarget(url, { allowProduction: Boolean(opts["allow-production"]) });
  const table = opts.table || "growth.activity_events";
  if (!/^[a-z_][\w]*\.[a-z_][\w]*$/i.test(table)) throw new Error("invalid table name");
  const eps = Number(opts.eps || 5000), seconds = Number(opts.seconds || 60);
  const plan = lib.schedule({ eventsPerSecond: eps, durationSeconds: seconds, batchSize: Number(opts.batch || 500) });
  const concurrency = Math.max(1, Number(opts.concurrency || 8));
  const runId = `load-${Date.now().toString(36)}`;
  const latencies = [];
  let sent = 0, errors = 0, next = 0, inFlight = 0;
  const started = Date.now();
  await new Promise((resolve) => {
    const tick = () => {
      while (next < plan.batches && inFlight < concurrency && Date.now() - started >= next * plan.intervalMs) {
        const n = Math.min(plan.batchSize, plan.total - next * plan.batchSize);
        next += 1; inFlight += 1;
        const body = Array.from({ length: n }, () => JSON.stringify(lib.syntheticRow(runId))).join("\n");
        const t0 = Date.now();
        ch(url, `INSERT INTO ${table} FORMAT JSONEachRow`, { body })
          .then(() => { sent += n; latencies.push(Date.now() - t0); })
          .catch(() => { errors += 1; })
          .finally(() => { inFlight -= 1; if (next >= plan.batches && inFlight === 0) resolve(); });
      }
      if (next < plan.batches) setTimeout(tick, 2);
    };
    tick();
  });
  const elapsed = (Date.now() - started) / 1000;
  const counted = Number(await ch(url, `SELECT count() FROM ${table} WHERE event_name='${lib.MARKER_EVENT}' AND session_key='${runId}'`));
  if (!opts.keep) await ch(url, `ALTER TABLE ${table} DELETE WHERE event_name='${lib.MARKER_EVENT}' AND session_key='${runId}'`).catch(() => {});
  const result = { runId, target_eps: eps, seconds, sent, errors, elapsed, achievedEps: sent / elapsed, latency: lib.summarize(latencies), counted };
  return { ...result, ...lib.evaluate(result, { eventsPerSecond: eps, p99Ms: Number(opts["p99-ms"] || 1000) }) };
}

if (require.main === module) {
  run(args(process.argv.slice(2))).then((r) => {
    console.log(JSON.stringify(r, null, 2));
    process.exitCode = r.pass ? 0 : 1;
  }).catch((e) => { console.error(e.message); process.exitCode = 2; });
}
module.exports = { run, args };
