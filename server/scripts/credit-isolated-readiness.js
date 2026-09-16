#!/usr/bin/env node
'use strict';

const baseUrl = String(process.argv[2] || '').replace(/\/$/, '');
const mode = process.argv[3] || 'ready';
const dependency = process.argv[4] || '';

if (!baseUrl || !['ready', 'degraded'].includes(mode)) {
  throw new Error('Usage: node credit-isolated-readiness.js <base-url> <ready|degraded> [database|redis]');
}
if (mode === 'degraded' && !['database', 'redis'].includes(dependency)) {
  throw new Error('A database or redis dependency is required for degraded readiness checks.');
}

const attempts = mode === 'ready' ? 120 : 30;
const delayMs = mode === 'ready' ? 2000 : 1000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readReadiness() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(`${baseUrl}/ready`, { signal: controller.signal });
    let payload = null;
    try {
      payload = await response.json();
    } catch {
      // A restarting container can close the response before JSON is available.
    }
    return { statusCode: response.status, payload };
  } catch (error) {
    return { statusCode: null, payload: null, error: error.name === 'AbortError' ? 'timeout' : error.message };
  } finally {
    clearTimeout(timeout);
  }
}

function matches(result) {
  if (mode === 'ready') {
    return result.statusCode === 200 && result.payload?.status === 'ready';
  }
  return result.statusCode === 503
    && result.payload?.status === 'not_ready'
    && result.payload?.checks?.[dependency]?.ok === false;
}

async function run() {
  let last;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    last = await readReadiness();
    if (matches(last)) {
      process.stdout.write(`${JSON.stringify({
        ok: true,
        mode,
        dependency: dependency || undefined,
        attempts: attempt,
        statusCode: last.statusCode,
        status: last.payload?.status,
        checks: last.payload?.checks,
      }, null, 2)}\n`);
      return;
    }
    if (attempt < attempts) await sleep(delayMs);
  }
  throw new Error(`Readiness did not reach ${mode}${dependency ? ` for ${dependency}` : ''}: ${JSON.stringify(last)}`);
}

run().catch((error) => {
  process.stderr.write(`Isolated readiness verification failed: ${error.message}\n`);
  process.exitCode = 1;
});
