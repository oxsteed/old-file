'use strict';

/**
 * Parity tests: CANCEL RATE canonical definition.
 *
 * Old divergent behavior:
 *   - migration 170 materialized views: per-role rates with
 *     deleted_at IS NULL filter (customer posted / helper accepted)
 *   - cancellationStatsController: same MV rates, but risk thresholds
 *     (5/15/30) hardcoded in SQL CASE *and* in JS calculateRiskLevel
 *   - Customer360.jsx:975 computed cancelled/total CLIENT-SIDE over a
 *     mixed-role cohort (client_id OR assigned_helper_id) with NO
 *     deleted_at filter
 *   - consulting: cancelled/(completed+cancelled) — different domain
 *
 * Canonical (registry): per-role, server-side, deleted_at IS NULL.
 * Consulting keeps its own registered metric (consulting_cancel_rate_pct).
 */
const crypto = require('crypto');
const schema = `mreg_cancel_${crypto.randomBytes(6).toString('hex')}`;
const url = process.env.STATEMENT_TEST_DATABASE_URL;
if (url) {
  const target = new URL(url);
  if (!['127.0.0.1', 'localhost'].includes(target.hostname) || target.pathname !== '/credit_statement_test') {
    throw new Error('fixtures require the disposable statement test database');
  }
  target.searchParams.set('options', `-c search_path=${schema},public`);
  process.env.DATABASE_URL = target.toString();
}
jest.unmock('pg');
jest.unmock('../db');

const db = require('../db');
const registry = require('../analytics/metricsRegistry');

const describeDb = url ? describe : describe.skip;

const CUSTOMER = '11111111-1111-4111-8111-111111111111';
const HELPER = '22222222-2222-4222-8222-222222222222';

describeDb('metrics registry: cancel rate parity', () => {
  beforeAll(async () => {
    await db.query(`CREATE SCHEMA ${schema}`);
    await db.query(`CREATE TABLE ${schema}.jobs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      client_id UUID, assigned_helper_id UUID,
      status TEXT NOT NULL DEFAULT 'published',
      deleted_at TIMESTAMPTZ)`);
  });

  afterAll(async () => {
    await db.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await db.end();
  });

  beforeEach(async () => {
    await db.query(`TRUNCATE ${schema}.jobs`);
    // Customer: 10 posted, 3 cancelled, 1 cancelled-but-soft-deleted
    for (let i = 0; i < 6; i++) await db.query(`INSERT INTO jobs (client_id, status) VALUES ($1, 'completed')`, [CUSTOMER]);
    for (let i = 0; i < 3; i++) await db.query(`INSERT INTO jobs (client_id, status) VALUES ($1, 'cancelled')`, [CUSTOMER]);
    await db.query(`INSERT INTO jobs (client_id, status, deleted_at) VALUES ($1, 'cancelled', NOW())`, [CUSTOMER]);
    // Helper: 4 accepted, 1 cancelled
    for (let i = 0; i < 3; i++) await db.query(`INSERT INTO jobs (client_id, assigned_helper_id, status) VALUES (gen_random_uuid(), $1, 'completed')`, [HELPER]);
    await db.query(`INSERT INTO jobs (client_id, assigned_helper_id, status) VALUES (gen_random_uuid(), $1, 'cancelled')`, [HELPER]);
  });

  test('customer rate excludes soft-deleted jobs (3/9 = 33.3%)', async () => {
    expect(await registry.cancelRate(db, { role: 'customer', userId: CUSTOMER })).toBeCloseTo(33.3, 1);
  });

  test('helper rate covers accepted jobs only (1/4 = 25%)', async () => {
    expect(await registry.cancelRate(db, { role: 'helper', userId: HELPER })).toBeCloseTo(25.0, 1);
  });

  test('platform rate covers all non-deleted jobs', async () => {
    // 4 cancelled / 13 non-deleted = 30.8%
    expect(await registry.cancelRate(db, { role: 'platform' })).toBeCloseTo(30.8, 1);
  });

  test('old client-side formula (no deleted_at filter, mixed roles) diverges', async () => {
    // What Customer360.jsx:975 computed: cancelled/total over the mixed cohort
    const old = await db.query(
      `SELECT COUNT(*) FILTER (WHERE status='cancelled')::FLOAT / NULLIF(COUNT(*),0) AS r
       FROM jobs WHERE client_id = $1 OR assigned_helper_id = $1`, [CUSTOMER]);
    const oldPct = old.rows[0].r * 100; // 4/10 = 40% — includes the soft-deleted row
    const canonical = await registry.cancelRate(db, { role: 'customer', userId: CUSTOMER });
    expect(oldPct).not.toBeCloseTo(canonical, 1);
    expect(canonical).toBeCloseTo(33.3, 1);
  });

  test('returns null when the cohort is empty', async () => {
    expect(await registry.cancelRate(db, { role: 'customer', userId: '33333333-3333-4333-8333-333333333333' })).toBeNull();
  });

  test('risk thresholds match the MV-era bands exactly', () => {
    const t = registry.CANCEL_RISK_THRESHOLDS;
    expect(t).toEqual({ reliable: 5, caution: 15, warning: 30 });
    expect(registry.cancelRiskLevel(0, 0)).toBe('reliable');
    expect(registry.cancelRiskLevel(4.9, 3)).toBe('reliable');
    expect(registry.cancelRiskLevel(5, 3)).toBe('caution');
    expect(registry.cancelRiskLevel(14.9, 3)).toBe('caution');
    expect(registry.cancelRiskLevel(15, 3)).toBe('warning');
    expect(registry.cancelRiskLevel(29.9, 3)).toBe('warning');
    expect(registry.cancelRiskLevel(30, 3)).toBe('high_risk');
    expect(registry.cancelRiskLevel(99, 10)).toBe('high_risk');
  });

  test('risk-level SQL CASE embeds the canonical thresholds', () => {
    const sql = registry.cancelRiskLevelCaseSql('r.cancellation_rate_percent', 'r.cancellations_total');
    expect(sql).toMatch(/< 5/);
    expect(sql).toMatch(/< 15/);
    expect(sql).toMatch(/< 30/);
    expect(sql).toMatch(/'high_risk'/);
  });
});
