'use strict';

// Customer 360 upgrade 12 on PostgreSQL: precomputed summaries kept current
// from the event log, TTL sweep, staleness states and grant projection.

jest.unmock('pg');
jest.unmock('../utils/transaction');
const { disposableDatabaseOptIn } = require('./helpers/statementTestDatabase');

const database = disposableDatabaseOptIn('CUSTOMER360_TEST_DATABASE_URL');
if (database) process.env.DATABASE_URL = database;
const describeDatabase = database ? describe : describe.skip;
const crypto = require('crypto');
const summaries = require('../services/customer360Summaries');

jest.setTimeout(120000);

test('staleness states', () => {
  const now = new Date().toISOString();
  const row = { model_version: summaries.MODEL_VERSION, computed_at: now, event_watermark: 10, dirty_since: null };
  expect(summaries.staleness(null).state).toBe('missing');
  expect(summaries.staleness({ ...row, model_version: 'pending' }).state).toBe('missing');
  expect(summaries.staleness(row, 10).state).toBe('fresh');
  expect(summaries.staleness(row, 11).state).toBe('dirty');
  expect(summaries.staleness({ ...row, dirty_since: now }, 10).state).toBe('dirty');
  expect(summaries.staleness({ ...row, model_version: 'old' }, 10).state).toBe('outdated_model');
  const old = new Date(Date.now() - (summaries.ttlHours() * 3600 + 60) * 1000).toISOString();
  expect(summaries.staleness({ ...row, computed_at: old }, 10)).toMatchObject({ state: 'stale', ttlHours: summaries.ttlHours() });
});

test('summaries DB test requires an explicit disposable database opt-in', () => {
  expect(database === '' || database.includes('/credit_statement_test')).toBe(true);
});

describeDatabase('customer360 summaries', () => {
  let pool;
  const events = () => require('../services/customer360Events');
  async function user() {
    const id = crypto.randomUUID();
    await pool.query(`INSERT INTO users (id, email, password_hash, first_name, last_name, role) VALUES ($1, $2, 'x', 'Sam', 'Summary', 'customer')`,
      [id, `c360-sum-${id}@example.invalid`]);
    return id;
  }
  async function ticket(customer, status = 'open') {
    await pool.query(`INSERT INTO support_tickets (user_id, name, email, status) VALUES ($1, 'Sam', 'sam@example.invalid', $2)`, [customer, status]);
  }
  async function catchUp() {
    for (let i = 0; i < 50; i += 1) if ((await events().drainInbox({ limit: 500 })).moved < 500) break;
    for (let i = 0; i < 200; i += 1) if ((await summaries.markFromEvents({ batch: 10000 })).seen < 10000) break;
  }
  const row = async (id) => (await pool.query(`SELECT * FROM customer360_summaries WHERE customer_id = $1`, [id])).rows[0];
  beforeAll(async () => { pool = require('../db'); });
  afterAll(async () => { await pool.end?.(); });

  test('first read computes synchronously; later reads are a single row and report fresh', async () => {
    const c = await user();
    await ticket(c);
    await catchUp(); // events already in the log before the compute are covered by its watermark
    const first = await summaries.load(c);
    expect(first.computedNow).toBe(true);
    expect(first.row.summary.sources.tickets).toMatchObject({ n: 1 });
    expect(first.row.failed_sources).toEqual([]);
    expect(Object.keys(first.row.summary.sources).length).toBe(Object.keys(require('../services/customer360Sources').sources).length);
    await catchUp();
    const second = await summaries.load(c);
    expect(second.computedNow).toBe(false);
    expect(second.staleness.state).toBe('fresh');
  });

  test('new events mark the summary dirty; the worker recomputes it and clears the mark', async () => {
    const c = await user();
    await summaries.computeOne(c);
    await ticket(c);
    await ticket(c, 'resolved');
    await catchUp();
    const marked = await row(c);
    expect(marked.dirty_since).not.toBeNull();
    const shown = await summaries.load(c);
    expect(shown.staleness.state).toBe('dirty');
    expect(shown.row.summary.sources.tickets.n).toBe(0); // stale data is served, never blocked on
    for (let i = 0; i < 100 && (await row(c)).dirty_since; i += 1) await summaries.computeDirty({ limit: 200 });
    const after = await row(c);
    expect(after.dirty_since).toBeNull();
    expect(after.summary.sources.tickets.n).toBe(2);
    expect(Number(after.event_watermark)).toBeGreaterThan(Number(marked.event_watermark));
    // Re-reading the same events does not re-mark a summary that already covers them.
    await pool.query(`UPDATE customer360_event_consumers SET last_event_id = $1 WHERE consumer = 'summaries'`, [Number(marked.event_watermark)]);
    await catchUp();
    expect((await row(c)).dirty_since).toBeNull();
  });

  test('events for customers with no summary create a pending row that the worker fills', async () => {
    const c = await user();
    await ticket(c);
    await catchUp();
    const pending = await row(c);
    expect(pending).toMatchObject({ model_version: 'pending' });
    expect(summaries.staleness(pending).state).toBe('missing');
    for (let i = 0; i < 100 && (await row(c)).dirty_since; i += 1) await summaries.computeDirty({ limit: 200 });
    expect(await row(c)).toMatchObject({ model_version: summaries.MODEL_VERSION, dirty_since: null });
  });

  test('TTL sweep refreshes old and outdated-model rows; leases prevent double claims', async () => {
    const c = await user();
    await summaries.computeOne(c);
    await pool.query(`UPDATE customer360_summaries SET computed_at = NOW() - interval '30 days', model_version = 'c360-summary-v0' WHERE customer_id = $1`, [c]);
    expect((await summaries.load(c)).staleness.state).toBe('outdated_model');
    await pool.query(`UPDATE customer360_summaries SET dirty_since = NULL, claimed_until = NOW() + interval '1 minute' WHERE customer_id = $1`, [c]);
    await summaries.sweepStale({ limit: 1000 });
    expect((await row(c)).model_version).toBe('c360-summary-v0'); // leased by another worker
    await pool.query(`UPDATE customer360_summaries SET claimed_until = NULL WHERE customer_id = $1`, [c]);
    for (let i = 0; i < 100 && (await row(c)).model_version !== summaries.MODEL_VERSION; i += 1) await summaries.sweepStale({ limit: 1000 });
    expect(await row(c)).toMatchObject({ model_version: summaries.MODEL_VERSION, claimed_until: null });
    const b = await summaries.backlog();
    expect(b).toHaveProperty('dirty');
  });

  test('presentation only shows sources, anomaly kinds and topics the admin may see', async () => {
    const c = await user();
    await ticket(c);
    await pool.query(`INSERT INTO customer360_queue_items (queue_id, customer_id, topic, source, reason, status, created_by, due_at)
      SELECT id, $1, 'general', 'manual', 'Call back', 'open', NULL, NOW() + interval '1 day' FROM customer360_queues WHERE queue_key = 'general'`, [c]);
    const loaded = await summaries.load(c, { force: true });
    const supportOnly = await summaries.present(loaded, { can: async (d) => d.grant === 'manage_support' && !d.superOnly, anomalyKinds: [], topics: [] });
    expect(supportOnly.areas.map((a) => a.area)).toEqual(['support']);
    expect(supportOnly.areas[0]).toMatchObject({ count: 1, last30: 1 });
    expect(supportOnly.queues).toEqual({});
    const withTopics = await summaries.present(loaded, { can: async () => false, anomalyKinds: [], topics: ['general'] });
    expect(withTopics.areas).toEqual([]);
    expect(withTopics.queues.general).toMatchObject({ open: 1, breached: 0 });
    expect(withTopics.staleness.state).toBe('fresh');
  });

  test('summaries cascade with the user; computing a missing user is a no-op', async () => {
    const { rows: [fk] } = await pool.query(`SELECT confdeltype FROM pg_constraint
      WHERE conrelid = 'customer360_summaries'::regclass AND contype = 'f' AND confrelid = 'users'::regclass`);
    expect(fk.confdeltype).toBe('c');
    expect(await summaries.computeOne(crypto.randomUUID())).toBeNull();
  });
});
