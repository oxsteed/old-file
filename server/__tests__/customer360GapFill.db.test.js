'use strict';

// PR #679 gap fills for Customer 360 on PostgreSQL:
//  7  platform anomaly list: customer names and keyset paging on the sort order
//  8  summary health: worker heartbeats, flag and backlog state
//  12 the inbox template read is audited and fails closed
//  5/11 queue setup and saved-view rename through the HTTP controllers

jest.unmock('pg');
jest.unmock('../utils/transaction');
const { disposableDatabaseOptIn } = require('./helpers/statementTestDatabase');

const database = disposableDatabaseOptIn('CUSTOMER360_TEST_DATABASE_URL');
if (database) process.env.DATABASE_URL = database;
const describeDatabase = database ? describe : describe.skip;
const crypto = require('crypto');

jest.setTimeout(120000);

test('customer360 gap-fill DB test requires an explicit disposable database opt-in', () => {
  expect(database === '' || database.includes('/credit_statement_test')).toBe(true);
});

describeDatabase('customer360 gap fills', () => {
  let pool;
  let controller;
  let summaries;
  let job;
  let anomalies;
  async function person(role = 'customer', first = 'Gap') {
    const id = crypto.randomUUID();
    await pool.query(`INSERT INTO users (id, email, password_hash, first_name, last_name, role) VALUES ($1, $2, 'x', $3, 'Fill', $4)`,
      [id, `c360-gap-${id}@example.invalid`, first, role]);
    return id;
  }
  const reqFor = (adminId, extra = {}) => ({
    user: { id: adminId, role: 'super_admin' }, params: {}, query: {}, body: {}, headers: {}, ip: '127.0.0.1', get: () => undefined, ...extra,
  });
  // Runs an Express handler and resolves with the JSON body or rejects with the error passed to next().
  const call = (handler, req) => new Promise((resolve, reject) => {
    const res = { set() { return res; }, status() { return res; }, json: resolve };
    Promise.resolve(handler(req, res, reject)).catch(reject);
  });
  const audits = async (adminId, action) => (await pool.query(
    `SELECT target_id, description FROM admin_audit_log WHERE admin_id = $1 AND action = $2 ORDER BY id`, [adminId, action])).rows;

  beforeAll(async () => {
    pool = require('../db');
    controller = require('../controllers/customer360UpgradesController');
    summaries = require('../services/customer360Summaries');
    job = require('../jobs/customer360Upgrades');
    anomalies = require('../services/customer360Anomalies');
  });
  afterEach(() => jest.restoreAllMocks());
  afterAll(async () => { await pool.end?.(); });

  test('heartbeats record success, failures in a row and recovery without ever throwing', async () => {
    const task = { name: `gap-task-${crypto.randomUUID().slice(0, 8)}`, everyMs: 15000 };
    await job.heartbeat(task, { startedAt: Date.now() - 50, ok: true });
    await job.heartbeat(task, { startedAt: Date.now(), ok: false, error: Object.assign(new Error('x'), { code: 'ECONNRESET' }) });
    await job.heartbeat(task, { startedAt: Date.now(), ok: false, error: new TypeError('y') });
    let row = (await pool.query(`SELECT * FROM customer360_worker_heartbeats WHERE task = $1`, [task.name])).rows[0];
    expect(row).toMatchObject({ consecutive_failures: 2, last_error_code: 'TypeError', every_ms: 15000 });
    expect(Number(row.runs)).toBe(3);
    expect(Number(row.failures)).toBe(2);
    expect(row.last_ok_at).not.toBeNull();
    await job.heartbeat(task, { startedAt: Date.now(), ok: true });
    row = (await pool.query(`SELECT * FROM customer360_worker_heartbeats WHERE task = $1`, [task.name])).rows[0];
    expect(row.consecutive_failures).toBe(0);
    expect(Number(row.failures)).toBe(2);
    // A database failure is logged, not thrown, so the worker loop keeps going.
    jest.spyOn(pool, 'query').mockRejectedValueOnce(new Error('db down'));
    await expect(job.heartbeat(task, { startedAt: Date.now(), ok: true })).resolves.toBeUndefined();
    await pool.query(`DELETE FROM customer360_worker_heartbeats WHERE task = $1`, [task.name]);
  });

  test('summary health reports the flag, worker states and the backlog', async () => {
    await pool.query(`DELETE FROM customer360_worker_heartbeats`);
    const prev = process.env.CUSTOMER360_UPGRADES_ENABLED;
    try {
      process.env.CUSTOMER360_UPGRADES_ENABLED = 'false';
      expect((await summaries.health()).state).toBe('disabled');
      delete process.env.CUSTOMER360_UPGRADES_ENABLED;
      const empty = await summaries.health();
      expect(empty).toMatchObject({ enabled: true, state: 'not_started', workers: [], modelVersion: summaries.MODEL_VERSION });
      expect(empty.stale).toMatchObject({ capped: false });
      expect(typeof empty.events.latestEventId).toBe('string');

      for (const name of ['summary-events', 'summary-dirty', 'summary-stale']) await job.heartbeat({ name, everyMs: 15000 }, { startedAt: Date.now(), ok: true });
      const ok = await summaries.health();
      expect(ok.workers.map((w) => [w.task, w.status])).toEqual([['summary-dirty', 'ok'], ['summary-events', 'ok'], ['summary-stale', 'ok']]);
      expect(['healthy', 'behind']).toContain(ok.state); // other tests may leave dirty rows behind

      // Late: last success older than three intervals.
      const later = await summaries.health({ now: new Date(Date.now() + 10 * 60_000) });
      expect(later.state).toBe('behind');
      expect(later.workers.every((w) => w.status === 'late')).toBe(true);

      await job.heartbeat({ name: 'summary-dirty', everyMs: 15000 }, { startedAt: Date.now(), ok: false, error: { code: 'XX000' } });
      const failing = await summaries.health();
      expect(failing.state).toBe('failing');
      expect(failing.workers.find((w) => w.task === 'summary-dirty')).toMatchObject({ status: 'failing', last_error_code: 'XX000' });
    } finally {
      if (prev === undefined) delete process.env.CUSTOMER360_UPGRADES_ENABLED; else process.env.CUSTOMER360_UPGRADES_ENABLED = prev;
      await pool.query(`DELETE FROM customer360_worker_heartbeats`);
    }
  });

  test('the summary health route is audited, and fails when the audit cannot be written', async () => {
    const admin = await person('super_admin', 'Ops');
    const body = await call(controller.summaryHealth, reqFor(admin));
    expect(body).toHaveProperty('state');
    expect(await audits(admin, 'customer360_summary_health_read')).toHaveLength(1);
    const real = pool.query.bind(pool);
    jest.spyOn(pool, 'query').mockImplementation((sql, ...rest) =>
      (String(sql).includes('INSERT INTO admin_audit_log') ? Promise.reject(new Error('audit down')) : real(sql, ...rest)));
    await expect(call(controller.summaryHealth, reqFor(admin))).rejects.toThrow();
  });

  test('gap fill 12: rendering an inbox template is an audited read that fails closed', async () => {
    const admin = await person('super_admin', 'Ops');
    const customer = await person('customer', 'Rosa');
    const req = reqFor(admin, { params: { userId: customer, templateKey: 'general' }, query: { language: 'es' } });
    const t = await call(controller.inboxTemplate, req);
    expect(JSON.stringify(t)).toContain('Rosa');
    const rows = await audits(admin, 'customer360_inbox_template_read');
    expect(rows).toHaveLength(1);
    expect(rows[0].target_id).toBe(customer);
    expect(JSON.parse(rows[0].description)).toMatchObject({ template: 'general' });
    const real = pool.query.bind(pool);
    jest.spyOn(pool, 'query').mockImplementation((sql, ...rest) =>
      (String(sql).includes('INSERT INTO admin_audit_log') ? Promise.reject(new Error('audit down')) : real(sql, ...rest)));
    await expect(call(controller.inboxTemplate, req)).rejects.toThrow();
  });

  test('gap fill 7: the platform list names customers and pages on its own sort order', async () => {
    const admin = await person('super_admin', 'Ops');
    const a = await person('customer', 'Ana');
    const b = await person('customer', 'Ben');
    const at = new Date(Date.now() + 3650 * 86400000); // newest rows in the table, so they lead the list
    const ins = async (customer, kind, detected) => (await pool.query(
      `INSERT INTO customer_anomalies (customer_id, kind, status, occurrences, first_detected_at, last_detected_at, evidence)
       VALUES ($1, $2, 'open', 1, $3, $3, '{}'::jsonb) RETURNING id::text`,
      [customer, kind, detected])).rows[0].id;
    // Insert order differs from detection order: id order alone would page wrongly.
    const late = await ins(a, 'refund_spike', at);
    const early = await ins(b, 'new_country_login', new Date(at.getTime() + 60_000));
    const kinds = ['refund_spike', 'new_country_login', 'payout_failures'];
    const first = await anomalies.list({ kinds, statuses: ['open'], limit: 1 });
    expect(first.map((r) => r.id)).toEqual([early]);
    expect(first[0].customer_name).toBe('Ben Fill');
    const second = await anomalies.list({ kinds, statuses: ['open'], limit: 1, before: first[0].id });
    expect(second.map((r) => r.id)).toEqual([late]);
    expect(second[0].customer_name).toBe('Ana Fill');

    const page = await call(controller.anomalyQueue, reqFor(admin, { query: { status: 'open' } }));
    expect(page.anomalies.slice(0, 2).map((r) => r.id)).toEqual([early, late]);
    expect(await audits(admin, 'customer360_anomaly_queue_read')).toHaveLength(1);
    await pool.query(`DELETE FROM customer_anomalies WHERE id = ANY($1::bigint[])`, [[late, early]]);
  });

  test('gap fills 5 and 11: queue setup and saved-view rename through the controllers', async () => {
    const admin = await person('super_admin', 'Ops');
    const key = `gap_${crypto.randomUUID().slice(0, 8)}`;
    const created = await call(controller.createQueue, reqFor(admin, { body: { queueKey: key, name: 'Gap queue', description: 'Gap', slaMinutes: 30 } }));
    const q = created.queue || created;
    expect(q).toMatchObject({ queue_key: key, sla_minutes: 30 });
    const updated = await call(controller.updateQueue, reqFor(admin, { params: { queueId: String(q.id) }, body: { revision: q.revision, name: 'Gap queue 2', slaMinutes: 90, active: false } }));
    expect(updated.queue || updated).toMatchObject({ name: 'Gap queue 2', sla_minutes: 90, active: false });
    await expect(call(controller.updateQueue, reqFor(admin, { params: { queueId: String(q.id) }, body: { revision: q.revision, name: 'Stale' } })))
      .rejects.toMatchObject({ code: 'revision_conflict' });

    const view = await call(controller.createSavedView, reqFor(admin, { body: { name: 'Gap view', scope: 'private', filters: { breachedOnly: true } } }));
    const v = view.view || view;
    const renamed = await call(controller.updateSavedView, reqFor(admin, { params: { viewId: v.id }, body: { name: 'Gap view renamed', scope: 'team', filters: v.filters, revision: v.revision } }));
    expect(renamed.view || renamed).toMatchObject({ name: 'Gap view renamed', scope: 'team', revision: v.revision + 1 });
    await expect(call(controller.updateSavedView, reqFor(admin, { params: { viewId: v.id }, body: { name: 'Again', scope: 'team', filters: {}, revision: v.revision } })))
      .rejects.toMatchObject({ code: 'revision_conflict' });
  });
});
