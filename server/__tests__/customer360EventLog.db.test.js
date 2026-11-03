'use strict';

// Customer 360 upgrade 1 on a real PostgreSQL: source triggers capture into
// the outbox, the drain builds a per-customer SHA-256 chain, the log refuses
// UPDATE/DELETE/TRUNCATE, personal fields are redacted, the backfill does not
// duplicate live history, and replay rebuilds an entity's state at a time.

jest.unmock('pg');
jest.unmock('../utils/transaction');
const { disposableDatabaseOptIn } = require('./helpers/statementTestDatabase');

const database = disposableDatabaseOptIn('CUSTOMER360_TEST_DATABASE_URL');
if (database) process.env.DATABASE_URL = database;
const describeDatabase = database ? describe : describe.skip;
const crypto = require('crypto');

jest.setTimeout(120000);

test('customer event log test requires an explicit disposable database opt-in', () => {
  expect(database === '' || database.includes('/credit_statement_test')).toBe(true);
});

describeDatabase('customer360 unified event log', () => {
  let pool;
  let events;
  let audit;
  let customer;
  let admin;

  async function createUser(role) {
    const id = crypto.randomUUID();
    await pool.query(
      `INSERT INTO users (id, email, password_hash, first_name, last_name, role)
       VALUES ($1, $2, 'synthetic-unusable', 'Ana', 'Test', $3)`,
      [id, `c360-ev-${role}-${id}@example.invalid`, role]);
    return id;
  }
  async function drainAll() {
    for (let i = 0; i < 100; i += 1) {
      const { moved } = await events.drainInbox({ limit: 500 });
      if (!moved) return;
    }
  }

  beforeAll(async () => {
    pool = require('../db');
    events = require('../services/customer360Events');
    audit = require('../services/auditService');
    customer = await createUser('customer');
    admin = await createUser('admin');
  });
  afterAll(async () => { await pool.end?.(); });

  test('captures login, support and admin audit rows into a hashed chain', async () => {
    await pool.query(
      `INSERT INTO user_login_history (user_id, ip_address, user_agent, country_code, success) VALUES ($1, '203.0.113.9', 'jest', 'HT', true)`,
      [customer]);
    const { rows: [ticket] } = await pool.query(
      `INSERT INTO support_tickets (user_id, name, email, status) VALUES ($1, 'Ana', 'ana@example.invalid', 'open') RETURNING id`, [customer]);
    await pool.query(`UPDATE support_tickets SET status = 'waiting_user', updated_at = clock_timestamp() WHERE id = $1`, [ticket.id]);
    await pool.query(`UPDATE support_tickets SET status = 'open', updated_at = clock_timestamp() WHERE id = $1`, [ticket.id]);
    await audit.logAdminAction({
      adminId: admin, action: 'user_role_changed', targetType: 'user', targetId: customer,
      before: { role: 'customer', email: 'old@example.invalid' }, after: { role: 'helper', email: 'new@example.invalid' },
      throwOnError: true,
    });
    await drainAll();

    const { rows } = await pool.query(
      `SELECT source, event_type, actor_type, entity_type, entity_id, changes FROM customer_events WHERE customer_id = $1 ORDER BY id`, [customer]);
    const types = rows.map((r) => r.event_type);
    expect(types).toEqual(expect.arrayContaining(['login.succeeded', 'support_ticket.open', 'support_ticket.waiting_user', 'admin.user_role_changed']));
    // Re-entering "open" is a second, separate event.
    expect(types.filter((t) => t === 'support_ticket.open')).toHaveLength(2);
    const roleChange = rows.find((r) => r.event_type === 'admin.user_role_changed');
    expect(roleChange.actor_type).toBe('admin');
    expect(roleChange.changes.role).toEqual({ from: 'customer', to: 'helper' });
    expect(roleChange.changes.email).toEqual({ changed: true, redacted: true });
    expect(JSON.stringify(rows)).not.toContain('example.invalid');
    expect(JSON.stringify(rows)).not.toContain('203.0.113.9');

    const chain = await events.verifyChain(customer);
    expect(chain).toMatchObject({ intact: true });
    expect(chain.total).toBeGreaterThanOrEqual(5);
  });

  test('the log is append-only', async () => {
    const { rows: [one] } = await pool.query('SELECT id FROM customer_events WHERE customer_id = $1 LIMIT 1', [customer]);
    await expect(pool.query(`UPDATE customer_events SET event_type = 'x' WHERE id = $1`, [one.id])).rejects.toThrow(/append-only/i);
    await expect(pool.query('DELETE FROM customer_events WHERE id = $1', [one.id])).rejects.toThrow(/append-only/i);
    await expect(pool.query('TRUNCATE customer_events')).rejects.toThrow();
  });

  test('direct writes are idempotent and validated', async () => {
    const key = `c360-test:${crypto.randomUUID()}`;
    const evt = { customerId: customer, source: 'customer360', type: 'task.created', actorType: 'admin', actorId: admin,
      entityType: 'task', entityId: 'T1', changes: { status: { to: 'open' } }, dedupeKey: key };
    const first = await events.append(null, evt);
    const second = await events.append(null, evt);
    expect(second).toBe(first);
    await expect(events.append(null, { ...evt, source: 'nope' })).rejects.toMatchObject({ code: 'invalid_event' });
  });

  test('backfill records untracked entities once and skips ones with history', async () => {
    const quiet = await createUser('customer');
    await pool.query('ALTER TABLE support_tickets DISABLE TRIGGER support_tickets_customer_event');
    let legacy;
    try {
      ({ rows: [legacy] } = await pool.query(
        `INSERT INTO support_tickets (user_id, name, email, status) VALUES ($1, 'Q', 'q@example.invalid', 'resolved') RETURNING id`, [quiet]));
    } finally {
      await pool.query('ALTER TABLE support_tickets ENABLE TRIGGER support_tickets_customer_event');
    }
    const before = await pool.query('SELECT COUNT(*)::int AS n FROM customer_events WHERE customer_id = $1', [customer]);
    await pool.query(`DELETE FROM customer_event_ingest_cursors WHERE source = 'support'`);
    for (let i = 0; i < 1000; i += 1) {
      const r = await events.backfillSource('support', { batch: 1000 });
      if (r.done) break;
    }
    await drainAll();
    const legacyEvents = await pool.query(
      `SELECT event_type, changes FROM customer_events WHERE customer_id = $1 AND entity_id = $2`, [quiet, legacy.id]);
    expect(legacyEvents.rows).toHaveLength(1);
    expect(legacyEvents.rows[0]).toMatchObject({ event_type: 'support_ticket.resolved', changes: { backfilled: true } });
    const after = await pool.query('SELECT COUNT(*)::int AS n FROM customer_events WHERE customer_id = $1', [customer]);
    expect(after.rows[0].n).toBe(before.rows[0].n);
    // A second walk is a no-op.
    expect(await events.backfillSource('support')).toMatchObject({ done: true });
  });

  test('list filters by viewer sources and paginates; replay folds state', async () => {
    const filter = events.eventFilters({ limit: '2' });
    const page1 = await events.listEvents(customer, filter, ['support', 'login']);
    expect(page1.events).toHaveLength(2);
    expect(page1.events.every((e) => ['support', 'login'].includes(e.source))).toBe(true);
    expect(page1.nextBefore).toBeTruthy();
    const page2 = await events.listEvents(customer, { ...filter, before: page1.nextBefore }, ['support', 'login']);
    expect(Number(page2.events[0].id)).toBeLessThan(Number(page1.nextBefore) + 1);
    const hidden = await events.listEvents(customer, filter, ['support']);
    expect(hidden.events.some((e) => e.source === 'admin_audit')).toBe(false);
    expect(() => events.eventFilters({ before: 'x' })).toThrow();

    const { rows: [t] } = await pool.query(
      `SELECT entity_id FROM customer_events WHERE customer_id = $1 AND entity_type = 'support_ticket' LIMIT 1`, [customer]);
    const now = await events.replay(customer, { entityType: 'support_ticket', entityId: t.entity_id }, ['support']);
    expect(now.state.status).toBe('open');
    expect(now.steps).toHaveLength(3);
    const early = await events.replay(customer, { entityType: 'support_ticket', entityId: t.entity_id, at: now.steps[1].occurredAt }, ['support']);
    expect(early.state.status).toBe('waiting_user');
    const denied = await events.replay(customer, { entityType: 'support_ticket', entityId: t.entity_id }, ['login']);
    expect(denied.steps).toHaveLength(0);

    const adminReplay = await events.replay(customer, { entityType: 'admin_action', entityId: (await pool.query(
      `SELECT entity_id FROM customer_events WHERE customer_id = $1 AND event_type = 'admin.user_role_changed'`, [customer])).rows[0].entity_id }, ['admin_audit']);
    expect(adminReplay.state.role).toBe('helper');
    expect(adminReplay.unknownFields).toEqual(['email']);
  });
});
