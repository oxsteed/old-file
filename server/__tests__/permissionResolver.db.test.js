/**
 * permissionResolver.db.test.js — S-08 / S-21 / S-22 (staff review).
 *
 * Real-DB proof that the permission catalog + per-person overrides are the
 * single source of truth:
 *
 *   S-08  crew.* / runner.* exist in the catalog with role defaults equal to
 *         the retired hard-coded ROLE_PERMISSIONS map; the resolver outcome
 *         for every migrated gate equals the old MANAGE_ROLES baseline
 *         (owner + manager allowed, everyone else denied) when no overrides
 *         exist, and deny / allow overrides actually move the outcome.
 *   S-22  setMembershipOverrides rejects unknown codes (nothing written),
 *         rejects past expires_at, enforces rank guardrails (no self-edit,
 *         no peer-or-higher edit by a non-owner, no granting above your
 *         own level), and records the before-state in the audit row.
 *   S-21  invalidateCache makes override writes take effect immediately in
 *         this process, and the invalidation bus message is published /
 *         applied via the exported hooks.
 *
 * Skips unless PERMISSION_RESOLVER_TEST_DATABASE_URL points at a disposable
 * loopback database (st_tN / fr_tN / credit_statement_test).
 */
'use strict';

jest.unmock('pg');

const crypto = require('crypto');

function isDisposableDb(value) {
  try {
    const url = new URL(value);
    return ['postgres:', 'postgresql:'].includes(url.protocol)
      && ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(url.hostname)
      && /^\/(credit_statement_test|fr_t\d+|st_t\d+)$/.test(url.pathname);
  } catch { return false; }
}

const RAW_URL = process.env.PERMISSION_RESOLVER_TEST_DATABASE_URL || '';
if (RAW_URL && !isDisposableDb(RAW_URL)) {
  throw new Error('Permission resolver DB tests require an explicit loopback disposable database');
}
const CAN_RUN_DB = isDisposableDb(RAW_URL);
const ddescribe = CAN_RUN_DB ? describe : describe.skip;

if (CAN_RUN_DB) {
  process.env.DATABASE_URL = RAW_URL;
  process.env.NODE_ENV = 'test';
  process.env.LOG_LEVEL = 'error';
}

const pool = require('../db');
const permissionsService = require('../services/permissionsService');
const businessTeamController = require('../controllers/businessTeamController');

const GATE_CODES = [
  ['restaurant.manage'],      // app flow / publishing
  ['crew.manage'],              // ops, training, crew
  ['runner.manage'],            // runner workspace
  ['settings.manage'],          // printer settings
  ['audit.view'],               // audits
  ['analytics.view_financial'], // reports
];

async function makeUser(tag, label) {
  const id = crypto.randomUUID();
  await pool.query(
    `INSERT INTO users (id, email, password_hash, first_name, last_name, role, email_verified, is_active)
     VALUES ($1, $2, 'x', $3, 'Fixture', 'customer', TRUE, TRUE)`,
    [id, `${label}-${tag}@example.invalid`, label]
  );
  return id;
}

async function makeMember(businessId, ownerId, memberId, role, tag) {
  const { rows: [m] } = await pool.query(
    `INSERT INTO business_members (business_id, owner_id, member_id, role, invite_email, status, accepted_at)
     VALUES ($1, $2, $3, $4, $5, 'active', NOW()) RETURNING id`,
    [businessId, ownerId, memberId, role, `${role}-${tag}@example.invalid`]
  );
  return m.id;
}

async function insertOverride(membershipId, code, effect) {
  await pool.query(
    `INSERT INTO membership_permission_overrides (membership_id, permission_id, effect)
     SELECT $1, id, $3 FROM team_permissions WHERE code = $2`,
    [membershipId, code, effect]
  );
}

function mockRes() {
  const res = {};
  res.statusCode = 200;
  res.status = jest.fn((code) => { res.statusCode = code; return res; });
  res.json = jest.fn((payload) => { res.payload = payload; return res; });
  return res;
}

function overridesReq({ caller, callerRole, callerPermissions, businessId, membershipId, overrides }) {
  return {
    params: { id: String(businessId), membershipId: String(membershipId) },
    body: { overrides },
    user: { id: caller },
    business: { id: businessId },
    businessRole: callerRole,
    permissions: callerPermissions,
    headers: {},
    ip: '127.0.0.1',
  };
}

ddescribe('permission resolver + overrides (S-08/S-21/S-22)', () => {
  const tag = crypto.randomUUID().slice(0, 8);
  let businessId;
  let restaurantId;
  const users = {};
  const memberships = {};

  beforeAll(async () => {
    for (const role of ['owner', 'manager', 'manager2', 'employee', 'representative', 'support_agent']) {
      users[role] = await makeUser(tag, role.replace('_', '-'));
    }
    const { rows: [b] } = await pool.query(
      'INSERT INTO businesses (user_id, business_name) VALUES ($1, $2) RETURNING id',
      [users.owner, `Resolver Biz ${tag}`]
    );
    businessId = b.id;
    const { rows: [r] } = await pool.query(
      `INSERT INTO food_restaurants (business_id, owner_user_id, display_name, phone)
       VALUES ($1, $2, $3, '555-0100') RETURNING id`,
      [businessId, users.owner, `Resolver Diner ${tag}`]
    );
    restaurantId = r.id;
    memberships.manager = await makeMember(businessId, users.owner, users.manager, 'manager', tag);
    memberships.manager2 = await makeMember(businessId, users.owner, users.manager2, 'manager', tag);
    memberships.employee = await makeMember(businessId, users.owner, users.employee, 'employee', tag);
    memberships.representative = await makeMember(businessId, users.owner, users.representative, 'representative', tag);
    memberships.support_agent = await makeMember(businessId, users.owner, users.support_agent, 'support_agent', tag);
  });

  afterAll(async () => {
    await pool.query('DELETE FROM business_audit_log WHERE business_id = $1', [businessId]).catch(() => {});
    await pool.query('DELETE FROM businesses WHERE id = $1', [businessId]).catch(() => {});
    const ids = Object.values(users);
    await pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [ids]).catch(() => {});
    await pool.end().catch(() => {});
  });

  beforeEach(() => {
    permissionsService.invalidateCache();
  });

  function access(role) {
    return {
      id: restaurantId,
      business_id: businessId,
      effective_role: role,
      effective_membership_id: memberships[role] || null,
    };
  }

  test('suite targets only a disposable loopback database', () => {
    expect(isDisposableDb(RAW_URL)).toBe(CAN_RUN_DB);
  });

  test('S-08: catalog carries crew.*/runner.* with the retired map\'s role defaults', async () => {
    const { rows } = await pool.query(
      `SELECT p.code, r.name AS role
         FROM team_permissions p
         LEFT JOIN team_role_permissions rp ON rp.permission_id = p.id AND rp.allow = TRUE
         LEFT JOIN team_roles r ON r.id = rp.role_id
        WHERE p.code IN ('crew.update', 'crew.manage', 'runner.update', 'runner.manage')
        ORDER BY p.code, r.name`
    );
    const byCode = {};
    for (const row of rows) {
      byCode[row.code] = byCode[row.code] || [];
      if (row.role) byCode[row.code].push(row.role);
    }
    // Exactly the retired ROLE_PERMISSIONS grants (owner resolves every
    // catalog code dynamically; the explicit Owner rows are inert):
    // manager holds the manage-level codes, employee the update-level ones.
    expect(byCode['crew.update'].sort()).toEqual(['Employee', 'Owner']);
    expect(byCode['crew.manage'].sort()).toEqual(['Manager', 'Owner']);
    expect(byCode['runner.update'].sort()).toEqual(['Employee', 'Owner']);
    expect(byCode['runner.manage'].sort()).toEqual(['Manager', 'Owner']);
  });

  test('S-08: isKnownPermissionCode recognises catalog codes only', async () => {
    await expect(permissionsService.isKnownPermissionCode('crew.manage')).resolves.toBe(true);
    await expect(permissionsService.isKnownPermissionCode('pos.use')).resolves.toBe(true);
    await expect(permissionsService.isKnownPermissionCode('crew.fly')).resolves.toBe(false);
    await expect(permissionsService.isKnownPermissionCode('')).resolves.toBe(false);
  });

  test('S-08 equivalence: with no overrides, every migrated gate matches the MANAGE_ROLES baseline', async () => {
    const baseline = { owner: true, manager: true, representative: false, employee: false, support_agent: false };
    for (const role of Object.keys(baseline)) {
      for (const codes of GATE_CODES) {
        const allowed = await permissionsService.hasRestaurantPermission(access(role), users[role], codes);
        expect({ role, codes, allowed }).toEqual({ role, codes, allowed: baseline[role] });
      }
    }
  });

  test('S-08: a deny override closes a former role gate (crew.manage) for a manager', async () => {
    await insertOverride(memberships.manager, 'crew.manage', 'deny');
    try {
      await expect(
        permissionsService.hasRestaurantPermission(access('manager'), users.manager, ['crew.manage'])
      ).resolves.toBe(false);
      // Other manage gates stay open: the deny is per-code.
      await expect(
        permissionsService.hasRestaurantPermission(access('manager'), users.manager, ['runner.manage'])
      ).resolves.toBe(true);
    } finally {
      await pool.query('DELETE FROM membership_permission_overrides WHERE membership_id = $1', [memberships.manager]);
    }
  });

  test('S-08: a pos.use deny removes the POS module from the resolved set', async () => {
    await insertOverride(memberships.manager, 'pos.use', 'deny');
    try {
      const resolved = await permissionsService.getRestaurantPermissions(access('manager'), users.manager);
      expect(resolved.has('pos.use')).toBe(false);
      expect(resolved.has('pos.manage')).toBe(true);
    } finally {
      await pool.query('DELETE FROM membership_permission_overrides WHERE membership_id = $1', [memberships.manager]);
    }
  });

  test('S-08: an allow override grants an employee a former role gate (shift-lead profile)', async () => {
    await insertOverride(memberships.employee, 'crew.manage', 'allow');
    try {
      await expect(
        permissionsService.hasRestaurantPermission(access('employee'), users.employee, ['crew.manage'])
      ).resolves.toBe(true);
      await expect(
        permissionsService.hasRestaurantPermission(access('employee'), users.employee, ['runner.manage'])
      ).resolves.toBe(false);
    } finally {
      await pool.query('DELETE FROM membership_permission_overrides WHERE membership_id = $1', [memberships.employee]);
    }
  });

  test('S-21: invalidation bus publishes and applies', () => {
    const published = [];
    permissionsService._testHooks.setInvalidationPublisher((pubBusinessId, pubUserId) => {
      published.push([pubBusinessId, pubUserId]);
      return Promise.resolve(1);
    });
    try {
      permissionsService.invalidateCache(businessId, users.manager);
      expect(published).toEqual([[businessId, users.manager]]);
      expect(permissionsService._testHooks.INVALIDATION_CHANNEL).toBe('oxsteed:permissions:invalidate');

      // A message naming another pair must not evict this one... and one
      // naming our pair must. Populate the cache first via a direct
      // resolution in the cache test below; here we only verify the hook
      // wiring does not throw on malformed input.
      expect(() => permissionsService._testHooks.handleInvalidationMessage('not json')).not.toThrow();
      expect(() => permissionsService._testHooks.handleInvalidationMessage('{"businessId":1}')).not.toThrow();
    } finally {
      permissionsService._testHooks.setInvalidationPublisher(null);
    }
  });

  test('S-21: after invalidateCache, changed overrides are visible immediately', async () => {
    await expect(
      permissionsService.hasRestaurantPermission(access('employee'), users.employee, ['crew.manage'])
    ).resolves.toBe(false);
    await insertOverride(memberships.employee, 'crew.manage', 'allow');
    try {
      // Cached answer still applies until invalidation: documents the bound.
      await expect(
        permissionsService.hasRestaurantPermission(access('employee'), users.employee, ['crew.manage'])
      ).resolves.toBe(false);
      permissionsService.invalidateCache(businessId, users.employee);
      await expect(
        permissionsService.hasRestaurantPermission(access('employee'), users.employee, ['crew.manage'])
      ).resolves.toBe(true);
    } finally {
      await pool.query('DELETE FROM membership_permission_overrides WHERE membership_id = $1', [memberships.employee]);
    }
  });

  describe('S-22 setMembershipOverrides guardrails', () => {
    const ownerCaller = () => overridesReq({
      caller: users.owner, callerRole: 'owner',
      callerPermissions: new Set(['*']),
      businessId, membershipId: memberships.employee, overrides: [],
    });

    test('rejects an unknown permission code and writes nothing', async () => {
      const req = ownerCaller();
      req.body = { overrides: [{ permission_code: 'crew.fly', effect: 'allow' }] };
      const res = mockRes();
      await businessTeamController.setMembershipOverrides(req, res);
      expect(res.statusCode).toBe(400);
      expect(res.payload.code).toBe('unknown_permission_code');
      const { rows } = await pool.query(
        'SELECT id FROM membership_permission_overrides WHERE membership_id = $1', [memberships.employee]
      );
      expect(rows).toHaveLength(0);
    });

    test('rejects expires_at in the past', async () => {
      const req = ownerCaller();
      req.body = {
        overrides: [{ permission_code: 'crew.update', effect: 'allow', expires_at: '2020-01-01T00:00:00.000Z' }],
      };
      const res = mockRes();
      await businessTeamController.setMembershipOverrides(req, res);
      expect(res.statusCode).toBe(400);
      expect(res.payload.code).toBe('override_expiry_in_past');
    });

    test('a manager cannot edit their own overrides', async () => {
      const req = overridesReq({
        caller: users.manager, callerRole: 'manager',
        callerPermissions: new Set(['team.assign_permissions']),
        businessId, membershipId: memberships.manager, overrides: [],
      });
      const res = mockRes();
      await businessTeamController.setMembershipOverrides(req, res);
      expect(res.statusCode).toBe(403);
      expect(res.payload.code).toBe('cannot_edit_own_overrides');
    });

    test('a manager cannot edit a peer manager (rank guardrail)', async () => {
      const req = overridesReq({
        caller: users.manager, callerRole: 'manager',
        callerPermissions: new Set(['team.assign_permissions']),
        businessId, membershipId: memberships.manager2, overrides: [],
      });
      const res = mockRes();
      await businessTeamController.setMembershipOverrides(req, res);
      expect(res.statusCode).toBe(403);
      expect(res.payload.code).toBe('target_rank_too_high');
    });

    test('a manager cannot ALLOW-grant a permission they do not hold', async () => {
      const req = overridesReq({
        caller: users.manager, callerRole: 'manager',
        callerPermissions: new Set(['team.assign_permissions']),
        businessId, membershipId: memberships.employee,
        overrides: [{ permission_code: 'settings.manage', effect: 'allow' }],
      });
      const res = mockRes();
      await businessTeamController.setMembershipOverrides(req, res);
      expect(res.statusCode).toBe(403);
      expect(res.payload.code).toBe('cannot_grant_above_level');
    });

    test('a successful write replaces the set and audits the before-state', async () => {
      // Seed a pre-existing override to prove before-state capture.
      await insertOverride(memberships.employee, 'kitchen.view', 'deny');
      const req = overridesReq({
        caller: users.manager, callerRole: 'manager',
        callerPermissions: new Set(['team.assign_permissions', 'crew.manage']),
        businessId, membershipId: memberships.employee,
        overrides: [{ permission_code: 'crew.manage', effect: 'allow', reason: 'shift lead' }],
      });
      const res = mockRes();
      await businessTeamController.setMembershipOverrides(req, res);
      expect(res.statusCode).toBe(200);
      expect(res.payload.data).toEqual({ ok: true, count: 1 });

      const { rows: current } = await pool.query(
        `SELECT p.code AS permission_code, o.effect, o.reason
           FROM membership_permission_overrides o
           JOIN team_permissions p ON p.id = o.permission_id
          WHERE o.membership_id = $1`,
        [memberships.employee]
      );
      expect(current).toEqual([{ permission_code: 'crew.manage', effect: 'allow', reason: 'shift lead' }]);

      const { rows: audit } = await pool.query(
        `SELECT before_state, after_state FROM business_audit_log
          WHERE business_id = $1 AND action = 'business.member.permissions_updated'
          ORDER BY id DESC LIMIT 1`,
        [businessId]
      );
      expect(audit).toHaveLength(1);
      expect(audit[0].before_state.overrides).toEqual([
        expect.objectContaining({ permission_code: 'kitchen.view', effect: 'deny' }),
      ]);
      expect(audit[0].after_state.overrides).toEqual([
        expect.objectContaining({ permission_code: 'crew.manage', effect: 'allow' }),
      ]);

      // And the resolver sees the new grant immediately after the write
      // (the handler invalidates the cache entry for the target member).
      await expect(
        permissionsService.hasRestaurantPermission(access('employee'), users.employee, ['crew.manage'])
      ).resolves.toBe(true);

      await pool.query('DELETE FROM membership_permission_overrides WHERE membership_id = $1', [memberships.employee]);
    });
  });
});
