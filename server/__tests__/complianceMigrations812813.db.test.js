'use strict';

// DB test for compliance migrations 812/813 (P3-11-F03, P3-11-F19).
//
// P3-11-F03: migration 055 made admin_audit_log.admin_id NOT NULL (and
// admin_user_action_log.admin_id / target_user_id were already NOT NULL),
// so scheduledDeletionJob's SET admin_id = NULL could never succeed for a
// user with audit rows: the 23502 violation rolled the deletion back and
// the user was retained forever. The fix reassigns those FKs to the
// permanent sentinel system user created by migration 812.
// This test proves, against real constraints, that (a) the old nullify
// fails, (b) the sentinel insert works, and (c) the reassignment lets the
// user row delete cleanly.
// P3-11-F19: migration 813 drops the three dead audit tables.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const schema = `e_compliance_${crypto.randomBytes(6).toString('hex')}`;
const url = process.env.STATEMENT_TEST_DATABASE_URL;
if (url) {
  const target = new URL(url);
  if (!['127.0.0.1', 'localhost'].includes(target.hostname) || target.pathname !== '/credit_statement_test') {
    throw new Error('E-compliance fixtures require the disposable statement test database');
  }
  target.searchParams.set('options', `-c search_path=${schema},public`);
  process.env.DATABASE_URL = target.toString();
}
jest.unmock('pg');
jest.unmock('../db');
jest.unmock('../utils/transaction');
const db = require('../db');

const SENTINEL = '00000000-0000-0000-0000-000000000000';
const USER = '11111111-1111-4111-8111-111111111111';

const describeDb = url ? describe : describe.skip;

describeDb('compliance migrations 812/813', () => {
  beforeAll(async () => {
    await db.query('CREATE EXTENSION IF NOT EXISTS pgcrypto');
    await db.query(`CREATE SCHEMA ${schema}`);
    // Minimal users table with the NOT NULL columns migration 812 fills.
    await db.query(`CREATE TABLE ${schema}.users (
      id UUID PRIMARY KEY,
      email VARCHAR(255) NOT NULL UNIQUE,
      password_hash VARCHAR(255) NOT NULL,
      first_name VARCHAR(100) NOT NULL,
      last_name VARCHAR(100) NOT NULL,
      role VARCHAR(20) NOT NULL DEFAULT 'customer',
      is_active BOOLEAN NOT NULL DEFAULT true,
      email_verified BOOLEAN NOT NULL DEFAULT false
    )`);
    // Post-migration-055 end state: NOT NULL audit FKs to users(id).
    await db.query(`CREATE TABLE ${schema}.admin_audit_log (
      id BIGSERIAL PRIMARY KEY,
      admin_id UUID NOT NULL REFERENCES ${schema}.users(id) ON DELETE SET NULL,
      action VARCHAR(100) NOT NULL
    )`);
    await db.query(`CREATE TABLE ${schema}.admin_user_action_log (
      id BIGSERIAL PRIMARY KEY,
      admin_id UUID NOT NULL REFERENCES ${schema}.users(id) ON DELETE CASCADE,
      target_user_id UUID NOT NULL REFERENCES ${schema}.users(id) ON DELETE CASCADE,
      action_type VARCHAR(64) NOT NULL
    )`);
    // Dead tables for migration 813.
    for (const table of ['consulting_audit_log', 'dispute_evidence_audit', 'helper_location_audits']) {
      await db.query(`CREATE TABLE ${schema}.${table} (id BIGSERIAL PRIMARY KEY)`);
    }
    await db.query(fs.readFileSync(path.join(__dirname, '../migrations/812_audit_sentinel_system_user.sql'), 'utf8'));
  });

  afterAll(async () => {
    await db.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await db.end();
  });

  test('812 creates the inactive sentinel system user', async () => {
    const { rows } = await db.query('SELECT * FROM users WHERE id = $1', [SENTINEL]);
    expect(rows).toHaveLength(1);
    expect(rows[0].is_active).toBe(false);
    expect(rows[0].email).toBe('system@oxsteed.internal');
    expect(rows[0].password_hash.startsWith('!')).toBe(true);
  });

  test('812 is idempotent (ON CONFLICT DO NOTHING)', async () => {
    await db.query(fs.readFileSync(path.join(__dirname, '../migrations/812_audit_sentinel_system_user.sql'), 'utf8'));
    const { rows } = await db.query('SELECT COUNT(*)::int AS n FROM users WHERE id = $1', [SENTINEL]);
    expect(rows[0].n).toBe(1);
  });

  test('the old SET NULL path fails on the NOT NULL audit columns (the F03 break)', async () => {
    await db.query(
      `INSERT INTO users (id, email, password_hash, first_name, last_name) VALUES ($1, 'doomed@example.com', 'x', 'Doomed', 'User') ON CONFLICT (id) DO NOTHING`,
      [USER]
    );
    await db.query(`INSERT INTO admin_audit_log (admin_id, action) VALUES ($1, 'test_action')`, [USER]);
    await db.query(`INSERT INTO admin_user_action_log (admin_id, target_user_id, action_type) VALUES ($1, $1, 'test_action')`, [USER]);
    await expect(
      db.query(`UPDATE admin_audit_log SET admin_id = NULL WHERE admin_id::text = $1`, [USER])
    ).rejects.toMatchObject({ code: '23502' });
    await expect(
      db.query(`UPDATE admin_user_action_log SET admin_id = NULL WHERE admin_id::text = $1`, [USER])
    ).rejects.toMatchObject({ code: '23502' });
  });

  test('reassignment to the sentinel lets the user delete with audit history intact', async () => {
    await db.query(`INSERT INTO admin_user_action_log (admin_id, target_user_id, action_type) VALUES ($1, $1, 'test_action')`, [USER]);
    for (const [table, column] of [
      ['admin_audit_log', 'admin_id'],
      ['admin_user_action_log', 'admin_id'],
      ['admin_user_action_log', 'target_user_id'],
    ]) {
      await db.query(`UPDATE ${table} SET ${column} = $2 WHERE ${column}::text = $1`, [USER, SENTINEL]);
    }
    await db.query(`DELETE FROM users WHERE id::text = $1`, [USER]);
    const { rows: auditRows } = await db.query(`SELECT admin_id FROM admin_audit_log`);
    expect(auditRows.length).toBeGreaterThan(0);
    expect(auditRows.every((row) => row.admin_id === SENTINEL)).toBe(true);
    const { rows: actionRows } = await db.query(`SELECT admin_id, target_user_id FROM admin_user_action_log`);
    expect(actionRows.length).toBeGreaterThan(0);
    expect(actionRows.every((row) => row.admin_id === SENTINEL && row.target_user_id === SENTINEL)).toBe(true);
    const { rows: users } = await db.query(`SELECT id FROM users WHERE id = $1`, [USER]);
    expect(users).toHaveLength(0);
  });

  test('813 drops the dead audit tables', async () => {
    await db.query(fs.readFileSync(path.join(__dirname, '../migrations/813_drop_dead_audit_tables.sql'), 'utf8'));
    for (const table of ['consulting_audit_log', 'dispute_evidence_audit', 'helper_location_audits']) {
      const { rows } = await db.query(`SELECT to_regclass($1) AS reg`, [`${schema}.${table}`]);
      expect(rows[0].reg).toBeNull();
    }
    // Re-running is safe.
    await db.query(fs.readFileSync(path.join(__dirname, '../migrations/813_drop_dead_audit_tables.sql'), 'utf8'));
  });
});
