'use strict';

// Decision 3: regional admins see region-filtered analytics rows end to end
// (builder aggregate, evidence, alert computation, audit), global grants see
// everything, and unknown/deleted regions fail closed.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const schema = `region_scope_${crypto.randomBytes(6).toString('hex')}`;
const url = process.env.STATEMENT_TEST_DATABASE_URL;
if (url) {
  const target = new URL(url);
  if (!['127.0.0.1', 'localhost'].includes(target.hostname) || target.pathname !== '/credit_statement_test') {
    throw new Error('Disposable database required');
  }
  target.searchParams.set('options', `-c search_path=${schema},public`);
  process.env.DATABASE_URL = target.toString();
}
jest.unmock('pg');
jest.unmock('../db');

const db = require('../db');
const { executeBuilderQuery } = require('../analytics/queryBuilder');
const { assertMetricAccess, permittedMetrics } = require('../analytics/metricAccess');
const { regionScopedDb, applyRegionScope, locationInRegionsSql, JOB_LOC } = require('../analytics/regionScope');
const { computeMetricValue } = require('../analytics/metricAlerts');

const migration = (f) => fs.readFileSync(path.join(__dirname, '..', 'migrations', f), 'utf8');

(url ? describe : describe.skip)('region-scoped analytics', () => {
  const superAdmin = { id: crypto.randomUUID(), role: 'super_admin' };
  const regional = { id: crypto.randomUUID(), role: 'admin' };
  const globalAdmin = { id: crypto.randomUUID(), role: 'admin' };
  const customer = crypto.randomUUID();
  let htRegion, zipRegion;

  beforeAll(async () => {
    await db.query(`CREATE SCHEMA ${schema}`);
    await db.query(`CREATE TABLE users(id UUID PRIMARY KEY, role TEXT, zip_code TEXT, city TEXT, state TEXT, country TEXT,
      is_active BOOLEAN NOT NULL DEFAULT TRUE, deleted_at TIMESTAMPTZ)`);
    await db.query(`CREATE TABLE admin_regions(id SERIAL PRIMARY KEY, name TEXT UNIQUE, boundary_definition JSONB NOT NULL)`);
    await db.query(`CREATE TABLE admin_permission_grants(id BIGSERIAL PRIMARY KEY, grantee_id UUID, permissions JSONB,
      expires_at TIMESTAMPTZ, revoked_at TIMESTAMPTZ, notes TEXT,
      region_id INTEGER REFERENCES admin_regions(id) ON DELETE SET NULL)`);
    await db.query(`CREATE TABLE delegation_grants(id BIGSERIAL PRIMARY KEY, grantor_admin_id UUID, grantee_admin_id UUID,
      scopes TEXT[], status TEXT, expires_at TIMESTAMPTZ)`);
    await db.query(`CREATE TABLE jobs(id UUID PRIMARY KEY, client_id UUID, status TEXT, deleted_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW(), location_zip TEXT, location_city TEXT, location_state TEXT,
      location_country TEXT, location_country_code TEXT, location_lat NUMERIC, location_lng NUMERIC)`);
    await db.query(`CREATE TABLE disputes(id SERIAL PRIMARY KEY, job_id UUID, status TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`);
    await db.query(migration('891_analytics_query_audit.sql'));
    await db.query(migration('894_analytics_audit_events.sql'));
    await db.query(migration('896_analytics_evidence_audit.sql'));
    await db.query(migration('901_regional_analytics_scope.sql'));
    await db.query(migration('902_region_delete_revokes_grants.sql'));
    await db.query('INSERT INTO users(id, role) VALUES($1,$2),($3,$4),($5,$6),($7,$8)',
      [superAdmin.id, 'super_admin', regional.id, 'admin', globalAdmin.id, 'admin', customer, 'customer']);
    ({ rows: [{ id: htRegion }] } = await db.query(`INSERT INTO admin_regions(name, boundary_definition)
      VALUES('Haiti', '{"type":"country_only","countries":["HT"]}') RETURNING id`));
    ({ rows: [{ id: zipRegion }] } = await db.query(`INSERT INTO admin_regions(name, boundary_definition)
      VALUES('Chicago zips', '{"type":"zip_range","ranges":[{"start":60600,"end":60699}]}') RETURNING id`));
    await db.query(`INSERT INTO admin_permission_grants(grantee_id, permissions, expires_at, region_id)
      VALUES($1, '["manage_operations","manage_disputes"]', NOW() + INTERVAL '1 day', $2),
            ($1, '["manage_operations"]', NOW() + INTERVAL '1 day', $3),
            ($4, '["manage_operations"]', NOW() + INTERVAL '1 day', NULL)`,
    [regional.id, htRegion, zipRegion, globalAdmin.id]);
    const job = (status, loc) => db.query(`INSERT INTO jobs(id, client_id, status, location_zip, location_city, location_state,
      location_country_code, created_at) VALUES($1,$2,$3,$4,$5,$6,$7,NOW()-INTERVAL '1 day') RETURNING id`,
    [crypto.randomUUID(), customer, status, loc.zip || null, loc.city || null, loc.state || null, loc.country || null]);
    const ht1 = (await job('completed', { country: 'HT', city: 'Jacmel' })).rows[0].id;
    await job('cancelled', { country: 'HT' });
    await job('completed', { zip: '60614-1234', country: 'US' });     // in zip region
    await job('completed', { zip: '10001', country: 'US' });          // outside
    await job('cancelled', { zip: '10002', country: 'US' });          // outside
    await job('completed', {});                                       // no location: excluded
    await db.query(`INSERT INTO disputes(job_id, status) VALUES($1,'open')`, [ht1]);
    await db.query(`INSERT INTO disputes(job_id, status) SELECT id, 'open' FROM jobs WHERE location_zip = '10001'`);
  });
  afterAll(async () => { await db.query(`DROP SCHEMA ${schema} CASCADE`); await db.end(); });

  test('disabled or deleted grantors cannot authorize delegated analytics access', async () => {
    const delegatedId = crypto.randomUUID();
    const { hasGlobalGrant } = require('../middleware/adminAuth');
    await db.query("INSERT INTO users(id,role) VALUES($1,'admin')",[delegatedId]);
    await db.query(`INSERT INTO delegation_grants(grantor_admin_id,grantee_admin_id,scopes,status,expires_at)
      VALUES($1,$2,ARRAY['manage_operations'],'active',NOW()+INTERVAL '1 day')`, [globalAdmin.id,delegatedId]);
    expect(await hasGlobalGrant(delegatedId,'manage_operations')).toBe(true);
    try {
      await db.query('UPDATE users SET is_active=FALSE WHERE id=$1',[globalAdmin.id]);
      expect(await hasGlobalGrant(delegatedId,'manage_operations')).toBe(false);
      await db.query('UPDATE users SET is_active=TRUE,deleted_at=NOW() WHERE id=$1',[globalAdmin.id]);
      expect(await hasGlobalGrant(delegatedId,'manage_operations')).toBe(false);
    } finally {
      await db.query('UPDATE users SET is_active=TRUE,deleted_at=NULL WHERE id=$1',[globalAdmin.id]);
    }
  });

  test('global grant and super_admin see every row; regional admin sees only its territory', async () => {
    const run = (user) => executeBuilderQuery(db, user, { metric: 'job_completion_rate_pct', period: '7d' });
    const all = await run(superAdmin);
    expect(all.rows[0]).toMatchObject({ completed: 4, decided: 6 });
    expect(all.scope).toEqual({ kind: 'global' });
    expect((await run(globalAdmin)).rows[0]).toMatchObject({ completed: 4, decided: 6 });
    const mine = await run(regional);
    expect(mine.scope).toEqual({ kind: 'regional', regionIds: [htRegion, zipRegion].sort((a, b) => a - b) });
    expect(mine.rows[0]).toMatchObject({ completed: 2, decided: 3, completion_rate_pct: 66.67 });
  });

  test('evidence rows and exports are limited to the territory', async () => {
    const evidence = await executeBuilderQuery(db, regional, { metric: 'job_completion_rate_pct', period: '7d' },
      { evidence: true, eventType: 'export' });
    expect(evidence.rows).toHaveLength(3);
    expect(evidence.summary[0]).toMatchObject({ completed: 2, decided: 3 });
  });

  test('disputes anchor to the disputed job location', async () => {
    const result = await executeBuilderQuery(db, regional, { metric: 'open_disputes' });
    expect(result.rows[0].value).toBe(1);
    expect((await executeBuilderQuery(db, superAdmin, { metric: 'open_disputes' })).rows[0].value).toBe(2);
  });

  test('every execution audits its scope', async () => {
    const { rows } = await db.query(`SELECT scope_kind, region_ids FROM analytics_query_audit
      WHERE admin_user_id = $1 AND success ORDER BY id DESC LIMIT 1`, [regional.id]);
    expect(rows[0].scope_kind).toBe('regional');
    expect(rows[0].region_ids.length).toBeGreaterThan(0);
  });

  test('alert computation uses the same regional scope', async () => {
    const scope = await assertMetricAccess(regional, 'job_completion_rate_pct');
    expect(await computeMetricValue(regionScopedDb(db, scope), 'job_completion_rate_pct', { period: '7d' })).toBe(66.67);
  });

  test('metrics whose tables have no geographic anchor are refused, not leaked', () => {
    expect(() => applyRegionScope({ text: 'SELECT COUNT(*) FROM audit_events', params: [] },
      { global: false, regions: [{ type: 'country_only', countries: ['HT'] }] }))
      .toThrow(expect.objectContaining({ code: 'region_scope_unsupported' }));
  });

  test('admin disputes list predicate hides out-of-region disputes', async () => {
    // The getAllDisputes regional clause (same job-location anchor as the
    // builder metric above, applied directly because the list's
    // evidence/message count subqueries have no anchor for regionScopedDb).
    const { rows: regionRows } = await db.query(
      `SELECT boundary_definition FROM admin_regions WHERE id IN ($1, $2)`, [htRegion, zipRegion]);
    const regions = regionRows.map((r) => r.boundary_definition);
    const predicate = `EXISTS (SELECT 1 FROM jobs __rj WHERE __rj.id = d.job_id AND ${locationInRegionsSql(JOB_LOC('__rj'), '$1::JSONB')})`;
    const { rows } = await db.query(`SELECT d.id FROM disputes d WHERE ${predicate}`, [JSON.stringify(regions)]);
    expect(rows).toHaveLength(1);
    const { rows: htRows } = await db.query(
      `SELECT d.id FROM disputes d JOIN jobs j ON j.id = d.job_id WHERE j.location_country_code = 'HT'`);
    expect(rows[0].id).toBe(htRows[0].id);
  });

  test('a metric whose permission has no grant stays hidden; deleting a region revokes its grants', async () => {
    expect(await permittedMetrics(regional, ['platform_revenue_cents', 'job_completion_rate_pct']))
      .toEqual(['job_completion_rate_pct']);
    await db.query('DELETE FROM admin_regions WHERE id = $1', [zipRegion]);
    const { rows } = await db.query('SELECT region_id, revoked_at FROM admin_permission_grants WHERE grantee_id = $1 ORDER BY id', [regional.id]);
    expect(rows[1].revoked_at).not.toBeNull();
    const after = await executeBuilderQuery(db, regional, { metric: 'job_completion_rate_pct', period: '7d' });
    expect(after.rows[0]).toMatchObject({ completed: 1, decided: 2 });
    await db.query(`UPDATE admin_regions SET boundary_definition = '{"type":"polygon"}' WHERE id = $1`, [htRegion]);
    await expect(executeBuilderQuery(db, regional, { metric: 'job_completion_rate_pct', period: '7d' }))
      .rejects.toMatchObject({ status: 403, code: 'region_unknown' });
  });
});
