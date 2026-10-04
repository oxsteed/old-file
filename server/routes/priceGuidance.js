'use strict';

/**
 * Public price-guidance aggregates.
 *
 * GET /api/price-guidance?source=helpers|jobs&category=<text>&state=XX
 *
 * Returns p25 / median / p75 hourly rates computed from:
 *   - source=helpers: helper_profiles.hourly_rate_min/max (rate point = midpoint),
 *     optionally narrowed by skill category (helper_skills -> categories) and
 *     coarse state (helper_profiles.service_state).
 *   - source=jobs:    jobs.budget_min for hourly-budget postings
 *     (hourly posts store budget_min only; fixed posts store both min and max,
 *     so `budget_max IS NULL` selects per-hour budgets), optionally narrowed
 *     by jobs.category_name and coarse state (jobs.location_state).
 *
 * Guidance only, never blocking: stats are hidden unless the sample has at
 * least MIN_SAMPLE rows; results are cached in-memory for CACHE_TTL_MS.
 */

const router = require('express').Router();
const pool = require('../db');
const logger = require('../utils/logger');

const CACHE_TTL_MS = 5 * 60 * 1000;
const MIN_SAMPLE = 5;
const MAX_ROWS = 5000;
const MAX_RATE = 10000; // sanity cap; obvious data-entry outliers are dropped
const cache = new Map();

/** Linear-interpolation percentile over a pre-sorted ascending array. */
function percentile(sorted, q) {
  if (!sorted.length) return null;
  if (sorted.length === 1) return sorted[0];
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

function computeStats(values) {
  const clean = values
    .map(Number)
    .filter((v) => Number.isFinite(v) && v > 0 && v <= MAX_RATE)
    .sort((a, b) => a - b);
  if (clean.length < MIN_SAMPLE) return { n: clean.length, p25: null, median: null, p75: null };
  const round2 = (v) => Math.round(v * 100) / 100;
  return {
    n: clean.length,
    p25: round2(percentile(clean, 0.25)),
    median: round2(percentile(clean, 0.5)),
    p75: round2(percentile(clean, 0.75)),
  };
}

async function fetchHelperRates(db, category, state) {
  const conditions = ['hp.hourly_rate_min IS NOT NULL'];
  const params = [];
  if (category) {
    params.push(`%${category}%`);
    conditions.push(
      `EXISTS (SELECT 1 FROM helper_skills hs JOIN categories c ON c.id = hs.category_id ` +
        `WHERE hs.user_id = hp.user_id AND (c.slug ILIKE $${params.length} OR c.name ILIKE $${params.length}))`
    );
  }
  if (state) {
    params.push(String(state).toUpperCase());
    conditions.push(`UPPER(hp.service_state) = $${params.length}`);
  }
  const { rows } = await db.query(
    `SELECT (COALESCE(hp.hourly_rate_min, 0) + COALESCE(hp.hourly_rate_max, hp.hourly_rate_min, 0)) / 2 AS rate
       FROM helper_profiles hp
      WHERE ${conditions.join(' AND ')}
      LIMIT ${MAX_ROWS}`,
    params
  );
  return rows.map((r) => r.rate);
}

async function fetchJobBudgets(db, category, state) {
  const conditions = ['j.budget_min IS NOT NULL', 'j.budget_max IS NULL'];
  const params = [];
  if (category) {
    params.push(`%${category}%`);
    conditions.push(`(j.category_name ILIKE $${params.length} OR j.category ILIKE $${params.length})`);
  }
  if (state) {
    params.push(String(state).toUpperCase());
    conditions.push(`UPPER(j.location_state) = $${params.length}`);
  }
  const { rows } = await db.query(
    `SELECT j.budget_min AS rate
       FROM jobs j
      WHERE ${conditions.join(' AND ')}
      LIMIT ${MAX_ROWS}`,
    params
  );
  return rows.map((r) => r.rate);
}

function cacheGet(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.at > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return entry.data;
}

function cacheSet(key, data) {
  if (cache.size > 500) cache.clear();
  cache.set(key, { at: Date.now(), data });
}

/**
 * Pure core: query the DB (via the injected query interface), fall back from
 * state scope to global scope when the sample is too small, and return the
 * guidance payload. Exported for tests.
 */
async function computeGuidance(db, { source, category, state }) {
  const fetch = source === 'jobs' ? fetchJobBudgets : fetchHelperRates;
  let scope = 'global';
  let stats = computeStats(await fetch(db, category, state && state !== '' ? state : null));
  if (stats.p25 === null && state) {
    // Too few rows for the state slice; retry unscoped before giving up.
    stats = computeStats(await fetch(db, category, null));
  } else if (stats.p25 !== null && state) {
    scope = 'state';
  }
  return {
    source,
    category: category || null,
    scope,
    currency: 'USD',
    n: stats.n,
    p25: stats.p25,
    median: stats.median,
    p75: stats.p75,
  };
}

router.get('/', async (req, res) => {
  const source = String(req.query.source || '').toLowerCase();
  if (source !== 'helpers' && source !== 'jobs') {
    return res.status(400).json({ error: 'invalid_source', message: 'source must be helpers or jobs' });
  }
  const category = String(req.query.category || '').trim().slice(0, 120) || null;
  const state = String(req.query.state || '').trim().slice(0, 4) || null;

  const key = JSON.stringify({ source, category, state });
  const cached = cacheGet(key);
  if (cached) return res.json(cached);

  try {
    const payload = await computeGuidance(pool, { source, category, state });
    cacheSet(key, payload);
    return res.json(payload);
  } catch (err) {
    logger.warn({ err: err.message, source }, 'price-guidance query failed');
    return res.status(500).json({ error: 'guidance_unavailable' });
  }
});

// Test hooks
router._computeGuidance = computeGuidance;
router._computeStats = computeStats;
router._percentile = percentile;
router._cache = cache;

module.exports = router;
