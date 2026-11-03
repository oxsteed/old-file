'use strict';

// Customer 360 upgrade 11 on PostgreSQL: the customer's "your data"
// categories, the Customer 360 export sections and erasure.

jest.unmock('pg');
jest.unmock('../utils/transaction');
const { disposableDatabaseOptIn } = require('./helpers/statementTestDatabase');

const database = disposableDatabaseOptIn('CUSTOMER360_TEST_DATABASE_URL');
if (database) process.env.DATABASE_URL = database;
const describeDatabase = database ? describe : describe.skip;
const crypto = require('crypto');
const privacy = require('../services/customer360Privacy');
const { sources } = require('../services/customer360Sources');

jest.setTimeout(120000);
const HASH = crypto.randomBytes(32).toString('hex');

test('every admin area is mirrored and has an erasure rule; internal sources are never itemized', () => {
  const areas = new Set(Object.values(sources).map((d) => d.area));
  for (const a of areas) expect(privacy.ON_ERASURE[a]).toMatch(/^(removed|anonymized|retained)$/);
  const keys = privacy.customerSources().map(([k]) => k);
  for (const k of privacy.INTERNAL_SOURCES) expect(keys).not.toContain(k);
});

test('privacy DB test requires an explicit disposable database opt-in', () => {
  expect(database === '' || database.includes('/credit_statement_test')).toBe(true);
});

describeDatabase('customer360 your data', () => {
  let pool;
  let c;
  let admin;
  beforeAll(async () => {
    pool = require('../db');
    c = crypto.randomUUID();
    admin = crypto.randomUUID();
    await pool.query(`INSERT INTO users (id, email, password_hash, first_name, last_name, role) VALUES
      ($1, $2, 'x', 'Yara', 'Data', 'customer'), ($3, $4, 'x', 'Ad', 'Min', 'admin')`,
      [c, `c360-yd-${c}@example.invalid`, admin, `c360-yd-${admin}@example.invalid`]);
    await pool.query(`INSERT INTO support_tickets (user_id, name, email, subject, status) VALUES ($1, 'Yara', 'y@example.invalid', 'Help', 'open')`, [c]);
    await pool.query(`INSERT INTO customer_outbound_messages (customer_id, admin_id, channel, language, subject, body, body_hash, body_preview, recipient_masked, status, client_message_id)
      VALUES ($1, $2, 'email', 'fr', 'Bonjour', 'Corps', 'h', 'Corps', 'y***@example.invalid', 'queued', $3)`, [c, admin, crypto.randomUUID()]);
    await pool.query(`INSERT INTO customer_identity_signals (user_id, kind, value_hash, source) VALUES ($1, 'address', $2, 'test')`, [c, HASH]);
    await pool.query(`INSERT INTO customer_anomalies (customer_id, kind, evidence) VALUES ($1, 'refund_spike', '{"refunds7d":4}')`, [c]);
    const { rows: [q] } = await pool.query(`SELECT id FROM customer360_queues WHERE queue_key = 'general'`);
    await pool.query(`INSERT INTO customer360_queue_items (queue_id, customer_id, topic, source, reason, due_at) VALUES ($1, $2, 'general', 'manual', 'staff note', NOW())`, [q.id, c]);
  });
  afterAll(async () => { await pool.end?.(); });

  test('categories mirror admin areas, count own data and hide internal reviews', async () => {
    const cats = await privacy.categories(c);
    const by = Object.fromEntries(cats.map((x) => [x.key, x]));
    expect(by.support).toMatchObject({ group: 'account', count: 1, export: 'included', onErasure: 'anonymized', complete: true });
    expect(by.contactHistory).toMatchObject({ count: 1, onErasure: 'anonymized' });
    expect(by.queues.count).toBe(1);
    expect(by.securityReviews).toMatchObject({ count: null, export: 'described', onErasure: 'retained' });
    expect(cats.every((x) => x.complete)).toBe(true);
    const areas = new Set(Object.values(sources).map((d) => d.area));
    for (const a of areas) expect(by[a]).toBeDefined();
  });

  test('export sections include own records but no staff notes or fraud evidence', async () => {
    const data = await privacy.exportData(pool, c);
    expect(data.customer360_records.support.tickets).toHaveLength(1);
    expect(data.customer360_contact_history[0]).toMatchObject({ subject: 'Bonjour', body: 'Corps' });
    expect(data.customer360_queue_items[0]).not.toHaveProperty('reason');
    const text = JSON.stringify(data);
    expect(text).not.toContain('staff note');
    expect(text).not.toContain('refunds7d');
    expect(text).not.toContain(HASH);
    expect(data.customer360_records.trust?.anomaliesFinancial).toBeUndefined();
  });

  test('erasure removes derived data and strips content, keeping retained records', async () => {
    const client = await pool.connect();
    let summary;
    try {
      await client.query('BEGIN');
      summary = await privacy.erase(client, c);
      await client.query('COMMIT');
    } finally {
      client.release();
    }
    expect(summary).toMatchObject({ customer_identity_signals: 1, customer_outbound_messages: 1, customer360_queue_items: 1, customer_anomalies: 1 });
    const { rows: [r] } = await pool.query(
      `SELECT (SELECT COUNT(*) FROM customer_identity_signals WHERE user_id = $1)::int AS signals,
              (SELECT body FROM customer_outbound_messages WHERE customer_id = $1) AS body,
              (SELECT reason FROM customer360_queue_items WHERE customer_id = $1) AS reason,
              (SELECT evidence FROM customer_anomalies WHERE customer_id = $1) AS evidence`, [c]);
    expect(r).toEqual({ signals: 0, body: null, reason: null, evidence: {} });
    // Idempotent.
    const client2 = await pool.connect();
    try { expect((await privacy.erase(client2, c)).customer_outbound_messages).toBe(0); } finally { client2.release(); }
  });
});
