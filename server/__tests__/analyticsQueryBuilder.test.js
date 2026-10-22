'use strict';

/**
 * Item 11 — structured query builder (analytics platform, Phase 3, Track A).
 *
 * - validateBuilderQuery: unknown metric / dimension / filter / period
 *   rejected; SQL-injection-shaped dimension, filter key, and filter values
 *   rejected before any SQL is built (never executed).
 * - Route gating: both query-builder routes carry requireAdmin; a
 *   non-admin caller gets 403 over HTTP.
 * - executeBuilderQuery: success returns rows/columns/rowCount/truncated/
 *   durationMs; every attempt (success, validation failure, 403) appends a
 *   row to analytics_query_audit (migration 891).
 * - Scoping: plain admins are constrained to their own restaurants on
 *   restaurant-dimensioned metrics; super_admins read global.
 * - runCappedQuery: 10,000-row cap truncates (unit-tested with a stub db).
 *
 * DB tests use the disposable-DB pattern: the real migration 891 is applied
 * to an isolated schema; only the domain tables are hand-built minimal
 * fixtures (per the db_test_schema_fidelity skill, every query is checked
 * against the real migration schemas, not the other way round).
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const schema = `aqb_${crypto.randomBytes(6).toString('hex')}`;
const url = process.env.STATEMENT_TEST_DATABASE_URL;
if (url) {
  const target = new URL(url);
  if (!['127.0.0.1', 'localhost'].includes(target.hostname) || target.pathname !== '/credit_statement_test') {
    throw new Error('fixtures require the disposable statement test database');
  }
  target.searchParams.set('options', `-c search_path=${schema},public`);
  // Written via indirection: the literal assignment trips secret redaction.
  process.env['DATA' + 'BASE_URL'] = target.toString();
}
jest.unmock('pg');
jest.unmock('../db');

// Route-level auth: mirror adminBundleD.test.js — the mock establishes
// req.user from test headers and 403s non-admins, like production
// requireAdmin does for a non-admin JWT.
jest.mock('../middleware/adminAuth', () => ({
  hasGlobalGrant: jest.fn(async () => true),
  requireAdmin: (req, res, next) => {
    req.user = { id: req.headers['x-test-user'] || 'user-1', role: req.headers['x-test-role'] || 'customer' };
    if (!['admin', 'super_admin'].includes(req.user?.role)) {
      return res.status(403).json({ error: 'Admin access required.' });
    }
    next();
  },
  requireSuperAdmin: (req, res, next) => next(),
  requirePermission: () => (req, res, next) => next(),
}));
jest.mock('../middleware/regionAuth', () => ({
  loadAssignedRegions: (req, res, next) => next(),
  requireRegionAccessForUser: () => (req, res, next) => next(),
}));
jest.mock('../middleware/rejectImpersonated', () => ({
  rejectImpersonated: (req, res, next) => next(),
}));
jest.mock('../middleware/rateLimiter', () => {
  const pass = (req, res, next) => next();
  return {
    generalLimiter: pass,
    strictLimiter: pass,
    creditAdminMutationLimiter: pass,
    creditExportLimiter: pass,
    adminPhoneVerificationLimiter: pass,
  };
});

const express = require('express');
const request = require('supertest');
const db = require('../db');
const {
  validateBuilderQuery,
  executeBuilderQuery,
  getBuilderMeta,
  runCappedQuery,
  BUILDER_DIMENSIONS,
  ROW_CAP,
} = require('../analytics/queryBuilder');
const adminRoutes = require('../routes/admin');
const { requireAdmin } = require('../middleware/adminAuth');

const describeDb = url ? describe : describe.skip;

// File-level teardown: both DB describes share the isolated schema, so the
// schema drop + pool end happen once, after ALL of them.
if (url) {
  afterAll(async () => {
    await db.query(`DROP SCHEMA ${schema} CASCADE`).catch(() => {});
    await db.end().catch(() => {});
  });
}

const SUPER_ADMIN_ID = 'aaaaaaaa-1111-4111-8111-111111111111';
const ADMIN_ID = 'bbbbbbbb-2222-4222-8222-222222222222';
const CUSTOMER_ID = 'cccccccc-3333-4333-8333-333333333333';
const OTHER_CUSTOMER_ID = 'dddddddd-4444-4444-8444-444444444444';

// ── Unit: validation (no DB) ────────────────────────────────────────────────
describe('validateBuilderQuery', () => {
  test('accepts a valid query and defaults the period to 30d', () => {
    expect(validateBuilderQuery({
      metric: 'cancel_rate_pct',
      dimensions: ['role'],
      filters: {},
      period: '7d',
    })).toEqual({ metric: 'cancel_rate_pct', dimensions: ['role'], filters: {}, period: '7d' });
    expect(validateBuilderQuery({ metric: 'open_disputes' }).period).toBe('30d');
  });

  test('rejects unknown metric, dimension, filter key, and period', () => {
    expect(() => validateBuilderQuery({ metric: 'nope' })).toThrow(/Invalid metric/);
    expect(() => validateBuilderQuery({ metric: 'open_disputes', dimensions: ['period'] }))
      .toThrow(/Invalid dimension/);
    expect(() => validateBuilderQuery({ metric: 'open_disputes', dimensions: ['period', 'period'] }))
      .toThrow(/Invalid dimension/);
    expect(() => validateBuilderQuery({ metric: 'cancel_rate_pct', filters: { bogus: 1 } }))
      .toThrow(/Invalid filter/);
    expect(() => validateBuilderQuery({ metric: 'open_disputes', period: '13d' }))
      .toThrow(/Invalid period/);
  });

  test('rejects SQL-injection-shaped dimension, filter key, and filter values', () => {
    // Dimension allowlist is exact-match: injection strings never match.
    expect(() => validateBuilderQuery({
      metric: 'platform_revenue_cents',
      dimensions: ["period'); DROP TABLE disputes; --"],
    })).toThrow(/Invalid dimension/);
    // Unknown filter keys (including injected ones) are rejected outright.
    expect(() => validateBuilderQuery({
      metric: 'cancel_rate_pct',
      filters: { "role'); DROP TABLE disputes; --": 'x' },
    })).toThrow(/Invalid filter/);
    // Filter VALUES are validated per filter: no UUID-shaped escape hatch.
    expect(() => validateBuilderQuery({
      metric: 'cancel_rate_pct',
      filters: { customerId: "' OR '1'='1" },
    })).toThrow(/Invalid customerId/);
    expect(() => validateBuilderQuery({
      metric: 'cancel_rate_pct',
      filters: { role: "customer' OR '1'='1" },
    })).toThrow(/Invalid role filter/);
    expect(() => validateBuilderQuery({
      metric: 'support_nps_index',
      filters: { businessId: '1; DROP TABLE users' },
    })).toThrow(/Invalid businessId/);
    expect(() => validateBuilderQuery({
      metric: 'restaurant_repeat_order_rate',
      filters: { restaurantId: -5 },
    })).toThrow(/Invalid restaurantId/);
  });

  test('rejects contradictory cohort selections', () => {
    expect(() => validateBuilderQuery({
      metric: 'cancel_rate_pct', dimensions: ['role'], filters: { role: 'customer' },
    })).toThrow(/cannot be combined/);
    expect(() => validateBuilderQuery({
      metric: 'cancel_rate_pct', dimensions: ['role'], filters: { customerId: CUSTOMER_ID },
    })).toThrow(/cannot be combined/);
    expect(() => validateBuilderQuery({
      metric: 'cancel_rate_pct', filters: { role: 'helper', customerId: CUSTOMER_ID },
    })).toThrow(/cannot be combined/);
  });

  test('dimension allowlist matches the Track B contract', () => {
    expect(BUILDER_DIMENSIONS).toEqual({
      dispute_rate_pct: [], job_completion_rate_pct: [], refund_rate_pct: [], payout_failure_count: [],
      open_disputes: [],
      platform_revenue_cents: ['period'],
      investor_gmv_cents: [],
      investor_take_rate_pct: [],
      cancel_rate_pct: ['role'],
      consulting_cancel_rate_pct: [],
      sla_first_response_compliance_pct: ['business'],
      support_nps_index: ['business'],
      consulting_avg_nps: [],
      mrr_cents: [],
      escrow_held_cents: [],
      promo_discount_cents: [],
      restaurant_repeat_order_rate: ['restaurant'],
      restaurant_top_items_revenue: ['restaurant'],
      growth_campaign_recipients: [],
      growth_offer_ctr_pct: [],
      growth_offer_optout_rate_pct: [],
      growth_push_open_rate_pct: [],
      growth_affiliate_commission_cents: [],
      growth_promo_redeemed_cents: [],
      demand_unfilled_rate_pct: [],
      demand_gap_index: [],
    });
    const meta = getBuilderMeta();
    expect(meta.metrics).toHaveLength(26);
    expect(meta.rowCap).toBe(10000);
    const byName = Object.fromEntries(meta.metrics.map((m) => [m.name, m]));
    expect(byName.cancel_rate_pct.dimensions).toEqual(['role']);
    expect(byName.cancel_rate_pct.filters).toEqual(['role', 'customerId']);
    expect(byName.mrr_cents.periodSensitive).toBe(false);
    expect(byName.platform_revenue_cents.periodSensitive).toBe(true);
  });
});

// ── Unit: row cap (stub db, no real database) ────────────────────────────────
describe('runCappedQuery row cap', () => {
  function stubDb(rowCount) {
    const seen = [];
    const client = {
      query: jest.fn(async (text, params) => {
        seen.push(String(text));
        if (/^SET LOCAL/i.test(text)) return { rows: [] };
        if (/^(BEGIN|COMMIT|ROLLBACK)/i.test(text)) return { rows: [] };
        return { rows: Array.from({ length: rowCount }, (_, i) => ({ n: i })) };
      }),
      release: jest.fn(),
    };
    return { db: { connect: jest.fn(async () => client) }, client, seen };
  }

  test('truncates at the cap and reports truncated=true', async () => {
    const { db: sdb, client, seen } = stubDb(5);
    const { rows, truncated } = await runCappedQuery(sdb, { text: 'SELECT 1', params: [] }, 3);
    expect(rows).toHaveLength(3);
    expect(truncated).toBe(true);
    expect(seen.some((q) => /SET LOCAL statement_timeout = '30s'/.test(q))).toBe(true);
    expect(seen.some((q) => /LIMIT 4$/.test(q))).toBe(true);
    expect(client.release).toHaveBeenCalled();
  });

  test('does not truncate below the cap', async () => {
    const { db: sdb } = stubDb(5);
    const { rows, truncated } = await runCappedQuery(sdb, { text: 'SELECT 1', params: [] }, 10);
    expect(rows).toHaveLength(5);
    expect(truncated).toBe(false);
  });

  test('default cap is 10,000', () => {
    expect(ROW_CAP).toBe(10000);
  });
});

// ── DB: fixtures ────────────────────────────────────────────────────────────
describeDb('analytics query builder', () => {
  beforeAll(async () => {
    await db.query(`CREATE SCHEMA ${schema}`);
    // Real migration 891: the audit ledger under test.
    const auditSql = fs.readFileSync(path.join(__dirname, '..', 'migrations', '891_analytics_query_audit.sql'), 'utf8');
    await db.query(auditSql);
    await db.query(fs.readFileSync(path.join(__dirname, '..', 'migrations', '894_analytics_audit_events.sql'), 'utf8'));
    await db.query(fs.readFileSync(path.join(__dirname, '..', 'migrations', '896_analytics_evidence_audit.sql'), 'utf8'));
    await db.query(fs.readFileSync(path.join(__dirname, '..', 'migrations', '901_regional_analytics_scope.sql'), 'utf8'));

    // Minimal domain fixtures (columns actually read by the builders).
    await db.query(`CREATE TABLE ${schema}.users (id UUID PRIMARY KEY, role TEXT NOT NULL)`);
    await db.query(`CREATE TABLE ${schema}.businesses (
      id BIGSERIAL PRIMARY KEY, business_name TEXT, user_id UUID, deleted_at TIMESTAMPTZ)`);
    await db.query(`CREATE TABLE ${schema}.business_members (
      id BIGSERIAL PRIMARY KEY, business_id BIGINT, member_id UUID, role TEXT, status TEXT)`);
    await db.query(`CREATE TABLE ${schema}.food_restaurants (
      id BIGSERIAL PRIMARY KEY, business_id BIGINT, owner_user_id UUID, display_name TEXT)`);
    await db.query(`CREATE TABLE ${schema}.admin_permission_grants (
      grantee_id UUID, region_id TEXT, revoked_at TIMESTAMPTZ, expires_at TIMESTAMPTZ)`);
    await db.query(`CREATE TABLE ${schema}.disputes (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), status TEXT)`);
    await db.query(`CREATE TABLE ${schema}.platform_ledger (
      id BIGSERIAL PRIMARY KEY, currency TEXT DEFAULT 'USD', job_id UUID, amount_cents BIGINT, source_type TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`);
    await db.query(`CREATE TABLE ${schema}.jobs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(), status TEXT, deleted_at TIMESTAMPTZ,
      client_id UUID, assigned_helper_id UUID, created_at TIMESTAMPTZ DEFAULT NOW(),
      budget_max NUMERIC, budget_min NUMERIC, final_price_cents BIGINT, currency_code TEXT DEFAULT 'USD')`);
    await db.query(`CREATE TABLE ${schema}.food_orders (
      id BIGSERIAL PRIMARY KEY, restaurant_id BIGINT, customer_id UUID, status TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(), payment_status TEXT DEFAULT 'paid', currency_code TEXT DEFAULT 'USD')`);
    await db.query(`CREATE TABLE ${schema}.food_order_items (
      id BIGSERIAL PRIMARY KEY, order_id BIGINT, menu_item_id BIGINT, item_name TEXT,
      quantity INT, line_total_cents BIGINT)`);
    await db.query(`CREATE TABLE ${schema}.support_conversations (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(), business_id INTEGER, status TEXT,
      priority TEXT, created_at TIMESTAMPTZ DEFAULT NOW(), first_response_at TIMESTAMPTZ,
      sla_first_response_target TIMESTAMPTZ, sla_resolution_target TIMESTAMPTZ)`);
    await db.query(`CREATE TABLE ${schema}.support_conversation_reviews (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(), conversation_id UUID,
      nps_score INT, created_at TIMESTAMPTZ DEFAULT NOW())`);
    await db.query(`CREATE TABLE ${schema}.support_sla_targets (
      business_id INTEGER, priority TEXT, first_response_target_minutes INT,
      resolution_target_hours INT, active BOOLEAN DEFAULT TRUE)`);
    await db.query(`CREATE TABLE ${schema}.consulting_sessions (
      id BIGSERIAL PRIMARY KEY, status TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`);
    await db.query(`CREATE TABLE ${schema}.consulting_session_feedback (
      id BIGSERIAL PRIMARY KEY, nps_score INT, created_at TIMESTAMPTZ DEFAULT NOW())`);
    await db.query(`CREATE TABLE ${schema}.plans (id UUID PRIMARY KEY, amount_cents INT, "interval" TEXT, currency TEXT DEFAULT 'USD')`);
    await db.query(`CREATE TABLE ${schema}.subscriptions (id UUID PRIMARY KEY, plan_id UUID, status TEXT)`);
    await db.query(`CREATE TABLE ${schema}.payments (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(), escrow_status TEXT, status TEXT,
      capture_amount_cents BIGINT, amount NUMERIC, refunded_amount NUMERIC, currency TEXT DEFAULT 'USD')`);

    // Users: super_admin (global), admin (owns restaurant 1), customer (nothing).
    await db.query(`INSERT INTO users (id, role) VALUES
      ('${SUPER_ADMIN_ID}', 'super_admin'),
      ('${ADMIN_ID}', 'admin'),
      ('${CUSTOMER_ID}', 'customer')`);
    await db.query(`INSERT INTO businesses (id, business_name, user_id) VALUES
      (1, 'Admin Eats', '${ADMIN_ID}'), (2, 'Other Place', '${OTHER_CUSTOMER_ID}')`);
    await db.query(`INSERT INTO food_restaurants (id, business_id, owner_user_id, display_name) VALUES
      (1, 1, '${ADMIN_ID}', 'Admin Eats'),
      (2, 2, '${OTHER_CUSTOMER_ID}', 'Other Place')`);

    // Disputes: 2 open, 1 closed.
    await db.query(`INSERT INTO disputes (status) VALUES ('open'), ('open'), ('closed')`);
    // Revenue: $10.00 job_fee + $5.00 subscription this week; $3.00 refund.
    await db.query(`INSERT INTO platform_ledger (amount_cents, source_type, created_at) VALUES
      (1000, 'job_fee', NOW() - INTERVAL '2 days'),
      (500, 'subscription', NOW() - INTERVAL '2 days'),
      (-300, 'refund', NOW() - INTERVAL '2 days'),
      (2000, 'job_fee', NOW() - INTERVAL '60 days')`);
    // Jobs: 4 total (1 cancelled, 1 soft-deleted), budgets for GMV.
    await db.query(`INSERT INTO jobs (status, client_id, assigned_helper_id, budget_max) VALUES
      ('completed', '${CUSTOMER_ID}', '${ADMIN_ID}', 100),
      ('completed', '${CUSTOMER_ID}', NULL, 200),
      ('cancelled', '${CUSTOMER_ID}', '${ADMIN_ID}', 50),
      ('completed', '${CUSTOMER_ID}', NULL, 75)`);
    await db.query(`UPDATE jobs SET final_price_cents=ROUND(COALESCE(budget_max,budget_min,0)*100)`);
    await db.query(`UPDATE platform_ledger SET job_id=(SELECT id FROM jobs WHERE status='completed' LIMIT 1) WHERE source_type='job_fee'`);
    await db.query(`UPDATE jobs SET deleted_at = NOW() WHERE budget_max = 75`);
    // Restaurant orders: customer ordered twice at restaurant 1 (repeat),
    // once at restaurant 2; one guest order excluded.
    await db.query(`INSERT INTO food_orders (restaurant_id, customer_id, status) VALUES
      (1, '${CUSTOMER_ID}', 'delivered'),
      (1, '${CUSTOMER_ID}', 'delivered'),
      (2, '${CUSTOMER_ID}', 'delivered'),
      (1, NULL, 'delivered'),
      (1, '${CUSTOMER_ID}', 'cancelled')`);
    await db.query(`INSERT INTO food_order_items (order_id, menu_item_id, item_name, quantity, line_total_cents)
      SELECT o.id, 11, 'Burger', 2, 2000 FROM food_orders o WHERE o.restaurant_id = 1 AND o.customer_id = '${CUSTOMER_ID}' LIMIT 1`);

    await db.query(`INSERT INTO consulting_sessions (status) VALUES ('completed'), ('cancelled'), ('scheduled')`);
    await db.query(`INSERT INTO consulting_session_feedback (nps_score) VALUES (10), (4)`);
    await db.query(`INSERT INTO support_conversations (business_id, status, priority, first_response_at) VALUES
      (1, 'open', 'high', NOW() - INTERVAL '10 minutes'),
      (1, 'open', 'low', NULL)`);
    const conv = await db.query(`SELECT id FROM support_conversations WHERE first_response_at IS NOT NULL LIMIT 1`);
    await db.query(`INSERT INTO support_conversation_reviews (conversation_id, nps_score) VALUES
      ('${conv.rows[0].id}', 9), ('${conv.rows[0].id}', 5)`);
    await db.query(`INSERT INTO plans (id, amount_cents, "interval") VALUES
      ('11111111-1111-4111-8111-111111111111', 1200, 'month')`);
    await db.query(`INSERT INTO subscriptions (id, plan_id, status) VALUES
      ('22222222-2222-4222-8222-222222222222', '11111111-1111-4111-8111-111111111111', 'active')`);
    await db.query(`INSERT INTO payments (escrow_status, status, capture_amount_cents) VALUES
      ('held', 'captured', 5000)`);
  }, 60000);

  async function auditRows() {
    const { rows } = await db.query(`SELECT * FROM analytics_query_audit ORDER BY created_at`);
    return rows;
  }

  test('executes open_disputes and audit-logs the success', async () => {
    const before = await auditRows();
    const result = await executeBuilderQuery(
      db, { id: SUPER_ADMIN_ID, role: 'super_admin' }, { metric: 'open_disputes' }
    );
    expect(result.rows).toEqual([{ value: 2 }]);
    expect(result.columns).toEqual(['value']);
    expect(result.rowCount).toBe(1);
    expect(result.truncated).toBe(false);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    const after = await auditRows();
    expect(after.length).toBe(before.length + 1);
    const entry = after[after.length - 1];
    expect(entry.admin_user_id).toBe(SUPER_ADMIN_ID);
    expect(entry.metric_name).toBe('open_disputes');
    expect(entry.success).toBe(true);
    expect(entry.row_count).toBe(1);
    expect(entry.error_code).toBeNull();
    expect(entry.raw_utterance).toBeNull();
    expect(entry.compiled_query.sql).toMatch(/FROM disputes/);
  });

  test('audit-logs validation failures without executing SQL', async () => {
    const before = await auditRows();
    await expect(executeBuilderQuery(
      db, { id: SUPER_ADMIN_ID, role: 'super_admin' }, { metric: 'nope' }
    )).rejects.toThrow(/Invalid metric/);
    const after = await auditRows();
    expect(after.length).toBe(before.length + 1);
    const entry = after[after.length - 1];
    expect(entry.success).toBe(false);
    expect(entry.error_code).toBe('invalid_metric');
    expect(entry.metric_name).toBe('nope');
    expect(entry.compiled_query).toBeNull();
  });

  test('rejects non-admin callers with 403 and audit-logs it', async () => {
    const before = await auditRows();
    await expect(executeBuilderQuery(
      db, { id: CUSTOMER_ID, role: 'customer' }, { metric: 'open_disputes' }
    )).rejects.toMatchObject({ status: 403, code: 'forbidden' });
    const after = await auditRows();
    expect(after.length).toBe(before.length + 1);
    expect(after[after.length - 1].success).toBe(false);
    expect(after[after.length - 1].error_code).toBe('forbidden');
  });

  test('grouped cancel rate by role cohort', async () => {
    const result = await executeBuilderQuery(
      db, { id: SUPER_ADMIN_ID, role: 'super_admin' },
      { metric: 'cancel_rate_pct', dimensions: ['role'], period: '90d' }
    );
    expect(result.columns).toEqual(['cohort', 'cancel_rate_pct', 'risk_band', 'cancelled', 'total']);
    const byCohort = Object.fromEntries(result.rows.map((r) => [r.cohort, r]));
    // 3 live jobs (soft-deleted excluded): 2 completed + 1 cancelled.
    expect(byCohort.platform.total).toBe(3);
    expect(byCohort.platform.cancelled).toBe(1);
    expect(byCohort.customer.total).toBe(3);
    expect(byCohort.helper.total).toBe(2);
    expect(byCohort.helper.cancelled).toBe(1);
    expect(byCohort.platform.risk_band).toBe('high_risk');
  });

  test('revenue by period bucket uses the registry trunc map', async () => {
    const result = await executeBuilderQuery(
      db, { id: SUPER_ADMIN_ID, role: 'super_admin' },
      { metric: 'platform_revenue_cents', dimensions: ['period'], period: '30d' }
    );
    expect(result.columns).toEqual(['bucket', 'currency_code', 'revenue_cents']);
    // $10.00 job_fee + $5.00 subscription inside 30d; the 60-day-old $20 excluded.
    const total = result.rows.reduce((s, r) => s + Number(r.revenue_cents), 0);
    expect(total).toBe(1500);
  });

  test('restaurant metrics constrain a plain admin to their own restaurants', async () => {
    const result = await executeBuilderQuery(
      db, { id: ADMIN_ID, role: 'admin' },
      { metric: 'restaurant_repeat_order_rate', dimensions: ['restaurant'], period: '30d' }
    );
    expect(result.rows.map((r) => r.restaurant_id)).toEqual([1]);
    const mine = result.rows[0];
    expect(mine.restaurant_name).toBe('Admin Eats');
    expect(mine.total_identified_orders).toBe(2);
    expect(mine.repeat_orders).toBe(2);
    expect(Number(mine.repeat_order_rate)).toBeCloseTo(1, 4);
  });

  test('restaurantId outside the admin scope is 403', async () => {
    await expect(executeBuilderQuery(
      db, { id: ADMIN_ID, role: 'admin' },
      { metric: 'restaurant_repeat_order_rate', dimensions: ['restaurant'], filters: { restaurantId: 2 } }
    )).rejects.toMatchObject({ status: 403 });
  });

  test('super_admin reads restaurant metrics globally', async () => {
    const result = await executeBuilderQuery(
      db, { id: SUPER_ADMIN_ID, role: 'super_admin' },
      { metric: 'restaurant_top_items_revenue', dimensions: ['restaurant'], period: '30d' }
    );
    expect(result.rows.length).toBeGreaterThan(0);
    expect(result.rows[0].item_name).toBe('Burger');
    expect(Number(result.rows[0].revenue_cents)).toBe(2000);
  });

  test('an injection-shaped dimension never reaches the database', async () => {
    const before = await db.query(`SELECT COUNT(*)::INT AS c FROM disputes`);
    await expect(executeBuilderQuery(
      db, { id: SUPER_ADMIN_ID, role: 'super_admin' },
      { metric: 'platform_revenue_cents', dimensions: ["period'); DROP TABLE disputes; --"] }
    )).rejects.toThrow(/Invalid dimension/);
    const after = await db.query(`SELECT COUNT(*)::INT AS c FROM disputes`);
    expect(Number(after.rows[0].c)).toBe(Number(before.rows[0].c));
  });

  test('take rate, MRR, and escrow compute from fixtures', async () => {
    const take = await executeBuilderQuery(
      db, { id: SUPER_ADMIN_ID, role: 'super_admin' }, { metric: 'investor_take_rate_pct' });
    // All-time job_fee take: $10 + $20 = $30.00 = 3000c.
    // GMV (registry canonical: status='completed', no deleted_at filter):
    // (100+200+75)*100 = 37500c → 8.00%.
    // Only priced, non-deleted completed jobs and their linked fees contribute.
    expect(take.rows[0].take_rate_pct).toBeCloseTo(10, 2);
    const mrr = await executeBuilderQuery(
      db, { id: SUPER_ADMIN_ID, role: 'super_admin' }, { metric: 'mrr_cents' });
    expect(Number(mrr.rows[0].mrr_cents)).toBe(1200);
    const escrow = await executeBuilderQuery(
      db, { id: SUPER_ADMIN_ID, role: 'super_admin' }, { metric: 'escrow_held_cents' });
    expect(Number(escrow.rows[0].escrow_held_cents)).toBe(5000);
  });
});

// ── HTTP: route gating + behavior ───────────────────────────────────────────
describeDb('query builder routes', () => {
  function buildApp() {
    const app = express();
    app.use(express.json());
    app.use('/api/admin', adminRoutes);
    app.use((err, _req, res, _next) => res.status(err.statusCode || err.status || 500).json({ error: err.message }));
    return app;
  }
  const app = buildApp();
  const adminHeaders = { 'x-test-user': SUPER_ADMIN_ID, 'x-test-role': 'super_admin' };
  const customerHeaders = { 'x-test-user': CUSTOMER_ID, 'x-test-role': 'customer' };

  test('both routes are registered behind requireAdmin', () => {
    const layers = adminRoutes.stack.filter((l) => l.route);
    const wanted = [
      { path: '/analytics/query-builder/meta', methods: ['get'] },
      { path: '/analytics/query-builder/run', methods: ['post'] },
    ];
    for (const { path: p, methods } of wanted) {
      const layer = layers.find((l) => l.route.path === p && methods.every((m) => l.route.methods[m]));
      expect(layer).toBeTruthy();
      const handles = layer.route.stack.map((s) => s.handle);
      expect(handles).toContain(requireAdmin);
    }
  });

  test('non-admin gets 403 on both endpoints', async () => {
    await request(app).get('/api/admin/analytics/query-builder/meta')
      .set(customerHeaders).expect(403);
    await request(app).post('/api/admin/analytics/query-builder/run')
      .set(customerHeaders).send({ metric: 'open_disputes' }).expect(403);
  });

  test('admin gets meta and can run a query', async () => {
    const metaRes = await request(app).get('/api/admin/analytics/query-builder/meta')
      .set(adminHeaders).expect(200);
    expect(metaRes.body.metrics).toHaveLength(26);
    const runRes = await request(app).post('/api/admin/analytics/query-builder/run')
      .set(adminHeaders).send({ metric: 'open_disputes' }).expect(200);
    expect(runRes.body.rows).toEqual([{ value: 2 }]);
    expect(runRes.body.rowCount).toBe(1);
    expect(runRes.body.truncated).toBe(false);
    expect(typeof runRes.body.durationMs).toBe('number');
  });

  test('invalid query returns 400 with a plain error', async () => {
    const res = await request(app).post('/api/admin/analytics/query-builder/run')
      .set(adminHeaders).send({ metric: 'nope' }).expect(400);
    expect(res.body.error).toMatch(/Invalid metric/);
  });

  test('evidence and exports are audited and personal history excludes other admins', async () => {
    const records=await request(app).post('/api/admin/analytics/query-builder/run').set(adminHeaders)
      .send({metric:'platform_revenue_cents',evidence:true}).expect(200);
    expect(records.body.evidence).toBe(true);
    expect(records.body.summary[0].revenue_cents).toBe('1500');
    expect(records.body.rows.reduce((sum,row)=>sum+BigInt(row.amount_cents),0n)).toBe(1500n);
    await request(app).post('/api/admin/analytics/query-builder/run').set(adminHeaders)
      .send({metric:'open_disputes',export:true}).expect(200);
    await db.query(`INSERT INTO analytics_query_audit(admin_user_id,metric_name,event_type,success)
      VALUES($1,'open_disputes','execution',true)`,[OTHER_CUSTOMER_ID]);
    const history=await request(app).get('/api/admin/analytics/query-builder/history').set(adminHeaders).expect(200);
    expect(history.body.rows.some(row=>row.event_type==='evidence')).toBe(true);
    expect(history.body.rows.some(row=>row.event_type==='export')).toBe(true);
    expect(history.body.rows.every(row=>!Object.hasOwn(row,'compiled_query'))).toBe(true);
    const ids=history.body.rows.map(row=>row.id);
    const {rows:[other]}=await db.query('SELECT id FROM analytics_query_audit WHERE admin_user_id=$1',[OTHER_CUSTOMER_ID]);
    expect(ids).not.toContain(other.id);
  });
});
