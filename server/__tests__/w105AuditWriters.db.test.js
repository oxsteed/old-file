'use strict';
jest.unmock('pg');
const { disposableDatabaseOptIn, assertMigratedSchema } = require('./helpers/statementTestDatabase');
const database = disposableDatabaseOptIn('W105_TEST_DATABASE_URL');
if (database) process.env.DATABASE_URL = database;
const pool = require('../db');
const fs = require('fs');
const crypto = require('crypto');
const mockTransfers = { create: jest.fn().mockResolvedValue({ id: 'tr_synthetic_w105' }) };
jest.mock('stripe', () => () => ({ transfers: mockTransfers }));
const PayoutController = require('../controllers/PayoutController');
const describeDatabase = database ? describe : describe.skip;

// Execute the SQL used by each affected writer against the migrated schema.
// These are schema integration checks; route/permission coverage stays in the
// existing controller suites. Extract source SQL so a writer drift fails here.
const statements = ['adminController', 'adminFoodOrdersController'].flatMap((name) => {
  const source = fs.readFileSync(require.resolve(`../controllers/${name}`), 'utf8');
  return [...source.matchAll(/`\s*(INSERT INTO admin_audit_log[\s\S]*?)`/g)].map((m) => m[1]);
});
describeDatabase('W10.5 audit writers on migrated PostgreSQL', () => {
  let client; let admin;
  beforeAll(() => assertMigratedSchema(pool));
  beforeEach(async () => {
    client = await pool.connect(); await client.query('BEGIN'); admin = crypto.randomUUID();
    await client.query(`INSERT INTO users (id, email, password_hash, first_name, last_name, role)
      VALUES ($1, $2, 'synthetic-unusable', 'Synthetic', 'Audit', 'admin')`, [admin, `${admin}@example.invalid`]);
  });
  afterEach(async () => { jest.restoreAllMocks(); await client.query('ROLLBACK'); client.release(); });
  afterAll(() => pool.end());
  test('all five legacy moderation, refund, and purpose-read inserts persist', async () => {
    expect(statements).toHaveLength(5);
    for (const sql of statements) await client.query(sql, [admin, crypto.randomUUID(), JSON.stringify({ purpose: 'synthetic-audit', reason: 'Synthetic schema verification' })]);
    const { rows } = await client.query('SELECT action, details, metadata FROM admin_audit_log WHERE admin_id = $1 OR admin_user_id = $1', [admin]);
    expect(rows.map((r) => r.action).sort()).toEqual(['bid_removed', 'food_order_read', 'food_order_refund', 'review_hidden', 'review_restored']);
  });
  test('payout row and capability locks are valid PostgreSQL queries', async () => {
    const source = fs.readFileSync(require.resolve('../controllers/PayoutController'), 'utf8');
    const payout = source.match(/`(SELECT ap\.\*, aprg\.helper_id AS helper_id, pm\.stripe_account_id[\s\S]*?FOR UPDATE OF ap)`/)[1];
    const method = source.match(/`(SELECT pm\.status AS payout_method_status[\s\S]*?FOR UPDATE OF pm, ca)`/)[1];
    await client.query('EXPLAIN ' + payout, [999999]);
    await client.query('EXPLAIN ' + method, [crypto.randomUUID(), admin]);
  });
  test.each([[true, 'pending', true], [false, 'verified', false], [true, 'inactive', false]])(
    'real payout execution with readiness %s and method %s is allowed=%s', async (ready, status, allowed) => {
      const account = 'acct_synthetic_' + admin;
      const { rows: [program] } = await client.query(`INSERT INTO affiliate_programs (helper_id, program_type)
        VALUES ($1, 'custom') RETURNING id`, [admin]);
      const { rows: [method] } = await client.query(`INSERT INTO payout_methods (helper_id, method_type, stripe_account_id, status)
        VALUES ($1, 'stripe_connect', $2, $3) RETURNING id`, [admin, account, status]);
      await client.query(`INSERT INTO connect_accounts (user_id, stripe_account_id, payouts_enabled)
        VALUES ($1, $2, $3)`, [admin, account, ready]);
      const { rows: [payout] } = await client.query(`INSERT INTO affiliate_payouts
        (affiliate_program_id, period_start, period_end, total_commission_cents, commission_count, net_payout_cents, payout_method_id)
        VALUES ($1, '2026-01-01', '2026-02-01', 1234, 1, 1234, $2) RETURNING id`, [program.id, method.id]);
      // Give the actual controller a savepoint inside this disposable fixture's
      // transaction so its commit/rollback behavior leaves no durable test data.
      jest.spyOn(pool, 'connect').mockResolvedValue({ release() {}, query(sql, values) {
        const translated = sql === 'BEGIN' ? 'SAVEPOINT payout_fixture'
          : sql === 'COMMIT' ? 'RELEASE SAVEPOINT payout_fixture'
          : sql === 'ROLLBACK' ? 'ROLLBACK TO SAVEPOINT payout_fixture' : sql;
        return client.query(translated, values);
      } });
      mockTransfers.create.mockClear();
      const previous = process.env.PAYOUT_PROCESSOR_ENABLED;
      process.env.PAYOUT_PROCESSOR_ENABLED = 'true';
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      try {
        await PayoutController.processPayout({ params: { payout_id: payout.id }, user: { id: admin },
          body: { payment_processor: 'stripe' }, get: () => 'synthetic-w105:' + payout.id }, res);
      } finally {
        if (previous === undefined) delete process.env.PAYOUT_PROCESSOR_ENABLED;
        else process.env.PAYOUT_PROCESSOR_ENABLED = previous;
      }
      const state = (await client.query('SELECT status FROM affiliate_payouts WHERE id=$1', [payout.id])).rows[0].status;
      if (allowed) {
        expect(res.status).not.toHaveBeenCalledWith(500);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
        expect(state).toBe('completed');
        expect(mockTransfers.create).toHaveBeenCalledWith(expect.objectContaining({ destination: account, amount: 1234 }),
          { idempotencyKey: `affiliate-payout:${payout.id}` });
        expect((await client.query('SELECT status FROM payout_methods WHERE id=$1', [method.id])).rows[0].status).toBe('verified');
        expect((await client.query('SELECT action FROM admin_audit_log WHERE admin_id=$1', [admin])).rows)
          .toEqual([{ action: 'process_payout' }]);
      } else {
        expect(res.status).toHaveBeenCalledWith(409);
        expect(state).toBe('pending'); expect(mockTransfers.create).not.toHaveBeenCalled();
      }
    });
  test('migration 785 can be reapplied twice without losing the schema or audit data', async () => {
    const sql = fs.readFileSync(require.resolve('../migrations/785_w10_5_audit_and_session_revocation.sql'), 'utf8');
    await client.query(sql); await client.query(sql);
    await client.query(statements[0], [admin, crypto.randomUUID(), JSON.stringify({ reason: 'Synthetic idempotent migration' })]);
    expect((await client.query('SELECT details FROM admin_audit_log WHERE admin_id = $1', [admin])).rows).toHaveLength(1);
  });
});
