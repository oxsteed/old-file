'use strict';

// Customer 360 upgrade 4 on PostgreSQL: detectors for new-country sign-ins,
// refund spikes and payout failures; bundling per customer and kind;
// audited snooze / acknowledge / resolve with revisions; platform-wide
// watches delivered once per bundle through the existing alert worker.

jest.unmock('pg');
jest.unmock('../utils/transaction');
const { disposableDatabaseOptIn } = require('./helpers/statementTestDatabase');

const database = disposableDatabaseOptIn('CUSTOMER360_TEST_DATABASE_URL');
if (database) process.env.DATABASE_URL = database;
const describeDatabase = database ? describe : describe.skip;
const crypto = require('crypto');

jest.setTimeout(120000);

test('anomaly DB test requires an explicit disposable database opt-in', () => {
  expect(database === '' || database.includes('/credit_statement_test')).toBe(true);
});

describeDatabase('customer360 anomalies', () => {
  let pool;
  let events;
  let anomalies;
  let alerts;
  let admin;
  async function createUser(role, extra = '') {
    const id = crypto.randomUUID();
    await pool.query(
      `INSERT INTO users (id, email, password_hash, first_name, last_name, role, totp_enabled, is_active)
       VALUES ($1, $2, 'synthetic-unusable', 'An', 'Om', $3, $4, true)`,
      [id, `c360-anom-${role}${extra}-${id}@example.invalid`, role, role !== 'customer']);
    return id;
  }
  async function drain() { for (let i = 0; i < 50; i += 1) if (!(await events.drainInbox()).moved) return; }
  async function login(user, country, daysAgo = 0) {
    await pool.query(
      `INSERT INTO user_login_history (user_id, ip_address, user_agent, country_code, success, login_at)
       VALUES ($1, '198.51.100.7', 'jest', $2, true, NOW() - ($3 * INTERVAL '1 day'))`, [user, country, daysAgo]);
  }
  const live = (customer, kind) => pool.query(
    `SELECT * FROM customer_anomalies WHERE customer_id = $1 AND kind = $2 ORDER BY id`, [customer, kind]).then((r) => r.rows);

  beforeAll(async () => {
    pool = require('../db');
    events = require('../services/customer360Events');
    anomalies = require('../services/customer360Anomalies');
    alerts = require('../jobs/customer360Alerts');
    admin = await createUser('super_admin');
  });
  afterAll(async () => { await pool.end?.(); });

  test('a sign-in from a new country opens one bundle that counts repeats once', async () => {
    const customer = await createUser('customer');
    await login(customer, 'HT', 20);
    await drain();
    await anomalies.scanLogins();
    expect(await live(customer, 'new_country_login')).toHaveLength(0); // first ever sign-in is not an anomaly
    await login(customer, 'FR');
    await login(customer, 'HT');
    await drain();
    await anomalies.scanLogins();
    let rows = await live(customer, 'new_country_login');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: 'open', occurrences: 1, evidence: { country: 'FR', previousCountries: ['HT'] } });
    await login(customer, 'US');
    await drain();
    await anomalies.scanLogins();
    await anomalies.scanLogins();
    rows = await live(customer, 'new_country_login');
    expect(rows).toHaveLength(1);
    expect(rows[0].occurrences).toBe(2);
    expect(JSON.stringify(rows[0].evidence)).not.toContain('198.51.100.7');
  });

  test('payout failures and refund spikes are detected from their tables', async () => {
    const customer = await createUser('customer');
    for (let i = 0; i < 2; i += 1) {
      await pool.query(
        `INSERT INTO instant_payouts (user_id, stripe_account_id, amount_cents, idempotency_key, status) VALUES ($1, 'acct_x', 900, $2, 'failed')`,
        [customer, `c360-anom-${crypto.randomUUID()}`]);
    }
    await anomalies.scanPayouts();
    expect((await live(customer, 'payout_failures'))[0]).toMatchObject({ status: 'open', evidence: { failures7d: 2 } });

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL session_replication_role = replica');
      for (let i = 0; i < 3; i += 1) {
        await client.query(
          `INSERT INTO food_credit_refunds (wallet_id, customer_id, restaurant_id, amount_cents, idempotency_key) VALUES (0, $1, 0, 100, $2)`,
          [customer, `c360-anom-${crypto.randomUUID()}`]);
      }
      await client.query('COMMIT');
    } finally {
      client.release();
    }
    await anomalies.scanRefunds();
    expect((await live(customer, 'refund_spike'))[0]).toMatchObject({ status: 'open', evidence: { refunds7d: 3, baselineWeekly: 0 } });
  });

  test('snooze, acknowledge and resolve are audited, revisioned and scoped by kind', async () => {
    const customer = await createUser('customer');
    const created = await anomalies.detect(null, { customerId: customer, kind: 'payout_failures', evidence: { failures7d: 2 }, key: 'k1' });
    const req = { user: { id: admin, role: 'super_admin' }, headers: {}, ip: '127.0.0.1', get: () => '' };
    await expect(anomalies.act({ id: created.id, action: 'snooze', adminId: admin, kinds: ['new_country_login'], revision: 1, reason: 'ok now', until: new Date(Date.now() + 3600e3).toISOString(), req }))
      .rejects.toMatchObject({ status: 404 });
    await expect(anomalies.act({ id: created.id, action: 'snooze', adminId: admin, kinds: anomalies.KINDS, revision: 1, reason: 'ok now', until: new Date(Date.now() + 40 * 86400e3).toISOString(), req }))
      .rejects.toMatchObject({ code: 'invalid_snooze' });
    const snoozed = await anomalies.act({ id: created.id, action: 'snooze', adminId: admin, kinds: anomalies.KINDS, revision: 1, reason: 'Waiting for bank', until: new Date(Date.now() + 3600e3).toISOString(), req });
    expect(snoozed).toMatchObject({ status: 'snoozed', revision: 2 });
    // A repeat while snoozed bundles into the same row.
    await anomalies.detect(null, { customerId: customer, kind: 'payout_failures', evidence: { failures7d: 3 }, key: 'k2' });
    expect(await live(customer, 'payout_failures')).toHaveLength(1);
    await expect(anomalies.act({ id: created.id, action: 'resolve', adminId: admin, kinds: anomalies.KINDS, revision: 1, reason: 'stale', req }))
      .rejects.toMatchObject({ code: 'revision_conflict' });
    await pool.query(`UPDATE customer_anomalies SET snoozed_until = NOW() - INTERVAL '1 second' WHERE id = $1`, [created.id]);
    expect((await anomalies.expireSnoozes()).reopened).toBeGreaterThanOrEqual(1);
    const [reopened] = await live(customer, 'payout_failures');
    expect(reopened).toMatchObject({ status: 'open', occurrences: 2 });
    const resolved = await anomalies.act({ id: created.id, action: 'resolve', adminId: admin, kinds: anomalies.KINDS, revision: reopened.revision, reason: 'Bank fixed account', req });
    expect(resolved.status).toBe('resolved');
    const { rows: auditRows } = await pool.query(
      `SELECT action FROM admin_audit_log WHERE target_id = $1 AND action LIKE 'customer360_anomaly_%' ORDER BY id`, [customer]);
    expect(auditRows.map((r) => r.action)).toEqual(['customer360_anomaly_snooze', 'customer360_anomaly_resolve']);
    // A new detection after resolution is a new bundle.
    await anomalies.detect(null, { customerId: customer, kind: 'payout_failures', evidence: { failures7d: 2 }, key: 'k3' });
    expect(await live(customer, 'payout_failures')).toHaveLength(2);
  });

  test('platform-wide watches notify once per bundle through the alert worker', async () => {
    const customer = await createUser('customer');
    await anomalies.detect(null, { customerId: customer, kind: 'refund_spike', evidence: { refunds7d: 4 }, key: 'w1' });
    await pool.query(
      `INSERT INTO admin_customer_alert_rules (admin_id, customer_id, source, statuses, min_age_minutes, enabled) VALUES ($1, NULL, 'anomaliesFinancial', ARRAY['open'], 0, true)`,
      [admin]);
    await expect(pool.query(
      `INSERT INTO admin_customer_alert_rules (admin_id, customer_id, source, statuses) VALUES ($1, NULL, 'jobs', ARRAY['open'])`, [admin]))
      .rejects.toThrow(/global_scope/);
    const first = await alerts.evaluateCustomer360Alerts();
    expect(first.sent).toBeGreaterThanOrEqual(1);
    await anomalies.detect(null, { customerId: customer, kind: 'refund_spike', evidence: { refunds7d: 5 }, key: 'w2' });
    await pool.query(`UPDATE admin_customer_alert_rules SET last_evaluated_at = NULL WHERE admin_id = $1`, [admin]);
    const { rows: before } = await pool.query(`SELECT COUNT(*)::int AS n FROM notifications WHERE user_id = $1 AND type = 'customer360_attention'`, [admin]);
    await alerts.evaluateCustomer360Alerts();
    const { rows: after } = await pool.query(`SELECT COUNT(*)::int AS n FROM notifications WHERE user_id = $1 AND type = 'customer360_attention'`, [admin]);
    expect(after[0].n).toBe(before[0].n);
  });
});
