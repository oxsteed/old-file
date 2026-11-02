'use strict';

const { financialMetricValue } = require('./financialMetrics');
const { DEFINITIONS: operationalMetrics } = require('./operationalMetrics');
const exactInteger = value => {
  if (value == null) return 0;
  const number = Number(value);
  return Number.isSafeInteger(number) ? number : String(value);
};

/**
 * Governed metrics registry v1 — Area 1 of the analytics platform.
 *
 * Every business KPI is defined exactly once here: name, canonical SQL
 * definition, dimensions, and owner. Controllers migrate to these definitions
 * so the same number cannot be computed two different ways on two different
 * pages. "Definition parity, not rewrite": where a domain deliberately uses a
 * different formula (e.g. consulting cancel rate), it is registered as its
 * own metric with the rationale documented instead of being silently merged.
 *
 * Conventions:
 * - Amounts are integer cents unless the name says otherwise.
 * - Compute functions take the db module (anything with `.query`) as the
 *   first argument so parity tests can run them against a real database.
 * - Compute functions throw on genuine query errors; controllers keep their
 *   existing fail-open schema probes / try/catch around these calls.
 *
 * Divergence decisions (verified in docs/analytics-platform/SCOPE.md):
 * 1. OPEN DISPUTES — canonical: `disputes` table, status='open'. This matches
 *    the /admin/disputes drill-through target (default tab 'open'), so the
 *    dashboard card and the list it links to agree FOR GLOBAL ADMINS.
 *    SCOPE, RESOLVED (PR #662, Option A): the regular admin dashboard count
 *    (adminController getDashboardStats, via metricScope + regionScopedDb,
 *    fail-closed 0 without a manage_disputes grant) and the disputes list
 *    (disputeAdminController, 403 without a resolving grant, job-location
 *    anchor) are now scoped the same way as the governed card, so a region
 *    admin sees a regional card against a regional list. Only the
 *    super-admin dashboard (superAdminController, requireSuperAdmin-only
 *    route) stays global, which is correct-by-role. The formula is canonical
 *    everywhere. Replaces jobs.status='disputed' (admin) and
 *    jobs.dispute_status='open' (super-admin). 'under_review' disputes are
 *    tracked separately by getDisputeStats and are NOT folded into this
 *    number.
 * 2. REVENUE — canonical platform revenue: platform take from
 *    platform_ledger (source_type IN ('job_fee','subscription'),
 *    amount_cents > 0). Vertical GMVs (food, tool rentals, consulting) are
 *    separate metrics with their own names, not rival definitions of the same
 *    KPI. Investor GMV is SUM(final_price_cents) of non-deleted completed
 *    jobs (recorded value, not budget estimates); jobs with no final price
 *    are reported separately as unpriced, never estimated
 *    (see investor_gmv_cents).
 * 3. CANCEL RATE — canonical per-role, server-side, excluding soft-deleted
 *    jobs (deleted_at IS NULL, matching migration 170's materialized views):
 *      customer (posted): cancelled / total posted
 *      helper  (accepted): cancelled / total accepted
 *      platform: cancelled / total jobs
 *    Consulting keeps its own registered metric (consulting_cancel_rate =
 *    cancelled / (completed + cancelled)) — different domain, deliberate.
 *    Risk thresholds (5/15/30) live here once; the controller and the
 *    materialized-view queries reference them instead of hardcoding copies.
 * 4. INVESTOR TAKE-RATE — old formula divided ALL-TIME take INCLUDING
 *    subscriptions by budget-GMV, so it could exceed 100% by construction.
 *    New formula: all-time job_fee take / all-time recorded value
 *    (final_price_cents) of the same priced completed jobs (same cohort,
 *    subscriptions excluded). Bounded whenever booked job fees do not
 *    exceed the recorded job value; that is a data invariant, not
 *    something the SQL enforces.
 * 5. SLA — canonical breach source: the business-configured
 *    support_sla_targets table, materialized per conversation into
 *    support_conversations.sla_first_response_target /
 *    sla_resolution_target at creation time. The admin SLA dashboard
 *    (GET /support/sla) previously recomputed breach from hardcoded
 *    per-priority intervals; it now resolves each conversation's target as
 *    COALESCE(stored target, current configured target, legacy default).
 * 6. NPS — two domain metrics, each with a canonical source:
 *      support_nps_index: support_conversation_reviews (proper NPS index =
 *        %promoters − %detractors, already used by the support CSAT route).
 *      consulting_avg_nps: consulting_session_feedback (AVG of nps_score;
 *        the feedback_trends view aggregates consulting_session_followups'
 *        feedback_rating — a rating trend, NOT an NPS source — and must not
 *        be labeled NPS).
 * 7. MRR / ESCROW_HELD — previously hardcoded 0 on the super-admin
 *    dashboard. Now computed: MRR from active subscriptions × plan amount
 *    (yearly plans normalized /12); escrow held from payments with
 *    escrow_status IN ('held','disputed') AND status IN
 *    ('authorized','captured'), net of refunds.
 * 8. PERIODS — canonical map below ('1y' = '1 year'). investorController
 *    previously used '365 days'; normalized to the canonical map.
 */

// ── Canonical reporting periods ─────────────────────────────────────────────
// '1y' is '1 year' (calendar-year interval). investorController previously
// used '365 days'; both resolve to the same window in non-leap years, but a
// single map prevents the drift from recurring.
const PERIOD_INTERVAL = Object.freeze({
  '1d':  { interval: '1 day',   prev: '2 days',   trunc: 'hour'  },
  '7d':  { interval: '7 days',  prev: '14 days',  trunc: 'day'   },
  '30d': { interval: '30 days',  prev: '60 days',  trunc: 'day'   },
  '90d': { interval: '90 days',  prev: '180 days', trunc: 'week'  },
  '1y':  { interval: '1 year',   prev: '2 years',  trunc: 'month' },
});

function resolvePeriod(period) {
  return PERIOD_INTERVAL[period] ? period : '30d';
}

// ── Metric catalog ──────────────────────────────────────────────────────────
// name → { name, definition (canonical SQL), dimensions, owner, notes }
const METRICS = Object.freeze({
  ...Object.fromEntries(Object.entries(operationalMetrics).map(([name, def]) => [name,
    Object.freeze({ name, definition: def.definition, dimensions: [], owner: 'platform/operations' })])),
  open_disputes: Object.freeze({
    name: 'open_disputes',
    definition: "SELECT COUNT(*) FROM disputes WHERE status = 'open'",
    dimensions: [],
    owner: 'platform/disputes',
    notes: 'Canonical dispute record is the disputes table; matches the /admin/disputes default tab.',
  }),
  platform_revenue_cents: Object.freeze({
    name: 'platform_revenue_cents',
    definition: `SELECT COALESCE(SUM(amount_cents) FILTER (WHERE source_type IN ('job_fee','subscription') AND amount_cents > 0), 0) FROM platform_ledger`,
    dimensions: ['period'],
    owner: 'platform/finance',
    notes: 'Platform take only. Vertical GMVs (food, tools, consulting) are separate metrics.',
  }),
  investor_gmv_cents: Object.freeze({
    name: 'investor_gmv_cents',
    definition: `SUM(final_price_cents) of non-deleted completed jobs, grouped by currency; unpriced jobs reported separately`,
    dimensions: [],
    owner: 'platform/finance',
    notes: 'Recorded service value, not budget estimates or cash receipts. Missing final prices are reported, never estimated.',
  }),
  investor_take_rate_pct: Object.freeze({
    name: 'investor_take_rate_pct',
    definition: `100.0 * positive job_fee ledger entries linked to priced completed jobs / recorded value of the same jobs and currency`,
    dimensions: [],
    owner: 'platform/finance',
    notes: 'New formula excludes subscription take from the numerator (old formula could exceed 100% by construction).',
  }),
  cancel_rate_pct: Object.freeze({
    name: 'cancel_rate_pct',
    definition: `100.0 * COUNT(*) FILTER (WHERE status = 'cancelled') / NULLIF(COUNT(*), 0), restricted to the role cohort, deleted_at IS NULL`,
    dimensions: ['role: customer | helper | platform'],
    owner: 'platform/marketplace',
    notes: 'Server-side only. Customer360 no longer computes this client-side.',
  }),
  consulting_cancel_rate_pct: Object.freeze({
    name: 'consulting_cancel_rate_pct',
    definition: `cancelled / (completed + cancelled) over consulting_sessions`,
    dimensions: [],
    owner: 'platform/consulting',
    notes: 'Deliberately different denominator (consulting domain); registered separately, not merged.',
  }),
  sla_first_response_compliance_pct: Object.freeze({
    name: 'sla_first_response_compliance_pct',
    definition: 'met / eligible from support_conversations against business-configured support_sla_targets (stored per-conversation, else current configured, else legacy default)',
    dimensions: ['business', 'window_days'],
    owner: 'platform/support',
    notes: 'Replaces hardcoded per-priority intervals on the admin SLA dashboard.',
  }),
  support_nps_index: Object.freeze({
    name: 'support_nps_index',
    definition: `100.0 * (COUNT(nps_score >= 9) - COUNT(nps_score <= 6)) / NULLIF(COUNT(nps_score), 0) FROM support_conversation_reviews`,
    dimensions: ['business', 'window_days'],
    owner: 'platform/support',
    notes: 'Proper NPS index (promoters − detractors), not a raw average.',
  }),
  consulting_avg_nps: Object.freeze({
    name: 'consulting_avg_nps',
    definition: `AVG(nps_score) FROM consulting_session_feedback WHERE nps_score IS NOT NULL`,
    dimensions: [],
    owner: 'platform/consulting',
    notes: 'Canonical source is consulting_session_feedback. feedback_trends is a rating trend, not NPS.',
  }),
  mrr_cents: Object.freeze({
    name: 'mrr_cents',
    definition: `SUM(plan amount_cents, yearly plans /12) FROM subscriptions s JOIN plans p ON p.id = s.plan_id WHERE s.status = 'active'`,
    dimensions: [],
    owner: 'platform/finance',
    notes: 'Replaces the hardcoded 0 on the super-admin dashboard.',
  }),
  escrow_held_cents: Object.freeze({
    name: 'escrow_held_cents',
    definition: `SUM(net held cents) FROM payments WHERE escrow_status IN ('held','disputed') AND status IN ('authorized','captured')`,
    dimensions: [],
    owner: 'platform/finance',
    notes: 'Replaces the hardcoded 0 on the super-admin dashboard. Net of refunds, floored at 0 per payment.',
  }),
  business_invoice_revenue: Object.freeze({
    name: 'business_invoice_revenue',
    definition: `SUM(total) FROM business_invoices WHERE business_id = $1 AND status = 'paid' AND paid_at >= NOW() - INTERVAL '6 months', grouped by month`,
    dimensions: ['business_id', 'month'],
    owner: 'business/finance',
    notes: 'Canonical business revenue from invoices. Implemented in server/analytics/businessOverviewAnalytics.js (INVOICE_REVENUE_SQL); the invoice-revenue drill-through view (businessInvoiceAnalytics) is the same source filtered by currency/period.',
  }),
  business_job_payout_revenue: Object.freeze({
    name: 'business_job_payout_revenue',
    definition: `SUM(helper_payout) FROM payments WHERE payee_id = $1 AND status = 'captured' AND COALESCE(captured_at, released_at) >= NOW() - INTERVAL '6 months', grouped by month`,
    dimensions: ['business_id (primary)', 'month'],
    owner: 'business/finance',
    notes: 'OxSteed job income; primary business only (payee is the business owner). Merged with invoice revenue for the overview monthly series.',
  }),
  business_expense_total: Object.freeze({
    name: 'business_expense_total',
    definition: `SUM(amount) FROM expenses WHERE business_id = $1 AND type = 'expense' AND occurred_at >= CURRENT_DATE - INTERVAL '6 months', grouped by month`,
    dimensions: ['business_id', 'month'],
    owner: 'business/finance',
    notes: 'Business-tagged expenses only; personal expenses excluded by the type/business_id filter.',
  }),
  business_job_stats_6m: Object.freeze({
    name: 'business_job_stats_6m',
    definition: `COUNT(*), AVG(helper_payout), MAX(helper_payout) FROM payments WHERE payee_id = $1 AND status = 'captured' AND COALESCE(captured_at, released_at) >= NOW() - INTERVAL '6 months'`,
    dimensions: ['business_id (primary)'],
    owner: 'business/finance',
    notes: 'Primary business only. Cancelled/refunded payments excluded by the captured status filter.',
  }),
  business_invoice_outstanding: Object.freeze({
    name: 'business_invoice_outstanding',
    definition: `SUM(total - amount_paid) FILTER (WHERE status IN ('sent','overdue')), and the overdue slice, plus per-status counts, FROM business_invoices WHERE business_id = $1`,
    dimensions: ['business_id'],
    owner: 'business/finance',
    notes: 'Outstanding = unpaid balance on sent and overdue invoices; drafts and paid invoices excluded.',
  }),
  promo_discount_cents: Object.freeze({
    name: 'promo_discount_cents',
    definition: `SUM(discount_cents) FROM promo_redemptions WHERE status = 'redeemed' AND redeemed_at in the period, grouped by currency`,
    dimensions: ['period'],
    owner: 'platform/growth',
    notes: 'Checkout promo codes (decision 2). Reserved and reversed (refunded/cancelled) redemptions are excluded; platform_funded_cents splits jobs/bookings from restaurant-funded food.',
  }),
  // Growth engine metrics (Demand & Sales Engine spec 21.1). Executable SQL
  // lives in queryBuilder.js (buildGrowthMetric) and financialMetrics.js;
  // permissions are enforced through metricAccess.js METRIC_PERMISSIONS.
  growth_campaign_recipients: Object.freeze({
    name: 'growth_campaign_recipients',
    definition: `COUNT(DISTINCT user_id) over offer_campaign_recipients joined to offer_campaign_deliveries with at least one delivery status 'sent' in the period`,
    dimensions: [],
    owner: 'platform/growth',
    notes: 'Permission view_growth_insights. Region anchor: recipient user address.',
  }),
  growth_offer_ctr_pct: Object.freeze({
    name: 'growth_offer_ctr_pct',
    definition: `100.0 * distinct recipients with an offer_clicks row on a sent delivery / distinct recipients of a sent delivery in the period`,
    dimensions: [],
    owner: 'platform/growth',
    notes: 'Permission view_growth_insights. Region anchor: recipient user address (via delivery).',
  }),
  growth_offer_optout_rate_pct: Object.freeze({
    name: 'growth_offer_optout_rate_pct',
    definition: `100.0 * distinct delivered recipients whose offer_preferences turned offer_push or offer_in_app off within 48h after a sent delivery / distinct delivered recipients in the period`,
    dimensions: [],
    owner: 'platform/growth',
    notes: 'Permission view_growth_insights. offer_preferences keeps only the latest preference state, so the 48h window is evaluated against its updated_at; a preference change for another reason inside the window counts. Region anchor: recipient user address.',
  }),
  growth_push_open_rate_pct: Object.freeze({
    name: 'growth_push_open_rate_pct',
    definition: `100.0 * push deliveries with opened_at set / push deliveries sent in the period`,
    dimensions: [],
    owner: 'platform/growth',
    notes: 'Permission view_growth_insights. Web and updated native apps only; partial until the app update is adopted. Region anchor: recipient user address (via delivery).',
  }),
  growth_affiliate_commission_cents: Object.freeze({
    name: 'growth_affiliate_commission_cents',
    definition: `SUM(commission_minor) for affiliate_conversions status approved/paid minus SUM(commission_minor) for status reversed in the period, grouped by currency; assisted conversions excluded (spec 13.1)`,
    dimensions: [],
    owner: 'platform/growth',
    notes: 'Permission view_financials (money metric). Region anchor: recipient user via click -> delivery -> recipient. Conversion rows are mutated in place on reversal, so a conversion approved and reversed inside one created_at window nets negative in that window rather than cancelling across windows.',
  }),
  growth_promo_redeemed_cents: Object.freeze({
    name: 'growth_promo_redeemed_cents',
    definition: `SUM(discount_cents) FROM promo_redemptions joined to discount_codes with offer_campaign_id set, status redeemed, redeemed_at in the period, grouped by currency`,
    dimensions: [],
    owner: 'platform/growth',
    notes: 'Permission view_financials (money metric). Campaign codes only; the all-codes total is promo_discount_cents. Region anchor: existing promo anchors.',
  }),
  demand_unfilled_rate_pct: Object.freeze({
    name: 'demand_unfilled_rate_pct',
    definition: `100.0 * jobs published in the period that have since expired unfilled (expires_at passed, accepted_at IS NULL, still in an unfilled status) / jobs published in the period`,
    dimensions: [],
    owner: 'platform/growth',
    notes: 'Permission view_growth_insights. Lagging measure: recent cohorts understate because their jobs have not expired yet. Region anchor: job location (postal).',
  }),
  demand_gap_index: Object.freeze({
    name: 'demand_gap_index',
    definition: `Median over active cells (postal_ref x intent with exact 28-day distinct demand >= 5) of demand / (supply + 1), exact distinct people from demand_subject_daily / supply_subject_daily over the trailing 28 days`,
    dimensions: [],
    owner: 'platform/growth',
    notes: 'Permission view_growth_insights. Trailing 28-day window is part of the definition (period accepted, window fixed). The admin heatmap applies empirical-Bayes smoothing on top; this governed value is the unsmoothed median. Region anchor: postal centroid.',
  }),
  // Restaurant-scoped metrics (Phase 2, Item 10). The registry holds the
  // canonical DEFINITION; the computation lives exactly once in
  // server/analytics/restaurantAnalytics.js (never inline in controllers).
  restaurant_repeat_order_rate: Object.freeze({
    name: 'restaurant_repeat_order_rate',
    definition: `repeat_orders / total_identified_orders FROM food_orders
      WHERE restaurant_id = $1 AND created_at in window
      AND status NOT IN ('cancelled','refunded') AND customer_id IS NOT NULL;
      repeat_orders = orders whose customer_id has COUNT(*) > 1 in the same window.
      Default window: last 90 days. NULL (not 0) when no identified orders.`,
    dimensions: ['restaurant_id', 'window'],
    owner: 'restaurant/analytics',
    notes: 'Guest orders (customer_id NULL) are excluded from numerator and denominator; reported separately as guest_orders_excluded.',
  }),
  restaurant_top_items_revenue: Object.freeze({
    name: 'restaurant_top_items_revenue',
    definition: `SUM(food_order_items.line_total_cents) per menu_item_id
      over non-cancelled/non-refunded in-window food_orders, top 10 by revenue.`,
    dimensions: ['restaurant_id', 'window'],
    owner: 'restaurant/analytics',
    notes: 'Grouped by menu_item_id (stable across renames); deleted menu rows fall back to the item_name snapshot on the order line.',
  }),
});

function getMetric(name) {
  const m = METRICS[name];
  if (!m) throw new Error(`Unknown metric: ${name}`);
  return m;
}

// ── Platform revenue source types (single source of truth) ──────────────────
const PLATFORM_REVENUE_SOURCE_TYPES = Object.freeze(['job_fee', 'subscription']);

// ── 1. Open disputes ────────────────────────────────────────────────────────
async function openDisputes(db) {
  const { rows } = await db.query(
    `SELECT COUNT(*)::INT AS value FROM disputes WHERE status = 'open'`
  );
  return parseInt(rows[0]?.value, 10) || 0;
}

// ── 2. Platform revenue ─────────────────────────────────────────────────────
// Canonical platform take. Controllers aggregate several windows in one
// query; this returns the shared totals shape.
async function platformRevenue(db, interval, currencyCode = 'USD') {
  const { rows } = await db.query(`
    SELECT
      COALESCE(SUM(amount_cents) FILTER (WHERE source_type = ANY($2) AND amount_cents > 0), 0)::BIGINT                                             AS total_cents,
      COALESCE(SUM(amount_cents) FILTER (WHERE source_type = ANY($2) AND amount_cents > 0 AND created_at >= now() - $1::interval), 0)::BIGINT       AS period_cents,
      COALESCE(SUM(amount_cents) FILTER (WHERE source_type = 'subscription' AND amount_cents > 0 AND created_at >= now() - $1::interval), 0)::BIGINT AS subscription_period_cents,
      COALESCE(SUM(amount_cents) FILTER (WHERE source_type = ANY($2) AND amount_cents > 0 AND created_at >= date_trunc('month', now())), 0)::BIGINT AS mtd_cents,
      COALESCE(SUM(amount_cents) FILTER (WHERE source_type = ANY($2) AND amount_cents > 0 AND created_at >= now() - ($1::interval * 2) AND created_at < now() - $1::interval),0)::BIGINT AS prev_cents,
      COALESCE(SUM(amount_cents) FILTER (WHERE source_type = 'subscription' AND amount_cents > 0 AND created_at >= date_trunc('month',now())),0)::BIGINT AS subscription_mtd_cents,
      COALESCE(SUM(ABS(amount_cents)) FILTER (WHERE source_type = 'refund' AND created_at >= now() - $1::interval), 0)::BIGINT                        AS refunds_period_cents
    FROM platform_ledger WHERE UPPER(currency) = UPPER($3)
  `, [interval, PLATFORM_REVENUE_SOURCE_TYPES, currencyCode]);
  const r = rows[0] || {};
  const toInt = exactInteger;
  return {
    currency_code: currencyCode.toUpperCase(),
    prev_cents: toInt(r.prev_cents),
    subscription_mtd_cents: toInt(r.subscription_mtd_cents),
    total_cents: toInt(r.total_cents),
    period_cents: toInt(r.period_cents),
    subscription_period_cents: toInt(r.subscription_period_cents),
    mtd_cents: toInt(r.mtd_cents),
    refunds_period_cents: toInt(r.refunds_period_cents),
  };
}

// ── 2b. Financial-management ledger totals (single source of truth) ─────────
// The Financial Management surface previously summed platform_ledger rows
// across ALL currencies into single "revenue" figures, and labeled two
// different sums "revenue" alongside platform take:
//   - gross: every positive ledger inflow, any source_type (job_fee,
//     subscription, service_booking, credit_rail, transaction, ...). This is
//     NOT platform take: it includes money that merely passes through.
//   - net: SUM of all ledger amounts, positives and negatives together.
//     Refunds and other negative rows reduce it; it is a ledger movement
//     total, not revenue.
// Canonical platform take is platformRevenue above (job_fee + subscription,
// positive only). These totals exist only as a labeled ledger summary, and
// they are ALWAYS per currency: summing cents across currencies is
// meaningless (see RV1(a) and restaurantHQ's multi-currency null), so the
// caller passes one currency (the Financial Management page formats USD).
// Refunds here match platformRevenue: ABS of source_type='refund' rows.
// A negative row of any other source_type is not a refund and is not
// counted as one; it still reduces net_cents.
async function ledgerFinancialTotals(db, currencyCode = 'USD') {
  const { rows } = await db.query(`
    SELECT
      COALESCE(SUM(CASE WHEN amount_cents > 0 THEN amount_cents ELSE 0 END), 0) AS gross_cents,
      COALESCE(SUM(CASE WHEN source_type = 'job_fee' AND amount_cents > 0 THEN amount_cents ELSE 0 END), 0) AS job_fee_cents,
      COALESCE(SUM(CASE WHEN source_type = 'subscription' AND amount_cents > 0 THEN amount_cents ELSE 0 END), 0) AS subscription_cents,
      COALESCE(SUM(CASE WHEN source_type = 'refund' THEN ABS(amount_cents) ELSE 0 END), 0) AS refunds_cents,
      COALESCE(SUM(amount_cents), 0) AS net_cents
    FROM platform_ledger WHERE UPPER(currency) = UPPER($1)
  `, [currencyCode]);
  const r = rows[0] || {};
  const toInt = exactInteger;
  return {
    currency_code: String(currencyCode).toUpperCase(),
    gross_cents: toInt(r.gross_cents),
    job_fee_cents: toInt(r.job_fee_cents),
    subscription_cents: toInt(r.subscription_cents),
    refunds_cents: toInt(r.refunds_cents),
    net_cents: toInt(r.net_cents),
  };
}

// ── 3. Cancel rate ──────────────────────────────────────────────────────────
// Canonical per-role cancel rate, server-side, soft-deletes excluded
// (deleted_at IS NULL, matching migration 170's materialized views).
const CANCEL_ROLES = Object.freeze(['customer', 'helper', 'platform']);

async function cancelRate(db, { role = 'platform', userId = null } = {}) {
  if (!CANCEL_ROLES.includes(role)) throw new Error(`Unknown cancel-rate role: ${role}`);
  if (role !== 'platform' && !userId) throw new Error('cancelRate requires userId for customer/helper roles');
  const cohort = role === 'customer'
    ? 'client_id = $1::UUID'
    : role === 'helper'
      ? 'assigned_helper_id = $1::UUID'
      : 'TRUE';
  const params = role === 'platform' ? [] : [userId];
  const { rows } = await db.query(`
    SELECT ROUND(
      100.0 * COUNT(*) FILTER (WHERE status = 'cancelled') / NULLIF(COUNT(*), 0),
      1
    ) AS rate_pct
    FROM jobs
    WHERE deleted_at IS NULL AND ${cohort}
  `, params);
  const v = rows[0]?.rate_pct;
  return v == null ? null : parseFloat(v);
}

// Cancel-rate risk bands (migration 170's thresholds, defined once).
// 'reliable' < 5, 'caution' < 15, 'warning' < 30, else 'high_risk'.
// Zero recorded cancellations is always 'reliable' (matches the MV queries).
const CANCEL_RISK_THRESHOLDS = Object.freeze({ reliable: 5, caution: 15, warning: 30 });

function cancelRiskLevel(ratePct, cancellationsTotal = null) {
  if (cancellationsTotal === 0) return 'reliable';
  const r = Number(ratePct);
  if (!Number.isFinite(r)) return 'reliable';
  if (r < CANCEL_RISK_THRESHOLDS.reliable) return 'reliable';
  if (r < CANCEL_RISK_THRESHOLDS.caution) return 'caution';
  if (r < CANCEL_RISK_THRESHOLDS.warning) return 'warning';
  return 'high_risk';
}

// SQL CASE fragment for the risk band, referencing the thresholds above.
function cancelRiskLevelCaseSql(rateExpr, cancellationsExpr) {
  const t = CANCEL_RISK_THRESHOLDS;
  return `CASE
    WHEN (${cancellationsExpr}) = 0 THEN 'reliable'
    WHEN (${rateExpr}) < ${t.reliable} THEN 'reliable'
    WHEN (${rateExpr}) < ${t.caution} THEN 'caution'
    WHEN (${rateExpr}) < ${t.warning} THEN 'warning'
    ELSE 'high_risk'
  END`;
}

// ── 4. Investor take-rate ────────────────────────────────────────────────────
// NEW formula: all-time job_fee take ÷ all-time recorded job value
// (final_price_cents of priced, non-deleted completed jobs), rounded to 2dp,
// NULL when GMV is 0. Subscriptions are deliberately excluded from the
// numerator — they are recurring revenue unrelated to job GMV, and including
// them let the old formula exceed 100% by construction.
// KNOWN LIMITATION: jobs with no final price are excluded from both the
// numerator cohort and the denominator (reported as unpriced elsewhere),
// never estimated from budgets.
async function investorTakeRatePct(db, currencyCode = 'USD') {
  const value = await financialMetricValue(db, 'investor_take_rate_pct', currencyCode);
  return value == null ? null : Number(value);
}

// ── 5. SLA targets ──────────────────────────────────────────────────────────
// Resolve a conversation's first-response / resolution target timestamp from
// the business-configured support_sla_targets table, with fallbacks:
//   1. the per-conversation target stored at creation time (targets in effect
//      when the conversation was created),
//   2. the business's currently configured target for that priority,
//   3. the legacy hardcoded default (preserves old behavior where no target
//      was ever configured).
// convAlias: alias of support_conversations; tgtAlias: alias of the
// support_sla_targets join produced by slaTargetsJoinSql().
const LEGACY_FIRST_RESPONSE_INTERVAL = Object.freeze({
  urgent: "INTERVAL '15 minutes'",
  high: "INTERVAL '1 hour'",
  low: "INTERVAL '24 hours'",
  normal: "INTERVAL '4 hours'",
});
const LEGACY_RESOLUTION_INTERVAL = Object.freeze({
  urgent: "INTERVAL '12 hours'",
  high: "INTERVAL '24 hours'",
  low: "INTERVAL '96 hours'",
  normal: "INTERVAL '48 hours'",
});

function legacyIntervalCase(priorityExpr, table) {
  const t = table === 'resolution' ? LEGACY_RESOLUTION_INTERVAL : LEGACY_FIRST_RESPONSE_INTERVAL;
  return `(CASE LOWER(COALESCE(${priorityExpr}, 'normal'))
    WHEN 'urgent' THEN ${t.urgent}
    WHEN 'high' THEN ${t.high}
    WHEN 'low' THEN ${t.low}
    ELSE ${t.normal}
  END)`;
}

function slaTargetsJoinSql(convAlias = 'sc', tgtAlias = 'sla_tgt') {
  return `LEFT JOIN support_sla_targets ${tgtAlias}
    ON ${tgtAlias}.business_id = ${convAlias}.business_id
    AND ${tgtAlias}.priority = LOWER(COALESCE(${convAlias}.priority, 'normal'))
    AND COALESCE(${tgtAlias}.active, TRUE) = TRUE`;
}

function slaFirstResponseTargetSql(convAlias = 'sc', tgtAlias = 'sla_tgt') {
  return `COALESCE(
    ${convAlias}.sla_first_response_target,
    ${convAlias}.created_at + (${tgtAlias}.first_response_target_minutes * INTERVAL '1 minute'),
    ${convAlias}.created_at + ${legacyIntervalCase(`${convAlias}.priority`, 'first_response')}
  )`;
}

function slaResolutionTargetSql(convAlias = 'sc', tgtAlias = 'sla_tgt') {
  return `COALESCE(
    ${convAlias}.sla_resolution_target,
    ${convAlias}.created_at + (${tgtAlias}.resolution_target_hours * INTERVAL '1 hour'),
    ${convAlias}.created_at + ${legacyIntervalCase(`${convAlias}.priority`, 'resolution')}
  )`;
}

// ── 6. NPS ──────────────────────────────────────────────────────────────────
async function supportNpsIndex(db, { businessId = null, days = 30 } = {}) {
  const boundedDays = Math.min(365, Math.max(1, parseInt(days, 10) || 30));
  const { rows } = await db.query(`
    SELECT ROUND(100.0 * (
      COUNT(*) FILTER (WHERE scr.nps_score >= 9)
      - COUNT(*) FILTER (WHERE scr.nps_score <= 6)
    ) / NULLIF(COUNT(scr.nps_score), 0), 1)::FLOAT AS nps_index,
    COUNT(scr.nps_score)::INT AS responses
    FROM support_conversation_reviews scr
    JOIN support_conversations sc ON sc.id = scr.conversation_id
    WHERE scr.nps_score IS NOT NULL
      AND scr.created_at >= NOW() - ($1 || ' days')::INTERVAL AND scr.created_at < NOW()
      AND ($2::INTEGER IS NULL OR sc.business_id = $2::INTEGER)
  `, [String(boundedDays), businessId]);
  const r = rows[0] || {};
  return {
    nps_index: r.nps_index == null ? null : parseFloat(r.nps_index),
    responses: parseInt(r.responses, 10) || 0,
  };
}

async function consultingAvgNps(db) {
  const { rows } = await db.query(
    `SELECT AVG(nps_score)::FLOAT AS avg_nps, COUNT(*)::INT AS responses
     FROM consulting_session_feedback WHERE nps_score IS NOT NULL`
  );
  const r = rows[0] || {};
  return {
    avg_nps: r.avg_nps == null ? null : parseFloat(r.avg_nps),
    responses: parseInt(r.responses, 10) || 0,
  };
}

// ── 7. MRR and escrow held ──────────────────────────────────────────────────
async function investorGmvCents(db, currencyCode = 'USD') {
  return exactInteger(await financialMetricValue(db, 'investor_gmv_cents', currencyCode));
}

async function mrrCents(db, currencyCode = 'USD') {
  return exactInteger(await financialMetricValue(db, 'mrr_cents', currencyCode));
}

async function escrowHeldCents(db, currencyCode = 'USD') {
  return exactInteger(await financialMetricValue(db, 'escrow_held_cents', currencyCode));
}

module.exports = {
  PERIOD_INTERVAL,
  resolvePeriod,
  METRICS,
  getMetric,
  PLATFORM_REVENUE_SOURCE_TYPES,
  LEGACY_FIRST_RESPONSE_INTERVAL,
  LEGACY_RESOLUTION_INTERVAL,
  openDisputes,
  platformRevenue,
  ledgerFinancialTotals,
  cancelRate,
  CANCEL_ROLES,
  CANCEL_RISK_THRESHOLDS,
  cancelRiskLevel,
  cancelRiskLevelCaseSql,
  investorTakeRatePct,
  investorGmvCents,
  slaTargetsJoinSql,
  slaFirstResponseTargetSql,
  slaResolutionTargetSql,
  supportNpsIndex,
  consultingAvgNps,
  mrrCents,
  escrowHeldCents,
};
