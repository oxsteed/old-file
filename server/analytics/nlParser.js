'use strict';

/**
 * Deterministic NL -> builder-query compiler v1 (Track B, Phase 3 Item 11).
 *
 * parseUtterance(text) compiles a plain-English analytics question into a
 * READ-ONLY builder query:
 *
 *   { metric: string, dimensions: string[], filters: object, period: '1d'|'7d'|'30d'|'90d'|'1y' }
 *
 * or rejects it:
 *
 *   { rejected: true, reason: string }
 *
 * DESIGN RULES (auditable, no exceptions):
 * 1. DETERMINISTIC pattern matching only. No LLM at runtime, no guessing.
 *    Every compiled query is traceable to explicit rules in this file: the
 *    METRIC_SYNONYMS table, DIMENSION_PATTERNS, TIME_PATTERNS, FILTER_RULES.
 * 2. The parser can ONLY emit a builder query. It never produces SQL, never
 *    touches the database, never reads scopeModel.js bypasses, and cannot
 *    widen permissions. The compiled query MUST still pass Track A's
 *    validateBuilderQuery before execution (defense in depth): the route
 *    executes nothing from an unconfirmed parse.
 * 3. English-only v1. Non-English input is not translated or interpreted;
 *    it will almost always fail metric recognition and be rejected with
 *    'no metric recognized'. The admin UI must say this plainly.
 * 4. Fail closed. Anything the rules below do not explicitly recognize is
 *    rejected or ignored (documented per rule), never guessed.
 *
 * MATCHING STRATEGY:
 * - Input is lowercased, punctuation stripped, whitespace collapsed.
 * - Adversarial screening runs FIRST (destructive SQL verbs, permission
 *   bypass phrases) so hostile input can never reach metric matching.
 * - Metric synonyms are matched longest-first with greedy span consumption:
 *   once "consulting nps" matches, its span is removed before "nps" is
 *   tried, so the more specific metric wins deterministically.
 * - If spans for TWO OR MORE distinct metrics match, the utterance is
 *   rejected as 'ambiguous' (the builder contract carries one metric).
 * - Dimensions are validated against the metric's allowlist and rejected
 *   when unsupported. Time phrases set the period (default '30d').
 *   Quarter references ("Q3", "third quarter") are REJECTED, not mapped:
 *   silently mapping a calendar quarter to a trailing window would lie.
 *
 * TRACK A INTEGRATION CONTRACT (queryBuilder.js not yet landed at the time
 * this file was written; the planned contract is mirrored below):
 * - Builder query shape: { metric, dimensions, filters, period } with
 *   period in '1d'|'7d'|'30d'|'90d'|'1y'.
 * - Dimension allowlists (planned): open_disputes: [],
 *   platform_revenue_cents: ['period'], cancel_rate_pct: ['role'],
 *   sla_first_response_compliance_pct: ['business'],
 *   support_nps_index: ['business'], restaurant_repeat_order_rate: ['restaurant'],
 *   restaurant_top_items_revenue: ['restaurant'], all others: [].
 *   This file carries the same table as DIMENSION_ALLOWLIST so the parser
 *   can run standalone; parseUtterance(text, { dimensionAllowlist }) accepts
 *   Track A's exported table as an override when it exists.
 * - Route (to be wired by Track A / coordinator):
 *   POST /api/admin/analytics/query-builder/nl-parse (requireAdmin):
 *   runs parseUtterance, returns { interpretation } or { rejected, reason },
 *   NEVER executes. The admin confirms the interpretation; only the
 *   confirmed builder query goes to the existing run endpoint after
 *   validateBuilderQuery. NL executions are audit-logged with BOTH
 *   raw_utterance and compiled_query (Track A's audit table keeps
 *   raw_utterance nullable for this).
 */

// ── Metric synonym vocabulary ─────────────────────────────────────────────
// metric -> ordered synonym phrases. Every phrase becomes a case-insensitive
// whole-word regex. The flat list is sorted longest-first at load time so
// greedy span consumption always prefers the most specific phrase.
const METRIC_SYNONYMS = Object.freeze({
  open_disputes: ['open disputes', 'disputes'],
  platform_revenue_cents: ['platform revenue', 'platform take', 'revenue'],
  investor_gmv_cents: ['investor gmv', 'gross merchandise value', 'gmv'],
  investor_take_rate_pct: ['investor take rate', 'take rate', 'take-rate'],
  cancel_rate_pct: ['cancellation rate', 'cancel rate'],
  consulting_cancel_rate_pct: ['consulting cancellation rate', 'consulting cancel rate'],
  sla_first_response_compliance_pct: ['sla first response compliance', 'sla first response', 'sla compliance', 'sla'],
  support_nps_index: ['support nps', 'nps'],
  consulting_avg_nps: ['consulting nps'],
  mrr_cents: ['monthly recurring revenue', 'mrr'],
  escrow_held_cents: ['escrow held', 'escrow'],
  restaurant_repeat_order_rate: ['repeat order rate', 'repeat order'],
  restaurant_top_items_revenue: ['top menu items revenue', 'top items revenue', 'top menu items', 'top items'],
});

const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Flat [regex, metric] list, longest phrase first. Built once, frozen.
const METRIC_PATTERNS = (() => {
  const flat = [];
  for (const [metric, phrases] of Object.entries(METRIC_SYNONYMS)) {
    for (const phrase of phrases) {
      flat.push({ re: new RegExp(`\\b${escapeRegExp(phrase)}\\b`), metric, len: phrase.length });
    }
  }
  flat.sort((a, b) => b.len - a.len);
  return Object.freeze(flat.map(({ re, metric }) => Object.freeze({ re, metric })));
})();

// ── Dimension allowlist (mirrors Track A's planned per-metric allowlist) ────
const DIMENSION_ALLOWLIST = Object.freeze({
  open_disputes: Object.freeze([]),
  platform_revenue_cents: Object.freeze(['period']),
  investor_gmv_cents: Object.freeze([]),
  investor_take_rate_pct: Object.freeze([]),
  cancel_rate_pct: Object.freeze(['role']),
  consulting_cancel_rate_pct: Object.freeze([]),
  sla_first_response_compliance_pct: Object.freeze(['business']),
  support_nps_index: Object.freeze(['business']),
  consulting_avg_nps: Object.freeze([]),
  mrr_cents: Object.freeze([]),
  escrow_held_cents: Object.freeze([]),
  restaurant_repeat_order_rate: Object.freeze(['restaurant']),
  restaurant_top_items_revenue: Object.freeze(['restaurant']),
});

// phrase -> dimension, checked in this order; first match per dimension wins.
const DIMENSION_PATTERNS = Object.freeze([
  { re: /\bby\s+restaurant\b/, dimension: 'restaurant' },
  { re: /\bby\s+role\b/, dimension: 'role' },
  { re: /\bby\s+business\b/, dimension: 'business' },
  { re: /\bover\s+time\b/, dimension: 'period' },
  { re: /\bby\s+month\b/, dimension: 'period' },
  { re: /\bby\s+week\b/, dimension: 'period' },
  { re: /\bmonthly\b/, dimension: 'period' },
  { re: /\bweekly\b/, dimension: 'period' },
]);

// ── Time expressions -> canonical period (first match in this order wins) ───
const TIME_PATTERNS = Object.freeze([
  { re: /\btoday\b/, period: '1d' },
  { re: /\bthis\s+week\b/, period: '7d' },
  { re: /\blast\s+week\b/, period: '7d' },
  { re: /\bpast\s+week\b/, period: '7d' },
  { re: /\blast\s+7\s+days\b/, period: '7d' },
  { re: /\bpast\s+7\s+days\b/, period: '7d' },
  { re: /\blast\s+month\b/, period: '30d' },
  { re: /\bpast\s+month\b/, period: '30d' },
  { re: /\blast\s+30\s+days\b/, period: '30d' },
  { re: /\bpast\s+30\s+days\b/, period: '30d' },
  { re: /\blast\s+quarter\b/, period: '90d' },
  { re: /\bpast\s+quarter\b/, period: '90d' },
  { re: /\blast\s+90\s+days\b/, period: '90d' },
  { re: /\bpast\s+90\s+days\b/, period: '90d' },
  { re: /\blast\s+year\b/, period: '1y' },
  { re: /\bpast\s+year\b/, period: '1y' },
  { re: /\blast\s+12\s+months\b/, period: '1y' },
  { re: /\bpast\s+12\s+months\b/, period: '1y' },
]);
const DEFAULT_PERIOD = '30d';

// Quarter references are never mapped to a trailing window. Mapping "Q3" to
// '90d' would silently misreport a calendar quarter as "last 90 days".
const QUARTER_RE = /\bq[1-4]\b|\b(first|second|third|fourth)\s+quarter\b|\bthis\s+quarter\b/;

// ── Adversarial screening (runs before anything else) ───────────────────────
// Whole-word SQL verbs: fail closed even for phrasings like "revenue drop"
// (v1 limitation, documented; rephrase as "revenue decline").
// Bypass phrases: any attempt to widen permissions or exfiltrate scope.
const DESTRUCTIVE_RE = /\b(delete|drop|update|insert|truncate|alter|grant)\b/;
const BYPASS_RE = /ignore\s+permissions?|bypass|as\s+super\s*-?\s*admin|show\s+me\s+everything|all\s+data|without\s+restrictions?/;

const MAX_INPUT_CHARS = 500;

// ── Filter rules ────────────────────────────────────────────────────────────
// v1 recognizes exactly:
//   - numeric restaurant id: "for restaurant 42" / "restaurant 42"
//     -> filters { restaurant_id: 42 }
//   - name-based restaurant references are REJECTED (no name lookup in v1).
//   - role words, cancel_rate_pct only: "for customers"/"for helpers",
//     "customer cancel rate", "helper cancellation rate"
//     -> filters { role: 'customer' | 'helper' }.
//   - numeric business id, sla_first_response_compliance_pct and
//     support_nps_index only: "for business 7" -> { business_id: 7 };
//     name-based business references are REJECTED.
// Any other "for X" phrasing is IGNORED in v1 (documented): the admin sees
// the parsed interpretation before confirming, so dropped intent is visible.
const ROLE_FILTER_METRICS = Object.freeze(['cancel_rate_pct']);
const BUSINESS_FILTER_METRICS = Object.freeze([
  'sla_first_response_compliance_pct',
  'support_nps_index',
]);

function normalize(text) {
  return String(text)
    .toLowerCase()
    .replace(/[’‘`]/g, '')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseUtterance(rawText, options = {}) {
  if (rawText == null || String(rawText).trim() === '') {
    return { rejected: true, reason: 'empty input' };
  }
  const raw = String(rawText);
  if (raw.length > MAX_INPUT_CHARS) {
    return { rejected: true, reason: `input too long (max ${MAX_INPUT_CHARS} characters)` };
  }

  const text = normalize(raw);

  // 1. Adversarial screening: destructive verbs and permission bypasses
  //    can never reach metric matching.
  if (DESTRUCTIVE_RE.test(text)) {
    return { rejected: true, reason: 'write/destructive operation not allowed' };
  }
  if (BYPASS_RE.test(text)) {
    return { rejected: true, reason: 'permission bypass not allowed' };
  }

  // 2. Quarter references are rejected, never silently mapped.
  if (QUARTER_RE.test(text)) {
    return { rejected: true, reason: 'quarters not supported in v1' };
  }

  // 3. Metric recognition: longest-first greedy span consumption.
  const allowlist = options.dimensionAllowlist || DIMENSION_ALLOWLIST;
  let remaining = ` ${text} `;
  const matchedMetrics = [];
  for (const { re, metric } of METRIC_PATTERNS) {
    if (re.test(remaining)) {
      if (!matchedMetrics.includes(metric)) matchedMetrics.push(metric);
      remaining = remaining.replace(re, ' ');
    }
  }
  if (matchedMetrics.length === 0) {
    return { rejected: true, reason: 'no metric recognized' };
  }
  if (matchedMetrics.length > 1) {
    return { rejected: true, reason: 'ambiguous: multiple metrics matched' };
  }
  const metric = matchedMetrics[0];

  // 4. Dimensions, validated against the metric's allowlist.
  const dimensions = [];
  for (const { re, dimension } of DIMENSION_PATTERNS) {
    if (re.test(text) && !dimensions.includes(dimension)) dimensions.push(dimension);
  }
  const allowed = allowlist[metric] || [];
  for (const d of dimensions) {
    if (!allowed.includes(d)) {
      return { rejected: true, reason: `dimension '${d}' not supported for metric '${metric}'` };
    }
  }

  // 5. Filters.
  const filters = {};

  // 5a. Restaurant id (numeric only; names rejected).
  let m = text.match(/\bfor\s+restaurant\s+(\S+)/) || text.match(/\brestaurant\s+(\d+)\b/);
  if (m) {
    const idToken = m[1];
    if (!/^\d+$/.test(idToken)) {
      return { rejected: true, reason: 'restaurant name lookup not supported in v1' };
    }
    filters.restaurant_id = parseInt(idToken, 10);
  }

  // 5b. Role filter (cancel_rate_pct only).
  if (ROLE_FILTER_METRICS.includes(metric)) {
    const customerHit = /\bcustomers?\b/.test(text);
    const helperHit = /\bhelpers?\b/.test(text);
    if (customerHit && helperHit) {
      return { rejected: true, reason: 'ambiguous role filter' };
    }
    if (customerHit) filters.role = 'customer';
    else if (helperHit) filters.role = 'helper';
  }

  // 5c. Business id (numeric only; only for business-dimensioned metrics).
  if (BUSINESS_FILTER_METRICS.includes(metric)) {
    const bm = text.match(/\bfor\s+business\s+(\S+)/) || text.match(/\bbusiness\s+(\d+)\b/);
    if (bm) {
      if (!/^\d+$/.test(bm[1])) {
        return { rejected: true, reason: 'business name lookup not supported in v1' };
      }
      filters.business_id = parseInt(bm[1], 10);
    }
  }

  // 6. Period (first matching time expression wins; default 30d).
  let period = DEFAULT_PERIOD;
  for (const { re, period: p } of TIME_PATTERNS) {
    if (re.test(text)) {
      period = p;
      break;
    }
  }

  return { metric, dimensions, filters, period };
}

// ── Plain-language interpretation (for the admin confirm step) ──────────────
// English-only, matching the parser. No em dashes.
const METRIC_LABELS = Object.freeze({
  open_disputes: 'Open disputes',
  platform_revenue_cents: 'Platform revenue',
  investor_gmv_cents: 'Investor GMV',
  investor_take_rate_pct: 'Investor take rate',
  cancel_rate_pct: 'Cancel rate',
  consulting_cancel_rate_pct: 'Consulting cancel rate',
  sla_first_response_compliance_pct: 'SLA first-response compliance',
  support_nps_index: 'Support NPS',
  consulting_avg_nps: 'Consulting average NPS',
  mrr_cents: 'MRR',
  escrow_held_cents: 'Escrow held',
  restaurant_repeat_order_rate: 'Restaurant repeat order rate',
  restaurant_top_items_revenue: 'Restaurant top items revenue',
});

const DIMENSION_LABELS = Object.freeze({
  restaurant: 'broken down by restaurant',
  role: 'broken down by role',
  business: 'broken down by business',
  period: 'over time',
});

const PERIOD_LABELS = Object.freeze({
  '1d': 'today',
  '7d': 'last 7 days',
  '30d': 'last 30 days',
  '90d': 'last 90 days',
  '1y': 'last 12 months',
});

// ── UI copy for the NL input section (Track A integration) ───────────────
// The parser stays English-only; the admin UI must say so plainly. Track A
// wires this string into the 5-language locale catalogs (same
// byte-preserving workflow as the query-builder strings) rather than the
// parser pretending to understand other languages.
const UI_COPY = Object.freeze({
  englishOnlyNotice:
    'Natural language search is English-only in v1. Type an English question, review the interpretation, then confirm to run it.',
});

function describeQuery(query) {
  if (!query || query.rejected) return '';
  const parts = [METRIC_LABELS[query.metric] || query.metric];
  const f = query.filters || {};
  if (f.restaurant_id != null) parts.push(`for restaurant #${f.restaurant_id}`);
  if (f.business_id != null) parts.push(`for business #${f.business_id}`);
  if (f.role) parts.push(`for ${f.role}s`);
  for (const d of query.dimensions || []) {
    if (DIMENSION_LABELS[d]) parts.push(DIMENSION_LABELS[d]);
  }
  parts.push(PERIOD_LABELS[query.period] || query.period);
  return parts.join(', ');
}

module.exports = {
  parseUtterance,
  describeQuery,
  UI_COPY,
  METRIC_SYNONYMS,
  DIMENSION_ALLOWLIST,
  DIMENSION_PATTERNS,
  TIME_PATTERNS,
  DEFAULT_PERIOD,
  MAX_INPUT_CHARS,
  METRIC_LABELS,
  PERIOD_LABELS,
};
