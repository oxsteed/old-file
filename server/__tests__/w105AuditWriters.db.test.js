'use strict';
jest.unmock('pg');
const { disposableDatabaseOptIn, assertMigratedSchema } = require('./helpers/statementTestDatabase');
const database = disposableDatabaseOptIn('W105_TEST_DATABASE_URL');
if (database) process.env.DATABASE_URL = database;
const pool = require('../db');
const fs = require('fs');
const crypto = require('crypto');
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
    // Audit stamp track: the writers now take a trailing impersonated_by
    // param (null for a direct session).
    for (const sql of statements) await client.query(sql, [admin, crypto.randomUUID(), JSON.stringify({ purpose: 'synthetic-audit', reason: 'Synthetic schema verification' }), null]);
    const { rows } = await client.query('SELECT action, details, metadata FROM admin_audit_log WHERE admin_id = $1 OR admin_user_id = $1', [admin]);
    expect(rows.map((r) => r.action).sort()).toEqual(['bid_removed', 'food_order_read', 'food_order_refund', 'review_hidden', 'review_restored']);
  });
  test('migration 785 can be reapplied twice without losing the schema or audit data', async () => {
    const sql = fs.readFileSync(require.resolve('../migrations/785_w10_5_audit_and_session_revocation.sql'), 'utf8');
    await client.query(sql); await client.query(sql);
    await client.query(statements[0], [admin, crypto.randomUUID(), JSON.stringify({ reason: 'Synthetic idempotent migration' }), null]);
    expect((await client.query('SELECT details FROM admin_audit_log WHERE admin_id = $1', [admin])).rows).toHaveLength(1);
  });
});
