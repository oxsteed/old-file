'use strict';

const { buildPerformanceSummary, percentile, targetIsAllowed } = require('../scripts/verify-direct-catalog-performance');

describe('Direct catalog bounded performance verifier', () => {
  test('calculates stable percentile boundaries from measured samples', () => {
    expect(percentile([40, 10, 20, 30], 0.5)).toBe(20);
    expect(percentile([40, 10, 20, 30], 0.95)).toBe(40);
    expect(percentile([], 0.95)).toBe(0);
  });

  test('summarizes requests, payload volume, coverage, and latency', () => {
    const summary = buildPerformanceSummary([
      { category: 'electrical', durationMs: 40, bytes: 1000 },
      { category: 'plumbing', durationMs: 20, bytes: 800 },
      { category: 'electrical', durationMs: 30, bytes: 900 },
    ], { baseUrl: 'http://127.0.0.1:5000/api/direct/catalog', limit: 24, concurrency: 2 });

    expect(summary).toEqual(expect.objectContaining({
      requests: 3,
      limit: 24,
      concurrency: 2,
      bytes: 2700,
      p50Ms: 30,
      p95Ms: 40,
      maxMs: 40,
      meanMs: 30,
      categories: ['electrical', 'plumbing'],
    }));
  });

  test('requires explicit authorization before measuring a non-loopback target', () => {
    const previous = process.env.DIRECT_CATALOG_PERFORMANCE_LIVE;
    delete process.env.DIRECT_CATALOG_PERFORMANCE_LIVE;
    expect(targetIsAllowed(new URL('http://127.0.0.1:5000'))).toBe(true);
    expect(targetIsAllowed(new URL('https://oxsteed.com'))).toBe(false);
    process.env.DIRECT_CATALOG_PERFORMANCE_LIVE = 'true';
    expect(targetIsAllowed(new URL('https://oxsteed.com'))).toBe(true);
    if (previous === undefined) delete process.env.DIRECT_CATALOG_PERFORMANCE_LIVE;
    else process.env.DIRECT_CATALOG_PERFORMANCE_LIVE = previous;
  });
});
