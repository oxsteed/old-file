'use strict';

// Domain 6 finding 2 (2026-11-13): fresh-auth step-up events were
// window-reusable and never consumed, so one TOTP proof authorized
// unlimited same-purpose actions for 15 minutes (including multiple
// super-admin password-sets). Events must be consumed on first use:
// the first guarded action succeeds and the second, with the same
// proof, fails closed with 401 fresh_auth_required.
//
// Real-database test: the middleware's consume query runs against the
// actual logistics_fresh_auth_events table.
//
// Explicit opt-in to the shared disposable synthetic database; never load .env.
jest.unmock('pg');
const databaseUrl = process.env.STATEMENT_TEST_DATABASE_URL;
const permitted = (() => {
  try {
    const u = new URL(databaseUrl);
    return ['postgres:', 'postgresql:'].includes(u.protocol)
      && ['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname)
      && u.pathname === '/credit_statement_test';
  } catch { return false; }
})();
if (permitted) process.env.DATABASE_URL = databaseUrl;
const dbDescribe = permitted ? describe : describe.skip;
const crypto = require('crypto');

const pool = require('../db');
const { requireFreshAuth } = require('../middleware/requireFreshAuth');

test('fresh-auth single-use suite requires explicit synthetic disposable database opt-in', () => {
  expect(permitted).toBe(Boolean(databaseUrl && permitted));
});

dbDescribe('fresh-auth events are single-use', () => {
  const tag = crypto.randomBytes(6).toString('hex');
  let userId;

  beforeAll(async () => {
    userId = crypto.randomUUID();
    await pool.query(
      `INSERT INTO users(id, email, password_hash, first_name, last_name, role, email_verified, is_active)
       VALUES ($1, $2, 'x', 'Fresh', 'Auth', 'super_admin', true, true)`,
      [userId, `fresh-${tag}@example.invalid`]
    );
  });

  afterAll(async () => {
    // NOTE: plain DELETE FROM users hits a pre-existing quirk of the
    // disposable test DB: the RI check query raises "gave unexpected
    // result" even with zero referencing rows (append-only rewrite rules
    // on the credit ledger break Postgres' RI check for ANY user delete).
    // Cleanup therefore runs with row triggers bypassed inside one
    // transaction — fixture rows only, schema untouched (same workaround
    // as restaurantScopeModel.db.test.js).
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SET LOCAL session_replication_role = 'replica'");
      await client.query('DELETE FROM logistics_fresh_auth_events WHERE user_id = $1', [userId]);
      await client.query('DELETE FROM users WHERE id = $1', [userId]);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  });

  beforeEach(async () => {
    // Events are per-proof; clear them between tests so each test starts
    // from exactly the proofs it mints.
    await pool.query('DELETE FROM logistics_fresh_auth_events WHERE user_id = $1', [userId]);
  });

  function mockRes() {
    const res = {};
    res.status = jest.fn().mockReturnValue(res);
    res.json = jest.fn().mockReturnValue(res);
    return res;
  }

  async function mint(purpose) {
    const hash = `hash-${tag}-${purpose}-${crypto.randomBytes(4).toString('hex')}`;
    await pool.query(
      `INSERT INTO logistics_fresh_auth_events (user_id, method, purpose, ip_hash, auth_hash)
       VALUES ($1, 'totp', $2, 'iphash', $3)`,
      [userId, purpose, hash]
    );
    return hash;
  }

  async function callMiddleware(purpose) {
    const mw = requireFreshAuth(purpose);
    const req = { user: { id: userId } };
    const res = mockRes();
    const next = jest.fn();
    await mw(req, res, next);
    return { req, res, next };
  }

  test('one proof authorizes exactly one action: the second use is 401', async () => {
    await mint('super_admin_password_set');
    const first = await callMiddleware('super_admin_password_set');
    expect(first.next).toHaveBeenCalledTimes(1);
    expect(first.req.freshAuth).toMatchObject({ method: 'totp' });
    expect(first.req.freshAuth.authHash).toBeTruthy();

    const second = await callMiddleware('super_admin_password_set');
    expect(second.next).not.toHaveBeenCalled();
    expect(second.res.status).toHaveBeenCalledWith(401);
    expect(second.res.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'fresh_auth_required' })
    );
  });

  test('the consumed event is marked in the table', async () => {
    const hash = await mint('impersonation_start');
    await callMiddleware('impersonation_start');
    const { rows } = await pool.query(
      'SELECT consumed_at FROM logistics_fresh_auth_events WHERE auth_hash = $1',
      [hash]
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].consumed_at).not.toBeNull();
  });

  test('a proof minted for another purpose does not authorize this one', async () => {
    await mint('impersonation_start');
    const attempt = await callMiddleware('super_admin_password_set');
    expect(attempt.next).not.toHaveBeenCalled();
    expect(attempt.res.status).toHaveBeenCalledWith(401);
  });

  test('consuming one purpose leaves a different purpose usable', async () => {
    await mint('super_admin_password_set');
    await mint('logistics_refund_approve');
    const first = await callMiddleware('super_admin_password_set');
    expect(first.next).toHaveBeenCalledTimes(1);
    const other = await callMiddleware('logistics_refund_approve');
    expect(other.next).toHaveBeenCalledTimes(1);
  });
});

describe('POST /super/stepup/verify rejects impersonated sessions', () => {
  test('the mint endpoint mounts rejectImpersonated like its logistics siblings', () => {
    const router = require('../routes/admin');
    const layer = router.stack.find(
      (l) => l.route && l.route.path === '/super/stepup/verify' && l.route.methods.post
    );
    expect(layer).toBeDefined();
    expect(layer.route.stack.some((l) => l.handle && l.handle.name === 'rejectImpersonated')).toBe(true);
  });
});
