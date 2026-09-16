#!/usr/bin/env node
'use strict';

const { evaluateBoundedCatalogPayload } = require('./verify-direct-catalog-public-api');

const CATEGORIES = ['electrical', 'plumbing', 'carpentry', 'painting', 'landscaping'];
const DEFAULT_LIMIT = 24;

function positiveInteger(value, fallback, maximum) {
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > maximum) {
    throw new Error(`performance setting must be a whole number between 1 and ${maximum}`);
  }
  return parsed;
}

function percentile(values, fraction) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * fraction) - 1));
  return sorted[index];
}

function targetIsAllowed(url) {
  const hostname = url.hostname.toLowerCase();
  const loopback = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
  return loopback || process.env.DIRECT_CATALOG_PERFORMANCE_LIVE === 'true';
}

function buildPerformanceSummary(samples, { baseUrl, limit, concurrency }) {
  const latencies = samples.map((sample) => sample.durationMs);
  const bytes = samples.reduce((total, sample) => total + sample.bytes, 0);
  return {
    baseUrl,
    requests: samples.length,
    limit,
    concurrency,
    bytes,
    p50Ms: percentile(latencies, 0.5),
    p95Ms: percentile(latencies, 0.95),
    maxMs: Math.max(...latencies, 0),
    meanMs: latencies.length ? Number((latencies.reduce((total, value) => total + value, 0) / latencies.length).toFixed(2)) : 0,
    categories: [...new Set(samples.map((sample) => sample.category))],
  };
}

async function fetchSample(baseUrl, category, offset, limit) {
  const url = new URL(baseUrl);
  url.searchParams.set('lang', 'en');
  url.searchParams.set('category', category);
  url.searchParams.set('limit', String(limit));
  url.searchParams.set('offset', String(offset));
  const startedAt = performance.now();
  const response = await fetch(url);
  const body = await response.text();
  const durationMs = Number((performance.now() - startedAt).toFixed(2));
  if (!response.ok) throw new Error(`bounded catalog ${category}/${offset} returned HTTP ${response.status}`);
  let payload;
  try {
    payload = JSON.parse(body);
  } catch {
    throw new Error(`bounded catalog ${category}/${offset} returned invalid JSON`);
  }
  const result = evaluateBoundedCatalogPayload({ ...payload, durationMs }, { categorySlug: category, limit, offset });
  if (!result.ok) throw new Error(`bounded catalog ${category}/${offset} failed: ${result.failures.join('; ')}`);
  const maxMs = Number(process.env.DIRECT_CATALOG_BOUNDED_MAX_MS || 5000);
  if (!Number.isFinite(maxMs) || maxMs < 1 || durationMs > maxMs) {
    throw new Error(`bounded catalog ${category}/${offset} took ${durationMs}ms, maximum ${maxMs}ms`);
  }
  return { category, offset, durationMs, bytes: Buffer.byteLength(body) };
}

async function verifyDirectCatalogPerformance({
  baseUrl = process.env.DIRECT_CATALOG_PUBLIC_API_URL || 'http://127.0.0.1:5000/api/direct/catalog',
  samples = positiveInteger(process.env.DIRECT_CATALOG_PERFORMANCE_SAMPLES, 20, 200),
  concurrency = positiveInteger(process.env.DIRECT_CATALOG_PERFORMANCE_CONCURRENCY, 4, 20),
  limit = positiveInteger(process.env.DIRECT_CATALOG_PERFORMANCE_LIMIT, DEFAULT_LIMIT, 100),
} = {}) {
  const target = new URL(baseUrl);
  if (!targetIsAllowed(target)) {
    throw new Error('Refusing a non-loopback target unless DIRECT_CATALOG_PERFORMANCE_LIVE=true is set explicitly');
  }
  const jobs = Array.from({ length: samples }, (_, index) => ({
    category: CATEGORIES[index % CATEGORIES.length],
    offset: (index % 8) * limit,
  }));
  const results = [];
  for (let index = 0; index < jobs.length; index += concurrency) {
    const batch = jobs.slice(index, index + concurrency);
    results.push(...await Promise.all(batch.map(({ category, offset }) => fetchSample(target, category, offset, limit))));
  }
  return buildPerformanceSummary(results, { baseUrl: target.toString(), limit, concurrency });
}

if (require.main === module) {
  verifyDirectCatalogPerformance()
    .then((summary) => console.log(`Direct catalog bounded performance passed: ${JSON.stringify(summary)}`))
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}

module.exports = { buildPerformanceSummary, percentile, targetIsAllowed, verifyDirectCatalogPerformance };
