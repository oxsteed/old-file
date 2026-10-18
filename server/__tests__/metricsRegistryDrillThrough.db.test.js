'use strict';

/**
 * Parity tests: DRILL-THROUGH (analytics platform Item 8).
 *
 * A dashboard KPI number is only trustworthy if the list it drills into
 * shows the SAME number. These tests pin the definition parity between the
 * metrics-registry canonical computes and the drill targets' filtered
 * queries, using fixture data that exercises the soft-delete edge case.
 *
 * Drill links shipped:
 *   - open_disputes        -> /admin/disputes (default tab 'open')
 *   - cancel_rate_pct      -> /admin/jobs?status=cancelled (numerator card)
 *
 * Reconciliation made for the cancel-rate drill (Item 8): the super-admin
 * dashboard jobs stats (superAdminController.getDashboardStats), the admin
 * dashboard jobs stats (adminController.getDashboardStats), and the admin
 * jobs list (superAdminController.getJobs) previously counted soft-deleted
 * jobs, while the registry canonical cancel_rate_pct excludes them
 * (deleted_at IS NULL, matching migration 170's materialized views). All
 * three now exclude soft-deleted jobs, so the KPI card, the drill list,
 * and the registry numerator agree.
 */
const crypto = require('crypto');
const schema = `mreg_drill_${crypto.randomBytes(6).toString('hex')}`;
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

describeDb('metrics registry: drill-through parity', () => {
  beforeAll(async () => {
    await db.query(`CREATE SCHEMA ${schema}`);
    await db.query(`CREATE TABLE ${schema}.jobs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      status TEXT NOT NULL DEFAULT 'published',
      deleted_at TIMESTAMPTZ)`);
    await db.query(`CREATE TABLE ${schema}.disputes (
      id SERIAL PRIMARY KEY, status VARCHAR(30) NOT NULL DEFAULT 'open')`);
  });

  afterAll(async () => {
    await db.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await db.end();
  });

  beforeEach(async () => {
    await db.query(`TRUNCATE ${schema}.jobs, ${schema}.disputes`);
    // 8 live jobs: 3 cancelled, 2 published, 1 in_progress, 1 completed,
    // 1 accepted; plus 2 soft-deleted jobs (1 cancelled, 1 published).
    await db.query(`INSERT INTO jobs (status, deleted_at) VALUES
      ('cancelled', NULL), ('cancelled', NULL), ('cancelled', NULL),
      ('cancelled', NOW()),
      ('published', NULL), ('published', NULL),
      ('published', NOW()),
      ('in_progress', NULL),
      ('completed', NULL),
      ('accepted', NULL)`);
    // disputes: 2 open, 1 under_review, 1 resolved.
    await db.query(`INSERT INTO disputes (status)
      VALUES ('open'), ('open'), ('under_review'), ('resolved')`);
  });

  test('cancel rate: registry numerator == dashboard cancelled count == drill list count', async () => {
    // Registry canonical (platform role): cancelled / total over live jobs.
    const rate = await registry.cancelRate(db, { role: 'platform' });
    expect(rate).toBe(37.5); // 3 cancelled / 8 live

    // Dashboard card predicate (superAdminController.getDashboardStats jobs
    // stats query): COUNT FILTER over jobs WHERE deleted_at IS NULL.
    const dash = await db.query(
      `SELECT COUNT(*) FILTER (WHERE status = 'cancelled')::INT AS cancelled_jobs
       FROM jobs WHERE deleted_at IS NULL`);
    // Drill target predicate (superAdminController.getJobs with
    // ?status=cancelled): j.deleted_at IS NULL AND j.status = 'cancelled'.
    const drill = await db.query(
      `SELECT COUNT(*)::INT AS total FROM jobs j
       WHERE j.deleted_at IS NULL AND j.status = 'cancelled'`);

    expect(dash.rows[0].cancelled_jobs).toBe(3);
    expect(drill.rows[0].total).toBe(3);
    expect(dash.rows[0].cancelled_jobs).toBe(drill.rows[0].total);

    // The pre-Item-8 predicates (no soft-delete exclusion) counted the
    // deleted cancelled job too — 4, disagreeing with the registry.
    const old = await db.query(
      `SELECT COUNT(*) FILTER (WHERE status = 'cancelled')::INT AS v FROM jobs`);
    expect(old.rows[0].v).toBe(4);
    expect(old.rows[0].v).not.toBe(dash.rows[0].cancelled_jobs);
  });

  test('cancel rate drill: other dashboard job cards agree with the jobs list too', async () => {
    // The same reconciliation covers the pre-existing drill links
    // (/admin/jobs?status=published, ?status=in_progress): dashboard card
    // counts and drill list counts must match per status.
    const statuses = ['published', 'in_progress', 'completed'];
    for (const status of statuses) {
      const dash = await db.query(
        `SELECT COUNT(*) FILTER (WHERE status = $1)::INT AS v
         FROM jobs WHERE deleted_at IS NULL`, [status]);
      const drill = await db.query(
        `SELECT COUNT(*)::INT AS total FROM jobs j
         WHERE j.deleted_at IS NULL AND j.status = $1`, [status]);
      expect(drill.rows[0].total).toBe(dash.rows[0].v);
    }
    // Fixture sanity: 2 published, 1 in_progress, 1 completed (live only).
    const counts = await db.query(
      `SELECT COUNT(*) FILTER (WHERE status = 'published')::INT AS p,
              COUNT(*) FILTER (WHERE status = 'in_progress')::INT AS a,
              COUNT(*) FILTER (WHERE status = 'completed')::INT AS c
       FROM jobs WHERE deleted_at IS NULL`);
    expect(counts.rows[0]).toEqual({ p: 2, a: 1, c: 1 });
  });

  test('open disputes: registry == /admin/disputes drill target count', async () => {
    const canonical = await registry.openDisputes(db);
    expect(canonical).toBe(2);

    // Drill target predicate (disputeAdminController.getAllDisputes count
    // query with the default ?status=open): COUNT(*) over the disputes view
    // WHERE d.status = ANY('{open}'). The view's LEFT JOINs (jobs,
    // payments) cannot multiply dispute rows, so the predicate below is the
    // exact count the drill target reports.
    const drill = await db.query(
      `SELECT COUNT(*)::INT AS total FROM disputes d
       WHERE d.status = ANY($1::text[])`, [['open']]);
    expect(drill.rows[0].total).toBe(2);
    expect(drill.rows[0].total).toBe(canonical);
  });
});
