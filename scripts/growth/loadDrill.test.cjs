"use strict";
const test = require("node:test");
const assert = require("node:assert");
const lib = require("./loadDrillLib.cjs");
const drill = require("./replica-kill-drill.cjs");

test("schedule spreads 5k ev/s into even batches", () => {
  const s = lib.schedule({ eventsPerSecond: 5000, durationSeconds: 60, batchSize: 500 });
  assert.deepStrictEqual(s, { total: 300000, batches: 600, batchSize: 500, intervalMs: 100 });
  assert.throws(() => lib.schedule({ eventsPerSecond: 0, durationSeconds: 1, batchSize: 1 }));
});
test("percentiles", () => {
  const r = lib.summarize([5, 1, 3, 2, 4, 100, 6, 7, 8, 9]);
  assert.strictEqual(r.p50, 5); assert.strictEqual(r.p99, 100); assert.strictEqual(r.max, 100);
  assert.strictEqual(lib.summarize([]).p50, null);
});
test("synthetic rows are internal, marked and carry no personal data", () => {
  const row = lib.syntheticRow("load-x", Date.UTC(2026, 9, 26));
  assert.strictEqual(row.is_internal, true);
  assert.strictEqual(row.event_name, lib.MARKER_EVENT);
  assert.strictEqual(row.day, "2026-10-26");
  assert.match(row.subject_key, /^[a-f0-9]{64}$/);
  assert.strictEqual(row.country, ""); assert.strictEqual(row.props, "{}");
});
test("refuses production-looking hosts without explicit flag", () => {
  assert.throws(() => lib.assertSafeTarget("https://ch.prod.example:8443"), /production/);
  assert.throws(() => lib.assertSafeTarget("https://production-ch.example"), /production/);
  assert.strictEqual(lib.assertSafeTarget("https://ch.prod.example", { allowProduction: true }), "ch.prod.example");
  assert.strictEqual(lib.assertSafeTarget("http://127.0.0.1:8123"), "127.0.0.1");
  assert.throws(() => lib.assertSafeTarget("nope"));
});
test("evaluate flags misses", () => {
  const ok = { errors: 0, achievedEps: 4990, latency: { p99: 300 }, counted: 10, sent: 10 };
  assert.strictEqual(lib.evaluate(ok, { eventsPerSecond: 5000, p99Ms: 1000 }).pass, true);
  const bad = lib.evaluate({ ...ok, errors: 2, achievedEps: 3000, latency: { p99: 2000 }, counted: 9 }, { eventsPerSecond: 5000, p99Ms: 1000 });
  assert.strictEqual(bad.failures.length, 4);
});
test("drill plan validates and dry run never executes commands", async () => {
  assert.throws(() => lib.drillPlan({ replicas: ["a"], victim: "a", stopCmd: "x", startCmd: "y" }));
  assert.throws(() => lib.drillPlan({ replicas: ["a", "b"], victim: "c", stopCmd: "x", startCmd: "y" }));
  const r = await drill.run({ replicas: "http://a:8123,http://b:8123", victim: "http://b:8123", "stop-cmd": "false", "start-cmd": "false" });
  assert.strictEqual(r.dryRun, true);
  assert.deepStrictEqual(r.plan.map((s) => s.step), ["baseline", "stop", "write", "read", "start", "catch_up", "cleanup"]);
});
