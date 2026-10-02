'use strict';

/**
 * M1 — Workforce Identity, Delegation, Access Lifecycle.
 *
 * Contract under test (server/controllers/workforceController.js):
 *   GET /staff              — admin/super_admin roster with 2FA/passkey status
 *                             and active permission-grant scopes. LIMIT 200.
 *   GET /delegations        — delegation_grants with computed effective status
 *                             (active-but-past-expiry => 'expired'); ?status=
 *                             filter; newest first; LIMIT 100.
 *   POST /delegations       — fail closed. grantor = req.user.id; no self
 *                             grant; expiry in the future and <= 30 days out;
 *                             1..20 non-empty scopes; grantee must be an
 *                             active admin/super_admin. 201 + audit row.
 *   POST /delegations/:id/revoke — grantor or super_admin only; 404 missing,
 *                             403 unauthorized, 409 already terminal.
 *   GET /lifecycle          — newest 100 grant-lifecycle audit events.
 *
 * No real DB: mockQuery from ./setup. The pg Pool is mocked, so db.query
 * routes through mockQuery.
 */

const express = require('express');
const request = require('supertest');
const { mockQuery, resetMocks } = require('./setup');
const { errorHandler } = require('../middleware/errorHandler');
const ctrl = require('../controllers/workforceController');

const SUPER = { id: '00000000-0000-4000-8000-000000000001', role: 'super_admin', email: 'root@oxsteed.com' };
const ADMIN_A = { id: '00000000-0000-4000-8000-0000000000a1', role: 'admin', email: 'a@oxsteed.com' };
const ADMIN_B = { id: '00000000-0000-4000-8000-0000000000b2', role: 'admin', email: 'b@oxsteed.com' };

function buildApp(user) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = user; req.isSuper = user.role === 'super_admin'; next(); });
  app.get('/staff', ctrl.getStaff);
  app.get('/delegations', ctrl.listDelegations);
  app.post('/delegations', ctrl.createDelegation);
  app.post('/delegations/:id/revoke', ctrl.revokeDelegation);
  app.get('/lifecycle', ctrl.getLifecycle);
  app.use(errorHandler);
  return app;
}

beforeEach(() => resetMocks());

const futureIso = (days) => new Date(Date.now() + days * 24 * 3600_000).toISOString();
const pastIso = (days) => new Date(Date.now() - days * 24 * 3600_000).toISOString();

function delegationRow(overrides = {}) {
  return {
    id: 7,
    grantor_admin_id: ADMIN_A.id,
    grantee_admin_id: ADMIN_B.id,
    scopes: ['view_financials', 'issue_refunds'],
    reason: 'Coverage while on leave',
    status: 'active',
    expires_at: futureIso(10),
    created_at: pastIso(1),
    created_by: ADMIN_A.id,
    revoked_at: null,
    revoked_by: null,
    revoke_reason: null,
    grantor_name: 'Alice Admin',
    grantee_name: 'Bob Admin',
    ...overrides,
  };
}

// ── GET /staff ────────────────────────────────────────────────────────────────

describe('GET /staff', () => {
  test('aggregates roster with 2FA status, passkey counts and grant scopes, bounded at 200', async () => {
    mockQuery.mockResolvedValue({
      rows: [{
        id: ADMIN_A.id, name: 'Alice Admin', email: ADMIN_A.email,
        role: 'admin', is_active: true, last_login_at: pastIso(1),
        two_factor_status: 'totp', passkey_count: '2',
        grant_scopes: ['view_financials'],
      }],
    });

    const res = await request(buildApp(SUPER)).get('/staff');

    expect(res.status).toBe(200);
    expect(res.body.staff).toHaveLength(1);
    const row = res.body.staff[0];
    expect(row).toEqual(expect.objectContaining({
      id: ADMIN_A.id, name: 'Alice Admin', email: ADMIN_A.email,
      role: 'admin', is_active: true,
      two_factor_status: 'totp', passkey_count: '2',
      grant_scopes: ['view_financials'],
    }));
    const [sql] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/role IN \('admin', 'super_admin'\)/);
    expect(sql).toMatch(/LIMIT 200/);
    expect(sql).toMatch(/admin_passkeys/);
    expect(sql).toMatch(/admin_permission_grants/);
  });

  test('fails closed with 500 when the roster query errors', async () => {
    mockQuery.mockRejectedValue(new Error('db down'));
    const res = await request(buildApp(SUPER)).get('/staff');
    expect(res.status).toBe(500);
  });
});

// ── GET /delegations ─────────────────────────────────────────────────────────

describe('GET /delegations', () => {
  test('returns newest first with computed effective status and honors ?status= filter', async () => {
    mockQuery.mockResolvedValue({ rows: [delegationRow(), delegationRow({ id: 8, status: 'revoked' })] });

    const res = await request(buildApp(SUPER)).get('/delegations');

    expect(res.status).toBe(200);
    expect(res.body.delegations).toHaveLength(2);
    expect(res.body.delegations[0].effective_status).toBe('active');
    expect(res.body.delegations[1].effective_status).toBe('revoked');
    const [sql] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/delegation_grants/);
    expect(sql).toMatch(/ORDER BY d\.created_at DESC/);
    expect(sql).toMatch(/LIMIT 100/);
  });

  test('computes effective status "expired" for active grants past their expiry', async () => {
    mockQuery.mockResolvedValue({
      rows: [delegationRow({ id: 9, status: 'active', expires_at: pastIso(1) })],
    });

    const res = await request(buildApp(SUPER)).get('/delegations');

    expect(res.status).toBe(200);
    expect(res.body.delegations[0].effective_status).toBe('expired');
  });

  test('rejects an unknown ?status= value fail closed', async () => {
    const res = await request(buildApp(SUPER)).get('/delegations?status=bogus');
    expect(res.status).toBe(400);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test('filters by ?status=active', async () => {
    mockQuery.mockResolvedValue({ rows: [delegationRow()] });
    const res = await request(buildApp(SUPER)).get('/delegations?status=active');
    expect(res.status).toBe(200);
    const [sql] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/\$1/);
  });
});

// ── POST /delegations ────────────────────────────────────────────────────────

describe('POST /delegations', () => {
  const validBody = () => ({
    grantee_id: ADMIN_B.id,
    scopes: ['view_financials', 'issue_refunds'],
    expires_at: futureIso(10),
    reason: 'Coverage while on leave',
  });

  beforeEach(() => {
    // Default: grantee lookup returns an active admin; insert returns the row;
    // audit insert resolves.
    mockQuery.mockImplementation(async (sql) => {
      if (sql.includes('FROM users') && sql.includes('WHERE u.id = $1')) {
        return { rows: [{ id: ADMIN_B.id, role: 'admin', is_active: true }], rowCount: 1 };
      }
      if (sql.includes('INSERT INTO delegation_grants')) {
        return { rows: [delegationRow()], rowCount: 1 };
      }
      return { rows: [{ id: 1 }], rowCount: 1 };
    });
  });

  test('creates a delegation: grantor is the caller, 201, audit row written', async () => {
    const res = await request(buildApp(ADMIN_A)).post('/delegations').send(validBody());

    expect(res.status).toBe(201);
    expect(res.body.delegation).toEqual(expect.objectContaining({
      grantor_admin_id: ADMIN_A.id,
      grantee_admin_id: ADMIN_B.id,
    }));

    const insertCall = mockQuery.mock.calls.find(([sql]) => sql.includes('INSERT INTO delegation_grants'));
    expect(insertCall).toBeDefined();
    expect(insertCall[1]).toEqual(expect.arrayContaining([
      ADMIN_A.id, ADMIN_B.id,
      expect.arrayContaining(['view_financials', 'issue_refunds']),
    ]));

    const auditCall = mockQuery.mock.calls.find(([sql]) => sql.includes('INSERT INTO admin_audit_log'));
    expect(auditCall).toBeDefined();
    expect(auditCall[1]).toEqual(expect.arrayContaining(['delegation_grant_created']));
  });

  test('rejects self-grant (400)', async () => {
    const res = await request(buildApp(ADMIN_A))
      .post('/delegations')
      .send({ ...validBody(), grantee_id: ADMIN_A.id });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/self/i);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test('rejects a past expiry (400)', async () => {
    const res = await request(buildApp(ADMIN_A))
      .post('/delegations')
      .send({ ...validBody(), expires_at: pastIso(1) });
    expect(res.status).toBe(400);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test('rejects an expiry beyond 30 days (400)', async () => {
    const res = await request(buildApp(ADMIN_A))
      .post('/delegations')
      .send({ ...validBody(), expires_at: futureIso(31) });
    expect(res.status).toBe(400);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test('rejects empty, oversized, and non-string scopes (400)', async () => {
    const cases = [
      { scopes: [] },
      { scopes: Array.from({ length: 21 }, (_, i) => `scope-${i}`) },
      { scopes: ['view_financials', '  '] },
      { scopes: ['view_financials', 42] },
    ];
    for (const c of cases) {
      const res = await request(buildApp(ADMIN_A)).post('/delegations').send({ ...validBody(), ...c });
      expect(res.status).toBe(400);
    }
  });

  test('rejects a missing grantee (404) and a non-admin grantee (400)', async () => {
    mockQuery.mockImplementation(async (sql) => {
      if (sql.includes('FROM users') && sql.includes('WHERE u.id = $1')) return { rows: [], rowCount: 0 };
      return { rows: [{ id: 1 }], rowCount: 1 };
    });
    let res = await request(buildApp(ADMIN_A)).post('/delegations').send(validBody());
    expect(res.status).toBe(404);

    mockQuery.mockImplementation(async (sql) => {
      if (sql.includes('FROM users') && sql.includes('WHERE u.id = $1')) {
        return { rows: [{ id: ADMIN_B.id, role: 'customer', is_active: true }], rowCount: 1 };
      }
      return { rows: [{ id: 1 }], rowCount: 1 };
    });
    res = await request(buildApp(ADMIN_A)).post('/delegations').send(validBody());
    expect(res.status).toBe(400);
  });

  test('fails closed with 500 when the insert fails', async () => {
    mockQuery.mockImplementation(async (sql) => {
      if (sql.includes('FROM users') && sql.includes('WHERE u.id = $1')) {
        return { rows: [{ id: ADMIN_B.id, role: 'admin', is_active: true }], rowCount: 1 };
      }
      if (sql.includes('INSERT INTO delegation_grants')) throw new Error('db down');
      return { rows: [{ id: 1 }], rowCount: 1 };
    });
    const res = await request(buildApp(ADMIN_A)).post('/delegations').send(validBody());
    expect(res.status).toBe(500);
  });

  test('fails closed with 500 when the audit write fails', async () => {
    mockQuery.mockImplementation(async (sql) => {
      if (sql.includes('FROM users') && sql.includes('WHERE u.id = $1')) {
        return { rows: [{ id: ADMIN_B.id, role: 'admin', is_active: true }], rowCount: 1 };
      }
      if (sql.includes('INSERT INTO delegation_grants')) return { rows: [delegationRow()], rowCount: 1 };
      if (sql.includes('INSERT INTO admin_audit_log')) throw new Error('audit down');
      return { rows: [{ id: 1 }], rowCount: 1 };
    });
    const res = await request(buildApp(ADMIN_A)).post('/delegations').send(validBody());
    expect(res.status).toBe(500);
  });
});

// ── POST /delegations/:id/revoke ─────────────────────────────────────────────

describe('POST /delegations/:id/revoke', () => {
  test('grantor can revoke: sets status, revoked_by, writes audit', async () => {
    const row = delegationRow();
    mockQuery.mockImplementation(async (sql) => {
      if (sql.includes('FROM delegation_grants')) return { rows: [row], rowCount: 1 };
      if (sql.includes('UPDATE delegation_grants')) {
        return { rows: [{ ...row, status: 'revoked', revoked_by: ADMIN_A.id }], rowCount: 1 };
      }
      return { rows: [{ id: 1 }], rowCount: 1 };
    });

    const res = await request(buildApp(ADMIN_A)).post('/delegations/7/revoke').send({ reason: 'No longer needed' });

    expect(res.status).toBe(200);
    expect(res.body.delegation.status).toBe('revoked');
    const updateCall = mockQuery.mock.calls.find(([sql]) => sql.includes('UPDATE delegation_grants'));
    expect(updateCall[1]).toEqual(expect.arrayContaining([ADMIN_A.id, 'No longer needed']));
    const auditCall = mockQuery.mock.calls.find(([sql]) => sql.includes('INSERT INTO admin_audit_log'));
    expect(auditCall[1]).toEqual(expect.arrayContaining(['delegation_grant_revoked']));
  });

  test('super_admin who is not the grantor can revoke', async () => {
    const row = delegationRow();
    mockQuery.mockImplementation(async (sql) => {
      if (sql.includes('FROM delegation_grants')) return { rows: [row], rowCount: 1 };
      if (sql.includes('UPDATE delegation_grants')) return { rows: [{ ...row, status: 'revoked' }], rowCount: 1 };
      return { rows: [{ id: 1 }], rowCount: 1 };
    });
    const res = await request(buildApp(SUPER)).post('/delegations/7/revoke').send({});
    expect(res.status).toBe(200);
  });

  test('a third-party admin gets 403', async () => {
    const third = { id: '00000000-0000-4000-8000-0000000000c3', role: 'admin', email: 'c@oxsteed.com' };
    mockQuery.mockImplementation(async (sql) => {
      if (sql.includes('FROM delegation_grants')) return { rows: [delegationRow()], rowCount: 1 };
      return { rows: [{ id: 1 }], rowCount: 1 };
    });
    const res = await request(buildApp(third)).post('/delegations/7/revoke').send({});
    expect(res.status).toBe(403);
    expect(mockQuery.mock.calls.some(([sql]) => sql.includes('UPDATE delegation_grants'))).toBe(false);
  });

  test('missing grant is 404', async () => {
    mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });
    const res = await request(buildApp(SUPER)).post('/delegations/999/revoke').send({});
    expect(res.status).toBe(404);
  });

  test('already revoked or expired is 409', async () => {
    for (const row of [
      delegationRow({ status: 'revoked' }),
      delegationRow({ status: 'active', expires_at: pastIso(2) }),
    ]) {
      mockQuery.mockImplementation(async (sql) => {
        if (sql.includes('FROM delegation_grants')) return { rows: [row], rowCount: 1 };
        return { rows: [{ id: 1 }], rowCount: 1 };
      });
      const res = await request(buildApp(SUPER)).post('/delegations/7/revoke').send({});
      expect(res.status).toBe(409);
    }
  });

  test('rejects a non-numeric id fail closed', async () => {
    const res = await request(buildApp(SUPER)).post('/delegations/abc/revoke').send({});
    expect(res.status).toBe(400);
    expect(mockQuery).not.toHaveBeenCalled();
  });
});

// ── GET /lifecycle ───────────────────────────────────────────────────────────

describe('GET /lifecycle', () => {
  test('returns newest 100 grant-lifecycle audit events with actor/action', async () => {
    mockQuery.mockResolvedValue({
      rows: [{
        id: 'uuid-1',
        action: 'delegation_grant_created',
        actor_name: 'Alice Admin',
        target_key: 'delegation:7',
        description: 'Granted scopes',
        created_at: pastIso(1),
      }],
    });

    const res = await request(buildApp(SUPER)).get('/lifecycle');

    expect(res.status).toBe(200);
    expect(res.body.events).toHaveLength(1);
    expect(res.body.events[0]).toEqual(expect.objectContaining({
      action: 'delegation_grant_created',
      actor_name: 'Alice Admin',
    }));
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/admin_audit_log/);
    expect(sql).toMatch(/LIMIT 100/);
    expect(sql).toMatch(/ORDER BY/);
    expect(params[0]).toEqual(expect.arrayContaining(['delegation_grant_created', 'permission_grant_create']));
  });

  test('fails closed with 500 when the audit read fails', async () => {
    mockQuery.mockRejectedValue(new Error('db down'));
    const res = await request(buildApp(SUPER)).get('/lifecycle');
    expect(res.status).toBe(500);
  });
});
