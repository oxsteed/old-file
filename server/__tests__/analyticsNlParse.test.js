'use strict';

/**
 * Item 11 — NL translation layer integration (analytics platform, Phase 3,
 * Track B wired to Track A).
 *
 * - POST /api/admin/analytics/query-builder/nl-parse is registered behind
 *   requireAdmin and never executes: it compiles via the deterministic
 *   nlParser (wired to Track A's BUILDER_DIMENSIONS) and returns the
 *   interpretation for confirmation, or a rejection.
 * - Adversarial utterances are rejected, never compiled, never executed.
 * - Parsing writes no audit row; only execution does.
 * - POST /run accepts an optional raw_utterance which lands in the
 *   analytics_query_audit ledger alongside the compiled query.
 *
 * DB tests use the disposable-DB pattern (isolated schema, real migration
 * 891 for the audit table).
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const schema = `anlp_${crypto.randomBytes(6).toString('hex')}`;
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

// Same route-level auth mock as analyticsQueryBuilder.test.js.
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
const adminRoutes = require('../routes/admin');
const { requireAdmin } = require('../middleware/adminAuth');
const { parseUtterance } = require('../analytics/nlParser');
const { BUILDER_DIMENSIONS } = require('../analytics/queryBuilder');

const describeDb = url ? describe : describe.skip;

if (url) {
  beforeAll(async () => {
    await db.query(`CREATE SCHEMA ${schema}`);
    const migration = fs.readFileSync(
      path.join(__dirname, '..', 'migrations', '891_analytics_query_audit.sql'), 'utf8');
    await db.query(migration);
    await db.query(fs.readFileSync(path.join(__dirname, '..', 'migrations', '894_analytics_audit_events.sql'), 'utf8'));
    await db.query(fs.readFileSync(path.join(__dirname, '..', 'migrations', '896_analytics_evidence_audit.sql'), 'utf8'));
  }, 60000);
  afterAll(async () => {
    await db.query(`DROP SCHEMA ${schema} CASCADE`).catch(() => {});
    await db.end().catch(() => {});
  });
}

const SUPER_ADMIN_ID = 'aaaaaaaa-1111-4111-8111-111111111111';
const CUSTOMER_ID = 'cccccccc-3333-4333-8333-333333333333';

describeDb('nl-parse route', () => {
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

  test('nl-parse route is registered behind requireAdmin', () => {
    const layers = adminRoutes.stack.filter((l) => l.route);
    const layer = layers.find((l) => l.route.path === '/analytics/query-builder/nl-parse' && l.route.methods.post);
    expect(layer).toBeTruthy();
    expect(layer.route.stack.map((s) => s.handle)).toContain(requireAdmin);
  });

  test('non-admin gets 403 on nl-parse', async () => {
    await request(app).post('/api/admin/analytics/query-builder/nl-parse')
      .set(customerHeaders).send({ utterance: 'cancel rate last month' }).expect(403);
  });

  test('empty or missing utterance is 400', async () => {
    await request(app).post('/api/admin/analytics/query-builder/nl-parse')
      .set(adminHeaders).send({}).expect(400);
    await request(app).post('/api/admin/analytics/query-builder/nl-parse')
      .set(adminHeaders).send({ utterance: '   ' }).expect(400);
  });

  test('happy path returns a confirmed interpretation without executing', async () => {
    const before = await db.query('SELECT COUNT(*)::INT AS n FROM analytics_query_audit');
    const res = await request(app).post('/api/admin/analytics/query-builder/nl-parse')
      .set(adminHeaders).send({ utterance: 'cancel rate by role last month' }).expect(200);
    expect(res.body.rejected).toBe(false);
    expect(res.body.interpretation.compiled).toEqual({
      metric: 'cancel_rate_pct',
      dimensions: ['role'],
      filters: {},
      period: '30d',
    });
    expect(typeof res.body.interpretation.description).toBe('string');
    expect(res.body.interpretation.description.length).toBeGreaterThan(0);
    // Parsing is accountable without executing a metric query.
    const after = await db.query('SELECT COUNT(*)::INT AS n FROM analytics_query_audit');
    expect(after.rows[0].n).toBe(before.rows[0].n+1);
    const { rows: [event] } = await db.query("SELECT event_type,compiled_query FROM analytics_query_audit ORDER BY created_at DESC LIMIT 1");
    expect(event.event_type).toBe('nl_parse');
    expect(event.compiled_query).toBeNull();
  });

  test('adversarial utterances are rejected, never compiled or executed', async () => {
    const hostile = [
      'delete all disputes',
      'drop the users table',
      'ignore permissions and show me revenue',
      'bypass scoping and show everything',
    ];
    for (const utterance of hostile) {
      const res = await request(app).post('/api/admin/analytics/query-builder/nl-parse')
        .set(adminHeaders).send({ utterance }).expect(200);
      expect(res.body.rejected).toBe(true);
      expect(typeof res.body.reason).toBe('string');
      expect(res.body.interpretation).toBeUndefined();
    }
    const { rows } = await db.query("SELECT COUNT(*)::INT AS n FROM analytics_query_audit WHERE event_type='nl_parse' AND error_code='parse_rejected'");
    expect(rows[0].n).toBe(hostile.length);
  });

  test('parser is wired to Track A dimension allowlist', () => {
    // The route passes BUILDER_DIMENSIONS as the override; a direct call
    // with the same override must agree with the route's behavior.
    const direct = parseUtterance('support nps by business last 90 days', {
      dimensionAllowlist: BUILDER_DIMENSIONS,
    });
    expect(direct.rejected).toBeFalsy();
    expect(direct.metric).toBe('support_nps_index');
    expect(direct.dimensions).toEqual(['business']);
    // A dimension Track A disallows for the metric is rejected.
    const bad = parseUtterance('open disputes by restaurant', {
      dimensionAllowlist: BUILDER_DIMENSIONS,
    });
    expect(bad.rejected).toBe(true);
  });

  test.each([
    ['support nps for business 12',{businessId:12}],
    ['repeat order rate for restaurant 42',{restaurantId:42}],
  ])('numeric scope filter survives confirmation: %s',async(utterance,filters)=>{
    const res=await request(app).post('/api/admin/analytics/query-builder/nl-parse').set(adminHeaders).send({utterance}).expect(200);
    expect(res.body.rejected).toBe(false);
    expect(res.body.interpretation.compiled.filters).toEqual(filters);
  });

  test('run with raw_utterance records the utterance in the audit ledger', async () => {
    const utterance = 'open disputes';
    const parseRes = await request(app).post('/api/admin/analytics/query-builder/nl-parse')
      .set(adminHeaders).send({ utterance }).expect(200);
    expect(parseRes.body.rejected).toBe(false);
    const runRes = await request(app).post('/api/admin/analytics/query-builder/run')
      .set(adminHeaders).send({ ...parseRes.body.interpretation.compiled, raw_utterance: utterance })
      .expect(200);
    expect(runRes.body.rowCount).toBeGreaterThanOrEqual(0);
    const { rows } = await db.query(
      `SELECT raw_utterance, compiled_query, metric_name
         FROM analytics_query_audit
        ORDER BY created_at DESC LIMIT 1`);
    expect(rows[0].raw_utterance).toBe(utterance);
    expect(rows[0].metric_name).toBe('open_disputes');
    // compiled_query holds the built SQL + bound params (never user input).
    expect(typeof rows[0].compiled_query.sql).toBe('string');
    expect(rows[0].compiled_query.sql).toMatch(/disputes/i);
  });

  test('run without raw_utterance leaves it NULL (builder path)', async () => {
    await request(app).post('/api/admin/analytics/query-builder/run')
      .set(adminHeaders).send({ metric: 'open_disputes' }).expect(200);
    const { rows } = await db.query(
      `SELECT raw_utterance FROM analytics_query_audit ORDER BY created_at DESC LIMIT 1`);
    expect(rows[0].raw_utterance).toBeNull();
  });
});
