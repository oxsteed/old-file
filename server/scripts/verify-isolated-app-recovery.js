#!/usr/bin/env node
'use strict';

const { evaluateBoundedCatalogPayload } = require('./verify-direct-catalog-public-api');

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

function assertAllowedTarget(baseUrl, env = process.env) {
  const target = new URL(baseUrl);
  if (target.protocol !== 'http:' || !LOOPBACK_HOSTS.has(target.hostname.toLowerCase())) {
    throw new Error('Refusing a non-loopback application target.');
  }
  if (env.NODE_ENV !== 'test' || env.CREDIT_TEST_OUTAGE_MODE !== 'true') {
    throw new Error('This verifier requires NODE_ENV=test and CREDIT_TEST_OUTAGE_MODE=true.');
  }
  if (!/^oxsteed-credit-test-[a-z0-9-]+$/.test(String(env.CREDIT_TEST_PROJECT || ''))) {
    throw new Error('CREDIT_TEST_PROJECT must identify a disposable isolated project.');
  }
  return target;
}

function request(url, timeoutMs = 5000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { signal: controller.signal }).finally(() => clearTimeout(timeout));
}

async function readJson(url) {
  const response = await request(url);
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    // The caller reports an invalid response shape below.
  }
  return { response, payload };
}

async function verifyRecoveredApplication(baseUrl, env = process.env) {
  const target = assertAllowedTarget(baseUrl, env);
  const health = await readJson(new URL('/health', target));
  if (health.response.status !== 200 || health.payload?.status !== 'ok') {
    throw new Error(`Recovered application liveness failed: HTTP ${health.response.status}`);
  }

  const ready = await readJson(new URL('/ready', target));
  if (ready.response.status !== 200 || ready.payload?.status !== 'ready') {
    throw new Error(`Recovered application readiness failed: HTTP ${ready.response.status}`);
  }

  const catalogUrl = new URL('/api/direct/catalog', target);
  catalogUrl.searchParams.set('lang', 'en');
  catalogUrl.searchParams.set('category', 'electrical');
  catalogUrl.searchParams.set('limit', '24');
  catalogUrl.searchParams.set('offset', '0');
  const catalog = await readJson(catalogUrl);
  if (!catalog.response.ok) {
    throw new Error(`Recovered catalog route failed: HTTP ${catalog.response.status}`);
  }
  const catalogResult = evaluateBoundedCatalogPayload(catalog.payload, {
    categorySlug: 'electrical',
    limit: 24,
    offset: 0,
  });
  if (!catalogResult.ok) {
    throw new Error(`Recovered catalog route returned invalid data: ${catalogResult.failures.join('; ')}`);
  }

  return {
    ok: true,
    health: { statusCode: health.response.status, status: health.payload.status },
    ready: { statusCode: ready.response.status, status: ready.payload.status },
    catalog: { statusCode: catalog.response.status, serviceCount: catalogResult.serviceCount },
  };
}

async function verifyStoppedApplication(baseUrl, env = process.env) {
  const target = assertAllowedTarget(baseUrl, env);
  let lastError = null;
  for (let attempt = 1; attempt <= 20; attempt += 1) {
    try {
      const response = await request(new URL('/health', target), 1000);
      if (response.ok || response.status < 500) {
        throw new Error(`stopped application still answered HTTP ${response.status}`);
      }
      lastError = new Error(`stopped application answered HTTP ${response.status}`);
    } catch (error) {
      if (error.message.startsWith('stopped application still answered')) throw error;
      lastError = error;
      process.stdout.write(`Application outage observed after ${attempt} attempt(s).\n`);
      return { ok: true, attempts: attempt, error: error.name || 'request_failed' };
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Stopped application remained reachable: ${lastError?.message || 'unknown response'}`);
}

async function main() {
  const baseUrl = process.argv[2];
  const mode = process.argv[3] || 'recovered';
  if (!baseUrl || !['stopped', 'recovered'].includes(mode)) {
    throw new Error('Usage: node verify-isolated-app-recovery.js <loopback-base-url> <stopped|recovered>');
  }
  const result = mode === 'stopped'
    ? await verifyStoppedApplication(baseUrl)
    : await verifyRecoveredApplication(baseUrl);
  process.stdout.write(`${JSON.stringify({ mode, ...result }, null, 2)}\n`);
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`Isolated application recovery verification failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  assertAllowedTarget,
  verifyRecoveredApplication,
  verifyStoppedApplication,
};
