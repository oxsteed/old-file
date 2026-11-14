'use strict';

// Domain 6 finding 4 (2026-11-13): updateUserRole revoked nothing on
// demotion. Direct admin_permission_grants rows and delegation_grants
// rows in either direction stayed live and silently resurrected on
// re-promotion: the demoted admin re-promoted later regained old grants
// with no fresh grant decision and no audit event. Demotion (a role move
// away from admin/super_admin to a non-admin role) must revoke direct
// grants and delegations in both directions, inside the same transaction
// as the role change, with an audit event for the revocation.
//
// Real-database test: the controller runs against the actual tables and
// hasGlobalGrant proves the demoted grants are denied (and stay denied
// after re-promotion).
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
const { hasGlobalGrant } = require('../middleware/adminAuth');
const controller = require('../controllers/superAdminController');

test('demotion-revocation suite requires explicit synthetic disposable database opt-in', () => {
  expect(permitted).toBe(Boolean(databaseUrl && permitted));
});

dbDescribe('updateUserRole revokes grants and delegations on demotion', () => {
  const tag = crypto.randomBytes(6).toString('hex');
  let superAdminId;
  let demotedId;
  let grantorId;
  let counterpartyId;
  let superDemotedId;

  async function makeUser(role) {
    const id = crypto.randomUUID();
    await pool.query(
      `INSERT INTO users(id, email, password_hash, first_name, last_name, role, email_verified, is_active)
       VALUES ($1, $2, 'x', 'Role', 'Test', $3, true, true)`,
      [id, `role-${tag}-${id.slice(0, 8)}@example.invalid`, role]
    );
    return id;
  }

  async function grantDirect(granteeId) {
    const { rows: [g] } = await pool.query(
      `INSERT INTO admin_permission_grants (grantor_id, grantee_id, permissions, expires_at)
       VALUES ($1, $2, '["manage_users"]'::jsonb, NOW() + INTERVAL '30 days')
       RETURNING id`,
      [superAdminId, granteeId]
    );
    return g.id;
  }

  async function delegate(grantor, grantee) {
    const { rows: [d] } = await pool.query(
      `INSERT INTO delegation_grants (grantor_admin_id, grantee_admin_id, scopes, status, expires_at, created_by)
       VALUES ($1, $2, ARRAY['manage_users'], 'active', NOW() + INTERVAL '30 days', $1)
       RETURNING id`,
      [grantor, grantee]
    );
    return d.id;
  }

  function mockRes() {
    const res = {};
    res.status = jest.fn().mockReturnValue(res);
    res.json = jest.fn().mockReturnValue(res);
    return res;
  }

  async function changeRole(targetId, role) {
    const req = {
      params: { userId: targetId },
      body: { role },
      user: { id: superAdminId, role: 'super_admin' },
      isSuper: true,
      ip: '127.0.0.1',
      headers: {},
    };
    const res = mockRes();
    await controller.updateUserRole(req, res);
    return res;
  }

  beforeAll(async () => {
    superAdminId = await makeUser('super_admin');
    demotedId = await makeUser('admin');
    grantorId = await makeUser('super_admin');
    counterpartyId = await makeUser('admin');
    superDemotedId = await makeUser('super_admin');
  });

  afterAll(async () => {
    // Same pre-existing test-DB quirk as requireFreshAuthSingleUse:
    // plain DELETE FROM users raises "gave unexpected result", so
    // cleanup runs with row triggers bypassed (fixture rows only).
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SET LOCAL session_replication_role = 'replica'");
      await client.query('DELETE FROM delegation_grants WHERE grantor_admin_id = ANY($1) OR grantee_admin_id = ANY($1)',
        [[superAdminId, demotedId, grantorId, counterpartyId, superDemotedId]]);
      await client.query('DELETE FROM admin_permission_grants WHERE grantee_id = ANY($1)',
        [[superAdminId, demotedId, grantorId, counterpartyId, superDemotedId]]);
      await client.query('DELETE FROM admin_audit_log WHERE target_id = ANY($1)',
        [[superAdminId, demotedId, grantorId, counterpartyId, superDemotedId]]);
      await client.query('DELETE FROM users WHERE id = ANY($1)',
        [[superAdminId, demotedId, grantorId, counterpartyId, superDemotedId]]);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  });

  test('demotion revokes direct grants and delegations in both directions', async () => {
    const grantId = await grantDirect(demotedId);
    const inboundId = await delegate(grantorId, demotedId);
    const outboundId = await delegate(demotedId, counterpartyId);
    expect(await hasGlobalGrant(demotedId, 'manage_users')).toBe(true);

    const res = await changeRole(demotedId, 'helper');
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringMatching(/role updated/i) }));

    const { rows: [grant] } = await pool.query(
      'SELECT revoked_at, revoked_by FROM admin_permission_grants WHERE id = $1', [grantId]);
    expect(grant.revoked_at).not.toBeNull();
    expect(String(grant.revoked_by)).toBe(String(superAdminId));

    const { rows: delegations } = await pool.query(
      `SELECT id, status, revoked_at, revoked_by, revoke_reason FROM delegation_grants
        WHERE id = ANY($1) ORDER BY id`,
      [[inboundId, outboundId]]);
    expect(delegations).toHaveLength(2);
    for (const d of delegations) {
      expect(d.status).toBe('revoked');
      expect(d.revoked_at).toBeDefined();
      expect(String(d.revoked_by)).toBe(String(superAdminId));
      expect(d.revoke_reason).toMatch(/demot/i);
    }
    expect(await hasGlobalGrant(demotedId, 'manage_users')).toBe(false);

    const { rows: audit } = await pool.query(
      `SELECT action FROM admin_audit_log
        WHERE action = 'admin_grants_revoked_on_role_demotion' AND target_id = $1`,
      [demotedId]);
    expect(audit.length).toBeGreaterThanOrEqual(1);
  });

  test('re-promotion does not resurrect the revoked grants', async () => {
    // demotedId is a helper now (previous test); its old grant rows are revoked.
    const res = await changeRole(demotedId, 'admin');
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringMatching(/role updated/i) }));
    expect(await hasGlobalGrant(demotedId, 'manage_users')).toBe(false);
    const { rows } = await pool.query(
      `SELECT COUNT(*)::int AS n FROM admin_permission_grants
        WHERE grantee_id = $1 AND revoked_at IS NULL AND expires_at > NOW()`,
      [demotedId]);
    expect(rows[0].n).toBe(0);
    const { rows: delegations } = await pool.query(
      `SELECT COUNT(*)::int AS n FROM delegation_grants
        WHERE (grantor_admin_id = $1 OR grantee_admin_id = $1) AND status = 'active'`,
      [demotedId]);
    expect(delegations[0].n).toBe(0);
  });

  test('admin-to-admin role change revokes nothing', async () => {
    const grantId = await grantDirect(superDemotedId);
    const delegationId = await delegate(grantorId, superDemotedId);
    const res = await changeRole(superDemotedId, 'admin');
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringMatching(/role updated/i) }));
    const { rows: [grant] } = await pool.query(
      'SELECT revoked_at FROM admin_permission_grants WHERE id = $1', [grantId]);
    expect(grant.revoked_at).toBeNull();
    const { rows: [delegation] } = await pool.query(
      'SELECT status FROM delegation_grants WHERE id = $1', [delegationId]);
    expect(delegation.status).toBe('active');
    expect(await hasGlobalGrant(superDemotedId, 'manage_users')).toBe(true);
  });

  test('promotion revokes nothing', async () => {
    const helperId = await makeUser('helper');
    try {
      const res = await changeRole(helperId, 'admin');
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringMatching(/role updated/i) }));
      const { rows: audit } = await pool.query(
        `SELECT action FROM admin_audit_log
          WHERE action = 'admin_grants_revoked_on_role_demotion' AND target_id = $1`,
        [helperId]);
      expect(audit).toHaveLength(0);
    } finally {
      // Leave no stray admin behind for other suites sharing this DB.
      await changeRole(helperId, 'helper');
    }
  });
});
