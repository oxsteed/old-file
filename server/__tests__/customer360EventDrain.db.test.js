'use strict';

// Cost audit 2026-11-04 item 2: the set-based batch drain must build the
// exact same per-customer hash chain as customer_event_append(), across
// several customers at once, and a second drain must be a no-op.
//
// The expected hashes are recomputed here from the procedure's own formula
// (migration 20261103120000): sha256 of the pipe-joined fields with the
// occurred_at rendered in UTC with microseconds and the changes in jsonb
// canonical text. Single-key changes keep the canonical text trivial.

jest.unmock('pg');
jest.unmock('../utils/transaction');
const { disposableDatabaseOptIn } = require('./helpers/statementTestDatabase');

const database = disposableDatabaseOptIn('CUSTOMER360_TEST_DATABASE_URL');
if (database) process.env.DATABASE_URL = database;
const describeDatabase = database ? describe : describe.skip;
const crypto = require('crypto');

jest.setTimeout(120000);

test('customer event drain test requires an explicit disposable database opt-in', () => {
  expect(database === '' || database.includes('/credit_statement_test')).toBe(true);
});

describeDatabase('customer360 batch event drain', () => {
  let pool;
  let events;

  async function createUser(role) {
    const id = crypto.randomUUID();
    await pool.query(
      `INSERT INTO users (id, email, password_hash, first_name, last_name, role)
       VALUES ($1, $2, 'synthetic-unusable', 'Ana', 'Test', $3)`,
      [id, `c360-drain-${role}-${id}@example.invalid`, role]);
    return id;
  }

  beforeAll(async () => {
    pool = require('../db');
    events = require('../services/customer360Events');
  });
  afterAll(async () => { await pool.end?.(); });

  test('batch drain builds procedure-identical hashes and is idempotent', async () => {
    const customer = await createUser('customer');
    const at = new Date('2026-11-04T10:00:00.000Z');
    const atUtc = '2026-11-04T10:00:00.000000';
    const seq = [
      { source: 'login', type: 'login.succeeded', actorType: 'customer', entityType: 'login', entityId: '1', changes: '{"country": "US"}', dedupeKey: 'batch:1' },
      { source: 'login', type: 'login.failed', actorType: 'customer', entityType: 'login', entityId: '2', changes: '{"country": "FR"}', dedupeKey: 'batch:2' },
      { source: 'support', type: 'support_ticket.open', actorType: 'system', entityType: 'support_ticket', entityId: '9', changes: '{"n": 1}', dedupeKey: 'batch:3' },
    ];
    for (const e of seq) {
      await pool.query(
        `INSERT INTO customer_event_inbox (customer_id, occurred_at, source, event_type, actor_type, actor_id, entity_type, entity_id, changes, dedupe_key)
         VALUES ($1, $2, $3, $4, $5, $1, $6, $7, $8, $9)`,
        [customer, at, e.source, e.type, e.actorType, e.entityType, e.entityId, e.changes, e.dedupeKey]);
    }
    await events.drainInbox({ limit: 500 });
    const rows = (await pool.query(
      `SELECT event_hash, previous_hash, dedupe_key FROM customer_events WHERE customer_id = $1 ORDER BY id`, [customer])).rows;
    expect(rows.map((r) => r.dedupe_key)).toEqual(['batch:1', 'batch:2', 'batch:3']);
    let prev = '';
    for (let i = 0; i < seq.length; i += 1) {
      const e = seq[i];
      const input = [prev, customer, atUtc, e.source, e.type, e.actorType, customer, e.entityType, e.entityId, e.changes, e.dedupeKey].join('|');
      const expected = crypto.createHash('sha256').update(input, 'utf8').digest('hex');
      expect(rows[i].event_hash).toBe(expected);
      expect(rows[i].previous_hash).toBe(i === 0 ? null : rows[i - 1].event_hash);
      prev = expected;
    }
    const chain = await events.verifyChain(customer);
    expect(chain.intact).toBe(true);
    expect(chain.total).toBe(3);
    // Second drain: this customer's rows stay gone and its log is unchanged.
    const inboxLeft = async () => (await pool.query(
      `SELECT COUNT(*)::int AS n FROM customer_event_inbox WHERE customer_id = $1`, [customer])).rows[0].n;
    expect(await inboxLeft()).toBe(0);
    await events.drainInbox({ limit: 500 });
    expect(await inboxLeft()).toBe(0);
    expect((await pool.query(
      `SELECT COUNT(*)::int AS n FROM customer_events WHERE customer_id = $1`, [customer])).rows[0].n).toBe(3);
  });
});
