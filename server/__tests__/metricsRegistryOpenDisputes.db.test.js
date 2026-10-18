'use strict';

/**
 * Parity test: OPEN DISPUTES canonical definition.
 *
 * Old divergent behavior:
 *   - adminController.getDashboardStats counted jobs.status = 'disputed'
 *   - superAdminController.getDashboardStats counted jobs.dispute_status = 'open'
 *   Neither touched the disputes table, and the same Dashboard.jsx card
 *   showed different numbers by role.
 *
 * Canonical (registry): COUNT(*) FROM disputes WHERE status = 'open' — the
 * same source the /admin/disputes drill-through target reads (default tab).
 */
const crypto = require('crypto');
const schema = `mreg_disputes_${crypto.randomBytes(6).toString('hex')}`;
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

describeDb('metrics registry: open disputes parity', () => {
  beforeAll(async () => {
    await db.query(`CREATE SCHEMA ${schema}`);
    await db.query(`CREATE TABLE ${schema}.disputes (
      id SERIAL PRIMARY KEY, job_id UUID, status VARCHAR(30) NOT NULL DEFAULT 'open')`);
    await db.query(`CREATE TABLE ${schema}.jobs (
      id UUID PRIMARY KEY, status TEXT NOT NULL DEFAULT 'published', dispute_status TEXT NOT NULL DEFAULT 'none')`);
  });

  afterAll(async () => {
    await db.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await db.end();
  });

  beforeEach(async () => {
    await db.query(`TRUNCATE ${schema}.disputes, ${schema}.jobs`);
  });

  test('canonical count comes from the disputes table, not job flags', async () => {
    // disputes table: 2 open, 1 under_review, 1 resolved
    await db.query(`INSERT INTO disputes (status) VALUES ('open'), ('open'), ('under_review'), ('resolved')`);
    // jobs table: legacy flags that the old endpoints counted — deliberately
    // divergent from the disputes table (1 disputed job, 3 with the dispute
    // flag set, vs 2 open rows in the disputes table).
    await db.query(`INSERT INTO jobs (id, status, dispute_status) VALUES
      (gen_random_uuid(), 'disputed', 'open'),
      (gen_random_uuid(), 'in_progress', 'open'),
      (gen_random_uuid(), 'in_progress', 'open')`);

    // The two OLD divergent definitions:
    const oldAdmin = await db.query(`SELECT COUNT(*)::INT AS v FROM jobs WHERE status = 'disputed'`);
    const oldSuper = await db.query(`SELECT COUNT(*)::INT AS v FROM jobs WHERE dispute_status = 'open'`);

    // The new canonical definition:
    const canonical = await registry.openDisputes(db);

    expect(canonical).toBe(2);
    // Fixture proves the old definitions disagreed with the canonical one:
    expect(oldAdmin.rows[0].v).not.toBe(canonical);
    expect(oldSuper.rows[0].v).not.toBe(canonical);
    // ...and disagreed with each other in the general case is not required,
    // but here they also happen to differ from the canonical source.
  });

  test('returns 0 when no open disputes exist', async () => {
    await db.query(`INSERT INTO disputes (status) VALUES ('resolved'), ('closed')`);
    expect(await registry.openDisputes(db)).toBe(0);
  });

  test('under_review disputes are not folded into open_disputes', async () => {
    await db.query(`INSERT INTO disputes (status) VALUES ('under_review'), ('under_review')`);
    expect(await registry.openDisputes(db)).toBe(0);
  });
});
