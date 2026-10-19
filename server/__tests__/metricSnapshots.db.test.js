'use strict';

// Decision 4: nightly governed-metric snapshots. Real schema copies (LIKE
// public.* INCLUDING ALL) in a disposable schema; covers per-day cohort
// values, backfill, idempotency, recompute, fencing, regional series,
// point-in-time capture, trend reads + audit, and the support daily rollups
// that the old business analytics endpoints read.
const crypto = require('crypto');
const schema = `metric_snap_${crypto.randomBytes(6).toString('hex')}`;
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
const { runMetricSnapshots } = require('../jobs/metricSnapshots');
const snapshots = require('../analytics/metricSnapshots');
const { assertMetricAccess } = require('../analytics/metricAccess');
const controller = require('../controllers/analyticsQueryController');

const TABLES = ['users', 'admin_regions', 'admin_permission_grants', 'delegation_grants', 'jobs', 'disputes', 'payments',
  'platform_ledger', 'subscriptions', 'plans', 'consulting_sessions', 'consulting_session_feedback', 'businesses',
  'support_employers', 'support_agents', 'support_teams', 'team_members', 'support_conversations',
  'support_conversation_reviews', 'support_sla_targets', 'analytics_query_audit', 'admin_audit_log',
  'metric_snapshot_runs', 'metric_daily_snapshots', 'agent_daily_performance', 'team_daily_performance',
  'business_daily_metrics'];
const NOW = '2026-10-19T12:00:00Z';

(url ? describe : describe.skip)('metric snapshot pipeline', () => {
  const superAdmin = { id: crypto.randomUUID(), role: 'super_admin' };
  const regional = { id: crypto.randomUUID(), role: 'admin' };
  const customer = crypto.randomUUID();
  let region;

  const user = (id, role) => db.query(`INSERT INTO users(id, email, password_hash, first_name, last_name, role)
    VALUES($1, $2, 'x', 'T', 'U', $3)`, [id, `${id}@example.test`, role]);
  const job = (status, createdAt, country) => db.query(`INSERT INTO jobs(id, client_id, title, description, status,
      created_at, location_country_code) VALUES($1,$2,'t','d',$3,$4,$5)`,
  [crypto.randomUUID(), customer, status, createdAt, country]);

  beforeAll(async () => {
    await db.query(`CREATE SCHEMA ${schema}`);
    for (const t of TABLES) await db.query(`CREATE TABLE ${schema}.${t} (LIKE public.${t} INCLUDING ALL)`);
    await user(superAdmin.id, 'super_admin'); await user(regional.id, 'admin'); await user(customer, 'customer');
    ({ rows: [{ id: region }] } = await db.query(`INSERT INTO admin_regions(name, boundary_definition, created_by)
      VALUES('Haiti', '{"type":"country_only","countries":["HT"]}', $1) RETURNING id`, [superAdmin.id]));
    await db.query(`INSERT INTO admin_permission_grants(grantor_id, grantee_id, permissions, expires_at, region_id)
      VALUES($1, $2, '["manage_operations"]', NOW() + INTERVAL '30 days', $3)`, [superAdmin.id, regional.id, region]);
    // 2026-10-16: HT 1 completed + 1 cancelled, US 1 completed. 2026-10-17: US 1 cancelled. 10-18: nothing.
    await job('completed', '2026-10-16T03:00:00Z', 'HT');
    await job('cancelled', '2026-10-16T20:00:00Z', 'HT');
    await job('completed', '2026-10-16T23:59:59Z', 'US');
    await job('cancelled', '2026-10-17T00:00:00Z', 'US');
    await db.query(`INSERT INTO platform_ledger(source_type, amount_cents, currency, created_at)
      VALUES('job_fee', 1250, 'usd', '2026-10-17T10:00:00Z'), ('job_fee', 900, 'htg', '2026-10-17T11:00:00Z')`);
  });
  afterAll(async () => { await db.query(`DROP SCHEMA ${schema} CASCADE`); await db.end(); });

  const series = async (metric, scopeKey = 'global', dim = '') => (await db.query(
    `SELECT to_char(snapshot_date,'YYYY-MM-DD') AS d, value::TEXT AS value, components, source, value_kind
       FROM metric_daily_snapshots WHERE metric_name=$1 AND scope_key=$2 AND dimension_key=$3 ORDER BY snapshot_date`,
    [metric, scopeKey, dim])).rows;

  test('backfill writes one governed per-day value per metric and scope', async () => {
    const result = await runMetricSnapshots({ kind: 'backfill', from: '2026-10-16', to: '2026-10-18', now: NOW });
    expect(result).toMatchObject({ status: 'succeeded', days: 3, failures: [] });
    const global = await series('job_completion_rate_pct');
    expect(global.map(r => [r.d, r.value])).toEqual([['2026-10-16', '66.67'], ['2026-10-17', '0'], ['2026-10-18', null]]);
    expect(global[0].components).toMatchObject({ completed: 2, decided: 3 });
    expect(global[0]).toMatchObject({ source: 'backfill', value_kind: 'daily_cohort' });
    const regionalKey = `regions:${region}`;
    expect((await series('job_completion_rate_pct', regionalKey)).map(r => r.value)).toEqual(['50', null, null]);
    // A metric without a regional grant has no regional series.
    expect(await series('platform_revenue_cents', regionalKey)).toEqual([]);
    expect((await series('platform_revenue_cents', 'global', 'USD')).map(r => [r.d, r.value])).toEqual([['2026-10-17', '1250']]);
    expect((await series('platform_revenue_cents')).length).toBe(3);
    // Point-in-time metrics are never backfilled.
    expect(await series('open_disputes')).toEqual([]);
  });

  test('reruns are idempotent; only an explicit recompute replaces rows', async () => {
    await job('completed', '2026-10-17T05:00:00Z', 'US');
    const again = await runMetricSnapshots({ kind: 'backfill', from: '2026-10-16', to: '2026-10-18', now: NOW });
    expect(again.written).toBe(0);
    expect((await series('job_completion_rate_pct'))[1].value).toBe('0');
    const recompute = await runMetricSnapshots({ kind: 'backfill', from: '2026-10-17', to: '2026-10-17', recompute: true, now: NOW });
    expect(recompute.written).toBeGreaterThan(0);
    expect((await series('job_completion_rate_pct'))[1].value).toBe('50');
    const { rows } = await db.query('SELECT COUNT(*)::INT AS n FROM metric_daily_snapshots WHERE metric_name=$1 AND scope_key=$2',
      ['job_completion_rate_pct', 'global']);
    expect(rows[0].n).toBe(3);
  });

  test('nightly run captures point-in-time values for today once and fills missing closed days', async () => {
    await db.query(`INSERT INTO disputes(job_id, status, raised_by, against_user, reason, description)
      SELECT id, 'open', client_id, client_id, 'other', 'x' FROM jobs LIMIT 1`);
    process.env.METRIC_SNAPSHOT_LOOKBACK_DAYS = '4';
    try {
      const nightly = await runMetricSnapshots({ now: NOW });
      expect(nightly.status).toBe('succeeded');
      expect(nightly.days).toBe(1); // 2026-10-15 was missing; 16..18 already exist
      const open = await series('open_disputes');
      expect(open).toEqual([expect.objectContaining({ d: '2026-10-19', value: '1', value_kind: 'point_in_time', source: 'nightly' })]);
      expect((await runMetricSnapshots({ now: NOW })).written).toBe(0);
    } finally { delete process.env.METRIC_SNAPSHOT_LOOKBACK_DAYS; }
  });

  test('a concurrent run is fenced out by the lock and the single-running-run index', async () => {
    const holder = await db.connect();
    try {
      await holder.query("SELECT pg_advisory_lock(hashtextextended('metric-snapshots',0))");
      expect(await runMetricSnapshots({ now: NOW })).toEqual({ skipped: 'locked' });
    } finally {
      await holder.query("SELECT pg_advisory_unlock(hashtextextended('metric-snapshots',0))");
      holder.release();
    }
    await db.query(`INSERT INTO metric_snapshot_runs(kind, from_date, to_date) VALUES('nightly','2026-10-18','2026-10-18')`);
    await expect(db.query(`INSERT INTO metric_snapshot_runs(kind, from_date, to_date) VALUES('nightly','2026-10-18','2026-10-18')`))
      .rejects.toMatchObject({ code: '23505' });
    // The next lock holder supersedes the orphaned running row and proceeds.
    const next = await runMetricSnapshots({ now: NOW });
    expect(next.status).toBe('succeeded');
    const { rows } = await db.query(`SELECT COUNT(*)::INT AS n FROM metric_snapshot_runs WHERE error_code='superseded'`);
    expect(rows[0].n).toBe(1);
  });

  test('trend reads return only the caller\'s own scope and are audited', async () => {
    const scope = await assertMetricAccess(regional, 'job_completion_rate_pct');
    const trend = await snapshots.readTrend(db, scope, { metric: 'job_completion_rate_pct', days: 30, today: '2026-10-19' });
    expect(trend.scope).toEqual({ kind: 'regional', regionIds: [region] });
    expect(trend.points.find(p => p.date === '2026-10-16').value).toBe('50');
    const money = await snapshots.readTrend(db, { global: true }, { metric: 'platform_revenue_cents', days: 30, currency: 'HTG', today: '2026-10-19' });
    expect(money.points.map(p => [p.date, p.value])).toEqual([['2026-10-15', '0'], ['2026-10-16', '0'], ['2026-10-17', '900'], ['2026-10-18', '0']]);
    const res = { set: jest.fn(), json: jest.fn() }; const next = jest.fn();
    await controller.getTrend({ user: regional, query: { metric: 'job_completion_rate_pct', days: '30' } }, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.json.mock.calls[0][0].scope.kind).toBe('regional');
    await controller.getTrend({ user: regional, query: { metric: 'platform_revenue_cents', days: '30' } }, res, next);
    expect(next.mock.calls[0][0]).toMatchObject({ code: 'metric_permission_required' });
    const { rows } = await db.query(`SELECT success, scope_kind, error_code FROM analytics_query_audit
      WHERE admin_user_id=$1 AND event_type='trend' ORDER BY id`, [regional.id]);
    expect(rows).toHaveLength(2);
    expect(rows).toEqual(expect.arrayContaining([{ success: true, scope_kind: 'regional', error_code: null },
      { success: false, scope_kind: null, error_code: 'metric_permission_required' }]));
  });

  test('support daily rollups feed the business support analytics tables', async () => {
    const owner = crypto.randomUUID(); await user(owner, 'customer');
    const { rows: [{ id: businessId }] } = await db.query(`INSERT INTO businesses(user_id, business_name) VALUES($1,'Desk') RETURNING id`, [owner]);
    const { rows: [{ id: employerId }] } = await db.query(`INSERT INTO support_employers(kind, business_id) VALUES('business',$1) RETURNING id`, [businessId]);
    const { rows: [{ id: agentId }] } = await db.query(`INSERT INTO support_agents(user_id, employer_id, business_id) VALUES($1,$2,$3) RETURNING id`, [owner, employerId, businessId]);
    const conv = (created, firstResponse, resolved) => db.query(`INSERT INTO support_conversations(subject, business_id, agent_id, status,
        created_at, first_response_at, resolved_at, sla_first_response_target) VALUES('s',$1,$2,'open',$3,$4,$5,$3::TIMESTAMP + INTERVAL '1 hour') RETURNING id`,
    [businessId, agentId, created, firstResponse, resolved]);
    const { rows: [{ id: c1 }] } = await conv('2026-10-14 10:00', '2026-10-14 10:30', '2026-10-14 12:00');
    await conv('2026-10-14 11:00', '2026-10-14 13:00', null);
    await db.query(`INSERT INTO support_conversation_reviews(conversation_id, customer_id, rating) VALUES($1, $2, 4)`, [c1, owner]);
    await runMetricSnapshots({ kind: 'backfill', from: '2026-10-14', to: '2026-10-14', recompute: true, now: NOW });
    const { rows: [agent] } = await db.query('SELECT * FROM agent_daily_performance WHERE agent_id=$1', [agentId]);
    expect(agent).toMatchObject({ conversations_handled: 2, conversations_resolved: 1, avg_first_response_seconds: 4500,
      sla_first_response_met_count: 1, sla_first_response_violated_count: 1, business_id: businessId });
    expect(agent.avg_csat_score).toBe('4.00');
    const { rows: [biz] } = await db.query('SELECT * FROM business_daily_metrics WHERE business_id=$1', [businessId]);
    expect(biz).toMatchObject({ total_conversations_created: 2, total_conversations_resolved: 1, total_agents_active: 1 });
    expect(biz.sla_first_response_compliance).toBe('0.50');
    await runMetricSnapshots({ kind: 'backfill', from: '2026-10-14', to: '2026-10-14', recompute: true, now: NOW });
    const { rows: [{ n }] } = await db.query('SELECT COUNT(*)::INT AS n FROM agent_daily_performance');
    expect(n).toBe(1);
  });
});
