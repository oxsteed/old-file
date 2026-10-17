'use strict';

/**
 * Regression test: GET /admin/users/:userId/activity must not 500 when all
 * four activity source tables exist.
 *
 * Root cause (production 2026-10-17, "Failed to fetch activity log"):
 * getUserActivityLog UNIONs admin_user_action_log, admin_audit_log,
 * user_login_history, and user_impersonation_log. Three branches select
 * `u.role AS actor_role` where users.role is the user_role ENUM, while the
 * login-history branch selects the text literal 'system' AS actor_role.
 * PostgreSQL resolves the UNION column to the enum type and then fails with
 * `invalid input value for enum user_role: "system"` whenever the
 * user_login_history table exists — regardless of row data. The fix casts
 * the enum branches to TEXT (u.role::TEXT AS actor_role).
 *
 * This test runs against a real PostgreSQL database because the bug is a
 * SQL type-resolution failure that mocked queries cannot reproduce.
 * It honors ACTIVITY_TEST_DATABASE_URL end to end (disposable localhost
 * database only).
 */

const DISPOSABLE_PATTERN = (() => {
  const raw = process.env.ACTIVITY_TEST_DATABASE_URL
    || 'postgresql://oxsteed:statement-test-password@127.0.0.1:5432/credit_statement_test?sslmode=disable';
  let url;
  try { url = new URL(raw); } catch { throw new Error('Requires a disposable localhost test database'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol)
    || !['127.0.0.1', 'localhost'].includes(url.hostname)
    || url.pathname !== '/credit_statement_test'
    || [...url.searchParams].some(([key, value]) => key !== 'sslmode' || value !== 'disable')) {
    throw new Error('Requires a disposable localhost credit_statement_test database; connection overrides are forbidden');
  }
  return raw;
})();

process.env.DATABASE_URL = DISPOSABLE_PATTERN;
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'error';

const crypto = require('crypto');

// The global test setup mocks 'pg'. This test needs the real driver because
// the bug is a PostgreSQL type-resolution failure.
jest.unmock('pg');

const db = require('../db');
const ctrl = require('../controllers/superAdminController');

function mockRes() {
  const res = {};
  res.status = jest.fn((code) => { res.statusCode = code; return res; });
  res.json = jest.fn((body) => { res.body = body; return res; });
  return res;
}

describe('getUserActivityLog enum/text UNION regression', () => {
  const adminId = crypto.randomUUID();
  const targetId = crypto.randomUUID();
  const adminEmail = `activity-admin-${adminId.slice(0, 8)}@example.com`;
  const targetEmail = `activity-target-${targetId.slice(0, 8)}@example.com`;

  beforeAll(async () => {
    await db.query(
      `INSERT INTO users (id, email, first_name, last_name, password_hash, role)
       VALUES ($1, $2, 'Activity', 'Admin', 'x', 'super_admin'),
              ($3, $4, 'Activity', 'Target', 'x', 'customer')
       ON CONFLICT (id) DO NOTHING`,
      [adminId, adminEmail, targetId, targetEmail]
    );
    await db.query(
      `INSERT INTO admin_user_action_log (admin_id, target_user_id, action_type, field_name)
       VALUES ($1, $2, 'edit_email', 'email')`,
      [adminId, targetId]
    );
    await db.query(
      `INSERT INTO admin_audit_log (admin_id, action, target_type, target_id, description)
       VALUES ($1, 'user_verified', 'user', $2, 'verified')`,
      [adminId, targetId]
    );
    // This row exercises the 'system' AS actor_role UNION branch that
    // previously crashed the whole query on the user_role enum.
    await db.query(
      `INSERT INTO user_login_history (user_id, success) VALUES ($1, TRUE)`,
      [targetId]
    );
    await db.query(
      `INSERT INTO user_impersonation_log (admin_id, target_user_id, token_jti)
       VALUES ($1, $2, $3)`,
      [adminId, targetId, `jti-${targetId.slice(0, 8)}`]
    );
  }, 30000);

  afterAll(async () => {
    // Best-effort cleanup: the audit tables are append-only by design, and
    // some disposable test databases carry a broken FK rewrite rule on users
    // that rejects deletes. All test rows use UUID-unique ids/emails per run,
    // so leftovers cannot collide with future runs.
    for (const q of [
      [`DELETE FROM user_impersonation_log WHERE target_user_id = $1`, [targetId]],
      [`DELETE FROM user_login_history WHERE user_id = $1`, [targetId]],
      [`DELETE FROM admin_audit_log WHERE target_id = $1`, [targetId]],
      [`DELETE FROM admin_user_action_log WHERE target_user_id = $1`, [targetId]],
      [`DELETE FROM users WHERE id IN ($1, $2)`, [adminId, targetId]],
    ]) {
      try { await db.query(q[0], q[1]); } catch (e) { /* ignore */ }
    }
    await db.end();
  }, 30000);

  test('returns 200 with events from all four sources (no enum coercion 500)', async () => {
    const req = { params: { userId: targetId }, query: { limit: '100' } };
    const res = mockRes();
    await ctrl.getUserActivityLog(req, res);
    expect(res.status).not.toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalled();
    const body = res.json.mock.calls[0][0];
    expect(Array.isArray(body.events)).toBe(true);
    // One row per source table: action log, audit log, login, impersonation.
    expect(body.events.length).toBe(4);
    const sources = new Set(body.events.map((e) => e.source));
    expect(sources).toEqual(new Set(['admin_action', 'audit_log', 'login', 'impersonation']));
    // The login row carries the text 'system' actor_role alongside enum roles.
    const loginRow = body.events.find((e) => e.source === 'login');
    expect(loginRow.actor_role).toBe('system');
    const adminRow = body.events.find((e) => e.source === 'admin_action');
    expect(adminRow.actor_role).toBe('super_admin');
  }, 30000);
});
