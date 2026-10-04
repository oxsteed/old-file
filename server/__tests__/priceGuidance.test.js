'use strict';

/**
 * Tests for the public price-guidance aggregate endpoint.
 * Exercises the pure core (percentiles, stats, scope fallback) plus the
 * HTTP layer's validation and error mapping with a fake DB interface.
 */

const router = require('../routes/priceGuidance');

const computeGuidance = router._computeGuidance;
const computeStats = router._computeStats;
const percentile = router._percentile;

function getHandler() {
  const layer = router.stack.find(
    (l) => l.route && l.route.path === '/' && l.route.methods.get
  );
  return layer.route.stack[0].handle;
}

function fakeRes() {
  return {
    code: 200,
    body: undefined,
    status(c) {
      this.code = c;
      return this;
    },
    json(d) {
      this.body = d;
      return this;
    },
  };
}

describe('priceGuidance percentile', () => {
  it('returns the single value for n=1', () => {
    expect(percentile([42], 0.25)).toBe(42);
  });

  it('interpolates linearly', () => {
    // sorted [10, 20, 30, 40, 50]: p25 pos = 1 -> 20; median pos = 2 -> 30
    expect(percentile([10, 20, 30, 40, 50], 0.25)).toBe(20);
    expect(percentile([10, 20, 30, 40, 50], 0.5)).toBe(30);
    expect(percentile([10, 20, 30, 40, 50], 0.75)).toBe(40);
  });

  it('handles even counts via interpolation', () => {
    // [10, 20, 30, 40]: median pos = 1.5 -> 25
    expect(percentile([10, 20, 30, 40], 0.5)).toBe(25);
  });
});

describe('priceGuidance computeStats', () => {
  it('returns nulls below the minimum sample', () => {
    const s = computeStats([10, 20, 30, 40]);
    expect(s.n).toBe(4);
    expect(s.p25).toBeNull();
    expect(s.median).toBeNull();
    expect(s.p75).toBeNull();
  });

  it('computes p25/median/p75 for a sufficient sample', () => {
    const s = computeStats([10, 20, 30, 40, 50, 60, 70, 80]);
    expect(s.n).toBe(8);
    expect(s.p25).toBeCloseTo(27.5);
    expect(s.median).toBe(45);
    expect(s.p75).toBeCloseTo(62.5);
  });

  it('drops non-positive values and absurd outliers', () => {
    const s = computeStats([0, -5, 20, 30, 40, 50, 60, 99999]);
    expect(s.n).toBe(5);
    expect(s.p25).toBe(30);
  });
});

describe('priceGuidance computeGuidance', () => {
  function fakeDb(ratesByCall) {
    let i = 0;
    return {
      calls: [],
      query: jest.fn(async (sql, params) => {
        const rows = ratesByCall[i++] || [];
        return { rows: rows.map((rate) => ({ rate })) };
      }),
    };
  }

  it('uses state scope when the state sample is sufficient', async () => {
    const db = fakeDb([[20, 25, 30, 35, 40, 45]]);
    const out = await computeGuidance(db, { source: 'helpers', category: 'plumbing', state: 'TX' });
    expect(out.scope).toBe('state');
    expect(out.n).toBe(6);
    expect(out.p25).not.toBeNull();
    expect(out.currency).toBe('USD');
    // state filter reached SQL
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toMatch(/UPPER\(hp\.service_state\)/);
    expect(params).toContain('TX');
  });

  it('falls back to global scope when the state sample is too small', async () => {
    const db = fakeDb([[20, 30], [20, 25, 30, 35, 40]]);
    const out = await computeGuidance(db, { source: 'jobs', category: null, state: 'ZZ' });
    expect(out.scope).toBe('global');
    expect(out.n).toBe(5);
    expect(out.median).toBe(30);
    expect(db.query).toHaveBeenCalledTimes(2);
  });

  it('returns nulls when even the global sample is too small', async () => {
    const db = fakeDb([[], []]);
    const out = await computeGuidance(db, { source: 'jobs', category: null, state: 'ZZ' });
    expect(out.p25).toBeNull();
    expect(out.n).toBe(0);
  });

  it('jobs query selects hourly budgets only', async () => {
    const db = fakeDb([[]]);
    await computeGuidance(db, { source: 'jobs', category: 'tutoring', state: null });
    const [sql] = db.query.mock.calls[0];
    expect(sql).toMatch(/budget_max IS NULL/);
    expect(sql).toMatch(/category_name ILIKE/);
  });

  it('helpers query uses the rate midpoint and category join', async () => {
    const db = fakeDb([[]]);
    await computeGuidance(db, { source: 'helpers', category: 'plumbing', state: null });
    const [sql] = db.query.mock.calls[0];
    expect(sql).toMatch(/helper_profiles/);
    expect(sql).toMatch(/helper_skills/);
    expect(sql).toMatch(/hourly_rate_min/);
  });
});

describe('priceGuidance HTTP layer', () => {
  const handler = getHandler();

  it('rejects an invalid source with 400', async () => {
    const res = fakeRes();
    await handler({ query: { source: 'nope' } }, res);
    expect(res.code).toBe(400);
    expect(res.body.error).toBe('invalid_source');
  });

  it('maps DB failures to 500 without leaking details', async () => {
    const realQuery = require('../db').query;
    const pool = require('../db');
    const spy = jest.spyOn(pool, 'query').mockRejectedValue(new Error('secret boom'));
    const res = fakeRes();
    await handler({ query: { source: 'jobs' } }, res);
    expect(res.code).toBe(500);
    expect(res.body.error).toBe('guidance_unavailable');
    expect(JSON.stringify(res.body)).not.toMatch(/secret boom/);
    spy.mockRestore();
    expect(realQuery).toBeDefined();
  });
});
