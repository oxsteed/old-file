'use strict';

/**
 * Statistics collector for the scale harness.
 *
 * Keeps exact counters plus a bounded reservoir sample of latencies per
 * (scenario, step) bucket so long soak runs cannot grow memory without
 * bound. Percentiles are computed over the reservoir sample.
 */

const RESERVOIR_CAP = 4096;

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const rank = (p / 100) * (sorted.length - 1);
  const lower = Math.floor(rank);
  const upper = Math.ceil(rank);
  if (lower === upper) return sorted[lower];
  const frac = rank - lower;
  return sorted[lower] + (sorted[upper] - sorted[lower]) * frac;
}

class Bucket {
  constructor() {
    this.requests = 0;
    this.failures = 0; // 5xx, timeouts, connection errors
    this.clientErrors = 0; // other 4xx outside the expected set
    this.unexpectedStatus = 0; // status outside the step's expect list (non-4xx/5xx)
    this.skipped = 0;
    this.latencySum = 0;
    this.latencyMin = Infinity;
    this.latencyMax = 0;
    this.bytesSum = 0;
    this.sample = [];
    this.statusCounts = {};
    this.errorKinds = {};
  }

  record({ latencyMs, status, ok, failure, skipped, bytes, errorKind }) {
    if (skipped) {
      this.skipped += 1;
      return;
    }
    this.requests += 1;
    if (typeof status === 'number') {
      this.statusCounts[status] = (this.statusCounts[status] || 0) + 1;
    }
    if (errorKind) {
      this.errorKinds[errorKind] = (this.errorKinds[errorKind] || 0) + 1;
    }
    if (failure) this.failures += 1;
    else if (!ok) this.clientErrors += 1;
    if (typeof latencyMs === 'number') {
      this.latencySum += latencyMs;
      if (latencyMs < this.latencyMin) this.latencyMin = latencyMs;
      if (latencyMs > this.latencyMax) this.latencyMax = latencyMs;
      if (this.sample.length < RESERVOIR_CAP) {
        this.sample.push(latencyMs);
      } else {
        // Uniform reservoir replacement keeps the sample representative.
        const idx = Math.floor(Math.random() * this.sample.length);
        this.sample[idx] = latencyMs;
      }
    }
    if (typeof bytes === 'number') this.bytesSum += bytes;
  }

  snapshot() {
    const sorted = [...this.sample].sort((a, b) => a - b);
    const round = (n) => Math.round(n * 10) / 10;
    return {
      requests: this.requests,
      failures: this.failures,
      clientErrors: this.clientErrors,
      skipped: this.skipped,
      bytes: this.bytesSum,
      min: this.requests ? round(this.latencyMin) : 0,
      max: this.requests ? round(this.latencyMax) : 0,
      mean: this.requests ? round(this.latencySum / this.requests) : 0,
      p50: round(percentile(sorted, 50)),
      p95: round(percentile(sorted, 95)),
      p99: round(percentile(sorted, 99)),
      statusCounts: this.statusCounts,
      errorKinds: this.errorKinds,
    };
  }
}

class StatsCollector {
  constructor() {
    this.buckets = new Map(); // `${scenarioId}\n${stepName}` -> Bucket
    this.startedAt = Date.now();
  }

  key(scenarioId, stepName) {
    return `${scenarioId}\n${stepName}`;
  }

  record(scenarioId, stepName, sample) {
    const k = this.key(scenarioId, stepName);
    if (!this.buckets.has(k)) this.buckets.set(k, new Bucket());
    this.buckets.get(k).record(sample);
  }

  snapshot() {
    const perScenario = {};
    const perStep = {};
    const global = new Bucket();
    for (const [key, bucket] of this.buckets) {
      const [scenarioId, stepName] = key.split('\n');
      const snap = bucket.snapshot();
      perStep[`${scenarioId}/${stepName}`] = snap;
      if (!perScenario[scenarioId]) perScenario[scenarioId] = new Bucket();
      const target = perScenario[scenarioId];
      // Merge buckets without losing the reservoir: re-record samples.
      for (const latency of bucket.sample) {
        target.sample.push(latency);
        if (target.sample.length > RESERVOIR_CAP) {
          target.sample.splice(Math.floor(Math.random() * target.sample.length), 1);
        }
      }
      target.requests += bucket.requests;
      target.failures += bucket.failures;
      target.clientErrors += bucket.clientErrors;
      target.skipped += bucket.skipped;
      target.latencySum += bucket.latencySum;
      target.bytesSum += bucket.bytesSum;
      if (bucket.requests) {
        if (bucket.latencyMin < target.latencyMin) target.latencyMin = bucket.latencyMin;
        if (bucket.latencyMax > target.latencyMax) target.latencyMax = bucket.latencyMax;
      }
      for (const [status, count] of Object.entries(bucket.statusCounts)) {
        target.statusCounts[status] = (target.statusCounts[status] || 0) + count;
      }
      for (const [kind, count] of Object.entries(bucket.errorKinds)) {
        target.errorKinds[kind] = (target.errorKinds[kind] || 0) + count;
      }
    }
    const scenarioSnaps = {};
    for (const [scenarioId, bucket] of Object.entries(perScenario)) {
      scenarioSnaps[scenarioId] = bucket.snapshot();
      const b = bucket.snapshot();
      global.requests += b.requests;
      global.failures += b.failures;
      global.clientErrors += b.clientErrors;
      global.skipped += b.skipped;
      global.latencySum += b.mean * b.requests;
      global.bytesSum += b.bytes;
      for (const latency of bucket.sample) {
        if (global.sample.length < RESERVOIR_CAP) global.sample.push(latency);
      }
      if (b.requests) {
        if (b.min < global.latencyMin) global.latencyMin = b.min;
        if (b.max > global.latencyMax) global.latencyMax = b.max;
      }
    }
    return {
      elapsedMs: Date.now() - this.startedAt,
      global: global.snapshot(),
      scenarios: scenarioSnaps,
      steps: perStep,
    };
  }
}

module.exports = { StatsCollector, percentile, RESERVOIR_CAP };
