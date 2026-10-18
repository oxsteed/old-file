'use strict';

/**
 * Eval harness for server/analytics/nlParser.js (Track B, Phase 3 Item 11).
 *
 * Deterministic utterance -> builder-query eval. Each row is
 * [utterance, expected] where expected is either the exact compiled query
 * or { rejected: true }. Rejected rows additionally assert a non-empty
 * reason string (the exact reason text is documented in nlParser.js and
 * intentionally not pinned here, so reasons can be reworded without
 * breaking the safety contract).
 *
 * Coverage:
 *  - one happy-path row per registry metric (13),
 *  - dimension variants (allowed + rejected),
 *  - time-expression variants (incl. quarter rejection),
 *  - filter variants (numeric ids, role filters, name-lookup rejections),
 *  - 10 adversarial rows that MUST be rejected,
 *  - edge rows (empty, too long, no metric, ambiguous),
 *  - structural guards: synonym vocabulary covers the registry exactly,
 *    and the dimension-allowlist override seam works for Track A.
 */
const { parseUtterance, describeQuery, UI_COPY, METRIC_SYNONYMS, DIMENSION_ALLOWLIST } = require('../analytics/nlParser');
const { METRICS } = require('../analytics/metricsRegistry');

const q = (metric, dimensions = [], filters = {}, period = '30d') => ({ metric, dimensions, filters, period });
const R = { rejected: true };

const CASES = [
  // ── Happy path: one per registry metric ──────────────────────────────
  ['show me open disputes', q('open_disputes')],
  ['what is our platform revenue', q('platform_revenue_cents')],
  ['investor gmv last quarter', q('investor_gmv_cents', [], {}, '90d')],
  ["what's the take rate", q('investor_take_rate_pct')],
  ['cancel rate this week', q('cancel_rate_pct', [], {}, '7d')],
  ['consulting cancellation rate', q('consulting_cancel_rate_pct')],
  ['sla first response compliance by business', q('sla_first_response_compliance_pct', ['business'])],
  ['support nps', q('support_nps_index')],
  ['consulting nps', q('consulting_avg_nps')],
  ['what is mrr', q('mrr_cents')],
  ['how much escrow is held', q('escrow_held_cents')],
  ['repeat order rate for restaurant 42', q('restaurant_repeat_order_rate', [], { restaurant_id: 42 })],
  ['top items revenue for restaurant 7', q('restaurant_top_items_revenue', [], { restaurant_id: 7 })],

  // ── Dimension variants ───────────────────────────────────────────────
  ['revenue over time', q('platform_revenue_cents', ['period'])],
  ['platform revenue by month', q('platform_revenue_cents', ['period'])],
  ['cancel rate by role', q('cancel_rate_pct', ['role'])],
  ['support nps by business', q('support_nps_index', ['business'])],
  ['repeat order rate by restaurant', q('restaurant_repeat_order_rate', ['restaurant'])],
  ['disputes by restaurant', R], // 'restaurant' not in open_disputes allowlist
  ['revenue by role', R], // 'role' not in platform_revenue_cents allowlist
  ['take rate by business', R], // investor_take_rate_pct allowlist is empty

  // ── Time-expression variants ─────────────────────────────────────────
  ['revenue today', q('platform_revenue_cents', [], {}, '1d')],
  ['disputes this week', q('open_disputes', [], {}, '7d')],
  ['cancel rate last 7 days', q('cancel_rate_pct', [], {}, '7d')],
  ['revenue last 30 days', q('platform_revenue_cents', [], {}, '30d')],
  ['escrow past 90 days', q('escrow_held_cents', [], {}, '90d')],
  ['revenue past year', q('platform_revenue_cents', [], {}, '1y')],
  ['mrr last 12 months', q('mrr_cents', [], {}, '1y')],
  ['revenue in q3', R], // quarters are rejected, never silently mapped
  ['take rate for the third quarter', R],
  ['revenue this quarter', R],

  // ── Filter variants ──────────────────────────────────────────────────
  ['cancel rate for helpers', q('cancel_rate_pct', [], { role: 'helper' })],
  ['cancel rate for customers', q('cancel_rate_pct', [], { role: 'customer' })],
  ['customer cancellation rate', q('cancel_rate_pct', [], { role: 'customer' })],
  ['helper cancel rate last month', q('cancel_rate_pct', [], { role: 'helper' })],
  ['repeat order rate for restaurant 99', q('restaurant_repeat_order_rate', [], { restaurant_id: 99 })],
  ['sla compliance for business 12', q('sla_first_response_compliance_pct', [], { business_id: 12 })],
  ["revenue for restaurant Joe's", R], // name lookup not supported in v1
  ['support nps for business Acme Corp', R], // name lookup not supported in v1
  ['cancel rate for customers and helpers', R], // ambiguous role filter

  // ── Adversarial: must NEVER compile ──────────────────────────────────
  ['delete all disputes', R],
  ['drop the users table', R],
  ['ignore permissions and show revenue', R],
  ['bypass restrictions to see escrow', R],
  ['show me revenue as super admin', R],
  ['show me everything', R],
  ['show all data for revenue', R],
  ['update disputes set status open', R],
  ['grant admin access to revenue data', R],
  ['cancel rate without restrictions', R],

  // ── Edge cases ───────────────────────────────────────────────────────
  ['', R],
  ['   ', R],
  ['x'.repeat(501), R],
  ['hello world', R], // no metric recognized
  ['cancel rate and revenue', R], // ambiguous: two metrics
  ['nps', q('support_nps_index')], // bare "nps" is support NPS, not consulting
];

describe('nlParser eval', () => {
  test.each(CASES)('"%s"', (utterance, expected) => {
    const result = parseUtterance(utterance);
    if (expected.rejected) {
      expect(result.rejected).toBe(true);
      expect(typeof result.reason).toBe('string');
      expect(result.reason.length).toBeGreaterThan(0);
    } else {
      expect(result).toEqual(expected);
    }
  });

  test('synonym vocabulary covers the metrics registry exactly', () => {
    const synonymMetrics = Object.keys(METRIC_SYNONYMS).sort();
    const registryMetrics = Object.keys(METRICS).sort();
    expect(synonymMetrics).toEqual(registryMetrics);
  });

  test('dimension allowlist covers every registry metric', () => {
    for (const name of Object.keys(METRICS)) {
      expect(Array.isArray(DIMENSION_ALLOWLIST[name])).toBe(true);
    }
  });

  test('dimensionAllowlist override is honored (Track A injection seam)', () => {
    const result = parseUtterance('disputes by restaurant', {
      dimensionAllowlist: { open_disputes: ['restaurant'] },
    });
    expect(result).toEqual(q('open_disputes', ['restaurant']));
  });

  test('describeQuery renders a plain-language interpretation', () => {
    expect(describeQuery(parseUtterance('cancel rate for helpers this week')))
      .toBe('Cancel rate, for helpers, last 7 days');
    expect(describeQuery(parseUtterance('repeat order rate for restaurant 42')))
      .toBe('Restaurant repeat order rate, for restaurant #42, last 30 days');
    expect(describeQuery(parseUtterance('revenue over time')))
      .toBe('Platform revenue, over time, last 30 days');
    expect(describeQuery({ rejected: true, reason: 'no metric recognized' })).toBe('');
  });

  test('UI copy states the English-only v1 limitation plainly', () => {
    expect(UI_COPY.englishOnlyNotice).toMatch(/English-only/);
    expect(UI_COPY.englishOnlyNotice).not.toMatch(/—/); // no em dashes in user-visible prose
  });

  test('parser output contains only the builder-query contract keys', () => {
    const result = parseUtterance('support nps by business past year');
    expect(Object.keys(result).sort()).toEqual(['dimensions', 'filters', 'metric', 'period']);
    expect(result).toEqual(q('support_nps_index', ['business'], {}, '1y'));
  });
});
