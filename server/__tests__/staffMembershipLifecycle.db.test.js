'use strict';

/**
 * Staff review S-01/S-03/S-09/S-10/S-11/S-13 against the real migrated
 * schema. Runs only against an explicitly opted-in disposable st_t1
 * database:
 *   ST_T1_TEST_DATABASE_URL=postgresql://oxsteed:statement-test-password@127.0.0.1:5432/st_t1
 *
 * The mocked suites cannot see the class of bug S-01 was (an INSERT
 * naming columns that do not exist), so every assertion here runs real
 * SQL through the real controllers.
 */
function stT1OptIn() {
  const value = process.env.ST_T1_TEST_DATABASE_URL || '';
  if (!value) return '';
  const url = new URL(value);
  const loopback = ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(url.hostname);
  if (!loopback || url.pathname !== '/st_t1') {
    throw new Error('ST_T1_TEST_DATABASE_URL must be a loopback st_t1 database');
  }
  return value;
}

const url = stT1OptIn();
if (url) process.env.DATABASE_URL = url;
jest.unmock('pg');
jest.unmock('../db');
const db = require('../db');
const bcrypt = require('bcrypt');
const emailUtils = require('../utils/email');
emailUtils.sendBusinessInviteEmail = jest.fn().mockResolvedValue({ success: true, id: 'test' });

const membersCtrl = require('../controllers/businessMembersController');
const teamCtrl = require('../controllers/businessTeamController');
const accessCtrl = require('../controllers/businessAccessCodesController');
const vortexCtrl = require('../controllers/vortexController');
const crewCtrl = require('../controllers/restaurantCrewController');
const appFlowCtrl = require('../controllers/restaurantAppFlowController');

const suite = url ? describe : describe.skip;

function mockRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
    end() { return this; },
  };
}

function mockNext() {
  const next = (err) => { if (err) next.error = err; };
  next.error = null;
  return next;
}

async function call(handler, req) {
  const res = mockRes();
  const next = mockNext();
  await handler({ headers: {}, ...req }, res, next);
  return { res, error: next.error };
}

const stamp = `${Date.now()}`;
// Per-run user ids so re-runs against the same disposable database stay
// isolated (fixtures are stamped and left behind by design).
const rid = require('crypto').randomBytes(2).toString('hex');
const uid = (tail) => `a0000000-0000-4000-8000-${rid}${tail}`;
const OWNER = uid('11111111');
const INVITEE = uid('22222222');
const MANAGER = uid('33333333');
const MANAGER2 = uid('44444444');
const EMPLOYEE = uid('55555555');
const JOINER = uid('66666666');
const GONE = uid('77777777');

let bizId;
let restaurantId;
let managerMembershipId;
let manager2MembershipId;
let employeeMembershipId;

async function insertUser(id, email, firstName) {
  await db.query(
    `INSERT INTO users (id, email, password_hash, first_name, last_name, is_active)
     VALUES ($1, $2, 'x', $3, 'Test', TRUE)
     ON CONFLICT (id) DO NOTHING`,
    [id, email, firstName]
  );
}

async function insertMembership(memberId, role, status = 'active') {
  const { rows: [row] } = await db.query(
    `INSERT INTO business_members (business_id, owner_id, member_id, role, invite_email, status, accepted_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id`,
    [bizId, OWNER, memberId, role, `member-${memberId.slice(1, 5)}@example.com`, status,
     status === 'active' ? new Date() : null]
  );
  return row.id;
}

suite('staff membership lifecycle (S-01/S-03/S-09/S-10/S-11/S-13)', () => {
  beforeAll(async () => {
    await insertUser(OWNER, `owner-${stamp}@example.com`, 'Olive');
    await insertUser(INVITEE, `invitee-${stamp}@example.com`, 'Ivy');
    await insertUser(MANAGER, `manager-${stamp}@example.com`, 'Moe');
    await insertUser(MANAGER2, `manager2-${stamp}@example.com`, 'Mia');
    await insertUser(EMPLOYEE, `employee-${stamp}@example.com`, 'Eli');
    await insertUser(JOINER, `joiner-${stamp}@example.com`, 'Jay');
    await insertUser(GONE, `gone-${stamp}@example.com`, 'Gus');

    const { rows: [biz] } = await db.query(
      `INSERT INTO businesses (user_id, business_name) VALUES ($1, $2) RETURNING id`,
      [OWNER, `Lifecycle Biz ${stamp}`]
    );
    bizId = biz.id;

    const { rows: [rest] } = await db.query(
      `INSERT INTO food_restaurants (business_id, owner_user_id, display_name)
       VALUES ($1, $2, $3) RETURNING id`,
      [bizId, OWNER, `Lifecycle Restaurant ${stamp}`]
    );
    restaurantId = rest.id;

    managerMembershipId = await insertMembership(MANAGER, 'manager');
    manager2MembershipId = await insertMembership(MANAGER2, 'manager');
    employeeMembershipId = await insertMembership(EMPLOYEE, 'employee');
  });

  afterAll(async () => {
    await db.end();
  });

  // ── S-01 ────────────────────────────────────────────────────────────────
  test('S-01: inviting an existing user succeeds and the notification lands with body/data', async () => {
    const email = `invitee-${stamp}@example.com`;
    const { res, error } = await call(membersCtrl.inviteMember, {
      user: { id: OWNER, email: `owner-${stamp}@example.com`, first_name: 'Olive' },
      params: { id: String(bizId) },
      business: { id: bizId, business_name: `Lifecycle Biz ${stamp}`, owner_id: OWNER },
      businessRole: 'owner',
      body: { email, role: 'employee' },
    });
    expect(error).toBeNull();
    expect(res.statusCode).toBe(201);
    expect(res.body.user_found).toBe(true);

    const { rows: [invite] } = await db.query(
      `SELECT * FROM business_members WHERE id = $1`, [res.body.member.id]
    );
    expect(invite.status).toBe('pending');
    expect(invite.member_id).toBe(INVITEE);
    expect(invite.expires_at).toBeTruthy();
    expect(new Date(invite.expires_at).getTime()).toBeGreaterThan(Date.now() + 13 * 24 * 3600 * 1000);

    const { rows: notifications } = await db.query(
      `SELECT * FROM notifications WHERE user_id = $1 AND type = 'business_invite'`, [INVITEE]
    );
    expect(notifications).toHaveLength(1);
    expect(notifications[0].title).toContain('Business invitation');
    expect(notifications[0].body).toContain('invited to join');
    expect(notifications[0].data.invite_id).toBe(invite.id);
    expect(notifications[0].data.business_id).toBe(bizId);

    // Keep later tests independent of this pending invite (the partial
    // unique indexes key on both member_id and invite_email per business).
    await db.query(`UPDATE business_members SET status = 'revoked' WHERE id = $1`, [invite.id]);
  });

  test('S-01: vortex token redemption commits and notifies the owner (no bad-column rollback)', async () => {
    const token = `tok${stamp}`.padEnd(64, 'x').slice(0, 64);
    await db.query(
      `INSERT INTO business_invite_tokens (business_id, owner_id, token, role, expires_at)
       VALUES ($1, $2, $3, 'employee', NOW() + INTERVAL '1 day')`,
      [bizId, OWNER, token]
    );
    const { res, error } = await call(vortexCtrl.redeemToken, {
      user: { id: JOINER, email: `joiner-${stamp}@example.com`, first_name: 'Jay', last_name: 'Test' },
      params: {},
      body: { token },
    });
    expect(error).toBeNull();
    expect(res.statusCode).toBe(200);

    const { rows: [membership] } = await db.query(
      `SELECT * FROM business_members WHERE business_id = $1 AND member_id = $2 AND status = 'active'`,
      [bizId, JOINER]
    );
    expect(membership).toBeTruthy();

    const { rows: notifications } = await db.query(
      `SELECT * FROM notifications WHERE user_id = $1 AND type = 'vortex_redeemed'`, [OWNER]
    );
    expect(notifications).toHaveLength(1);
    expect(notifications[0].body).toContain('has joined');
    expect(notifications[0].data.member_id).toBe(JOINER);
  });

  // ── S-03 + S-09 (invite side) ─────────────────────────────────────────────
  test('S-03/S-09: a manager cannot invite a peer manager, but can onboard an employee with a job-role preset and pay rate', async () => {
    const managerReq = {
      user: { id: MANAGER, email: `manager-${stamp}@example.com`, first_name: 'Moe' },
      params: { id: String(bizId) },
      business: { id: bizId, business_name: `Lifecycle Biz ${stamp}`, owner_id: OWNER },
      businessRole: 'manager',
    };

    const denied = await call(membersCtrl.inviteMember, {
      ...managerReq,
      body: { email: `peer-${stamp}@example.com`, role: 'manager' },
    });
    expect(denied.res.statusCode).toBe(403);
    const { rows: peerRows } = await db.query(
      `SELECT id FROM business_members WHERE business_id = $1 AND invite_email = $2`,
      [bizId, `peer-${stamp}@example.com`]
    );
    expect(peerRows).toHaveLength(0);

    const ok = await call(membersCtrl.inviteMember, {
      ...managerReq,
      body: {
        email: `cashier-${stamp}@example.com`,
        role: 'employee',
        job_role: 'cashier',
        pay_rate_cents: 1600,
        pay_rate_period: 'hour',
      },
    });
    expect(ok.error).toBeNull();
    expect(ok.res.statusCode).toBe(201);
    const invite = ok.res.body.member;
    expect(invite.job_role).toBe('cashier');
    expect(invite.pay_rate_cents).toBe(1600);
    expect(invite.pay_rate_period).toBe('hour');

    const { rows: overrides } = await db.query(
      `SELECT p.code FROM membership_permission_overrides o
         JOIN team_permissions p ON p.id = o.permission_id
        WHERE o.membership_id = $1 AND o.effect = 'allow'
        ORDER BY p.code`,
      [invite.id]
    );
    expect(overrides.map((r) => r.code)).toEqual(['display.view', 'orders.view', 'pos.use']);
  });

  test('S-03: support_agent is invitable and an unknown job role is rejected', async () => {
    const ownerReq = {
      user: { id: OWNER, email: `owner-${stamp}@example.com`, first_name: 'Olive' },
      params: { id: String(bizId) },
      business: { id: bizId, business_name: `Lifecycle Biz ${stamp}`, owner_id: OWNER },
      businessRole: 'owner',
    };
    const bad = await call(membersCtrl.inviteMember, {
      ...ownerReq,
      body: { email: `bad-${stamp}@example.com`, role: 'employee', job_role: 'astronaut' },
    });
    expect(bad.res.statusCode).toBe(400);

    const ok = await call(membersCtrl.inviteMember, {
      ...ownerReq,
      body: { email: `agent-${stamp}@example.com`, role: 'support_agent' },
    });
    expect(ok.res.statusCode).toBe(201);
    expect(ok.res.body.member.role).toBe('support_agent');
  });

  // ── S-09 (role change + overrides) ────────────────────────────────────────
  test('S-09: role change needs confirmation and a reason, and the reason is audited', async () => {
    const baseReq = {
      user: { id: OWNER },
      params: { membershipId: String(employeeMembershipId) },
      business: { id: bizId },
      businessRole: 'owner',
    };
    const noReason = await call(teamCtrl.changeMembershipRole, {
      ...baseReq, body: { role: 'representative', confirm: true },
    });
    expect(noReason.res.statusCode).toBe(400);
    expect(noReason.res.body.code).toBe('reason_required');

    const noConfirm = await call(teamCtrl.changeMembershipRole, {
      ...baseReq, body: { role: 'representative', reason: 'Covers the sales desk' },
    });
    expect(noConfirm.res.statusCode).toBe(400);
    expect(noConfirm.res.body.code).toBe('confirmation_required');

    const done = await call(teamCtrl.changeMembershipRole, {
      ...baseReq,
      body: { role: 'representative', reason: 'Covers the sales desk', confirm: true },
    });
    expect(done.error).toBeNull();
    expect(done.res.statusCode).toBe(200);
    expect(done.res.body.data.role).toBe('representative');

    const { rows: [audit] } = await db.query(
      `SELECT * FROM business_audit_log
        WHERE business_id = $1 AND action = 'business.member.role_changed' AND target_id = $2
        ORDER BY id DESC LIMIT 1`,
      [bizId, String(employeeMembershipId)]
    );
    expect(audit).toBeTruthy();
    expect(audit.metadata.reason).toBe('Covers the sales desk');
    expect(audit.before_state.role).toBe('employee');
    expect(audit.after_state.role).toBe('representative');

    // Restore for later tests.
    await db.query(`UPDATE business_members SET role = 'employee' WHERE id = $1`, [employeeMembershipId]);
  });

  test('S-09: overrides cannot target a peer manager or oneself', async () => {
    const managerActor = {
      user: { id: MANAGER },
      business: { id: bizId },
      businessRole: 'manager',
      permissions: new Set(['team.assign_permissions']),
      body: { overrides: [{ permission_code: 'team.view', effect: 'deny' }] },
    };
    const peer = await call(teamCtrl.setMembershipOverrides, {
      ...managerActor, params: { membershipId: String(manager2MembershipId) },
    });
    expect(peer.res.statusCode).toBe(403);
    expect(peer.res.body.code).toBe('target_rank_too_high');

    const self = await call(teamCtrl.setMembershipOverrides, {
      ...managerActor, params: { membershipId: String(managerMembershipId) },
    });
    expect(self.res.statusCode).toBe(403);
    expect(self.res.body.code).toBe('cannot_edit_own_overrides');

    const below = await call(teamCtrl.setMembershipOverrides, {
      ...managerActor, params: { membershipId: String(employeeMembershipId) },
    });
    expect(below.error).toBeNull();
    expect(below.res.statusCode).toBe(200);
  });

  // ── S-10 ────────────────────────────────────────────────────────────────
  test('S-10: an expired invite cannot be accepted; resend restarts the window; cancel works without Vortex', async () => {
    const { rows: [invite] } = await db.query(
      `INSERT INTO business_members (business_id, owner_id, member_id, role, invite_email, status, expires_at)
       VALUES ($1, $2, $3, 'employee', $4, 'pending', NOW() - INTERVAL '1 day')
       RETURNING id`,
      [bizId, OWNER, INVITEE, `expired-${stamp}@example.com`]
    );

    const accept = await call(membersCtrl.acceptInvitation, {
      user: { id: INVITEE, email: `invitee-${stamp}@example.com` },
      params: { id: String(invite.id) },
      body: {},
    });
    expect(accept.res.statusCode).toBe(410);

    const resend = await call(membersCtrl.resendMemberInvite, {
      user: { id: OWNER, email: `owner-${stamp}@example.com`, first_name: 'Olive' },
      params: { id: String(bizId), memberId: String(invite.id) },
      business: { id: bizId, business_name: `Lifecycle Biz ${stamp}`, owner_id: OWNER },
      businessRole: 'owner',
      body: {},
    });
    expect(resend.error).toBeNull();
    expect(resend.res.statusCode).toBe(200);
    expect(new Date(resend.res.body.member.expires_at).getTime()).toBeGreaterThan(Date.now() + 13 * 24 * 3600 * 1000);

    const { rows: notifs } = await db.query(
      `SELECT id FROM notifications WHERE user_id = $1 AND type = 'business_invite' AND data->>'resent' = 'true'`,
      [INVITEE]
    );
    expect(notifs.length).toBeGreaterThanOrEqual(1);

    // Cancel the pending invite through revokeMember — no Vortex involved.
    const cancel = await call(membersCtrl.revokeMember, {
      user: { id: OWNER, email: `owner-${stamp}@example.com` },
      params: { id: String(bizId), memberId: String(invite.id) },
      business: { id: bizId, business_name: `Lifecycle Biz ${stamp}`, owner_id: OWNER },
      businessRole: 'owner',
      body: {},
    });
    expect(cancel.error).toBeNull();
    expect(cancel.res.statusCode).toBe(200);
    const { rows: [row] } = await db.query(
      `SELECT status FROM business_members WHERE id = $1`, [invite.id]
    );
    expect(row.status).toBe('revoked');
  });

  // ── S-11 ────────────────────────────────────────────────────────────────
  test('S-11: removing a member deactivates their PINs and flags their open drawers, atomically', async () => {
    const pinHash = await bcrypt.hash('4321', 4);
    await db.query(
      `INSERT INTO restaurant_staff_pins (restaurant_id, staff_user_id, staff_label, pin_hash, is_active)
       VALUES ($1, $2, 'Eli', $3, TRUE)`,
      [restaurantId, EMPLOYEE, pinHash]
    );
    await db.query(
      `INSERT INTO restaurant_pos_shifts (restaurant_id, staff_user_id, staff_label, status)
       VALUES ($1, $2, 'Eli', 'open')`,
      [restaurantId, EMPLOYEE]
    );

    const { res, error } = await call(accessCtrl.removeMembership, {
      user: { id: OWNER },
      params: { membershipId: String(employeeMembershipId) },
      business: { id: bizId, business_name: `Lifecycle Biz ${stamp}`, owner_id: OWNER },
      businessRole: 'owner',
      body: {},
    });
    expect(error).toBeNull();
    expect(res.statusCode).toBe(200);
    expect(res.body.data.offboarding).toEqual({ pinsDeactivated: 1, drawersFlagged: 1 });

    const { rows: [pin] } = await db.query(
      `SELECT is_active FROM restaurant_staff_pins WHERE restaurant_id = $1 AND staff_user_id = $2`,
      [restaurantId, EMPLOYEE]
    );
    expect(pin.is_active).toBe(false);

    const { rows: [shift] } = await db.query(
      `SELECT status, flagged_for_close_at FROM restaurant_pos_shifts WHERE restaurant_id = $1 AND staff_user_id = $2`,
      [restaurantId, EMPLOYEE]
    );
    expect(shift.status).toBe('open');
    expect(shift.flagged_for_close_at).toBeTruthy();

    const { rows: [membership] } = await db.query(
      `SELECT status FROM business_members WHERE id = $1`, [employeeMembershipId]
    );
    expect(membership.status).toBe('revoked');
  });

  test('S-11: validateStaffPin refuses a PIN whose owner is no longer a member and retires it', async () => {
    // Reuse the PIN row from the removal test (unique per restaurant+user):
    // a manager re-activating it must not resurrect access, because the
    // membership check below is what actually refuses the unlock.
    const pinHash = await bcrypt.hash('9876', 4);
    const { rows: [pin] } = await db.query(
      `UPDATE restaurant_staff_pins SET pin_hash = $3, is_active = TRUE
        WHERE restaurant_id = $1 AND staff_user_id = $2 RETURNING id`,
      [restaurantId, EMPLOYEE, pinHash]
    );
    expect(pin).toBeTruthy();
    // EMPLOYEE's membership was revoked by the previous test.
    const { res, error } = await call(appFlowCtrl.validateStaffPin, {
      user: { id: OWNER },
      params: { restaurantId: String(restaurantId) },
      body: { pin: '9876' },
    });
    expect(error).toBeNull();
    expect(res.statusCode).toBe(401);
    const { rows: [after] } = await db.query(
      `SELECT is_active FROM restaurant_staff_pins WHERE id = $1`, [pin.id]
    );
    expect(after.is_active).toBe(false);
  });

  test('S-11: staff-history user FKs are SET NULL (retention), verified in the catalog', async () => {
    // An end-to-end `DELETE FROM users` cannot be exercised in this schema:
    // the append-only rewrite rules on food_customer_wallet_ledger break
    // Postgres' referential-integrity check for ANY user delete
    // ("referential integrity query ... gave unexpected result", reproduced
    // with a bare user that has no rows anywhere — a pre-existing defect
    // owned by the credit-ledger work, also documented by the franchise
    // review tracks). What migration 946 owns is the delete ACTION on the
    // staff-history FKs, so assert exactly that, plus column nullability
    // (SET NULL cannot fire into a NOT NULL column).
    const expected = [
      ['restaurant_training_assignments', 'restaurant_training_assignments_user_id_fkey', 'user_id'],
      ['restaurant_staff_pins', 'restaurant_staff_pins_staff_user_id_fkey', 'staff_user_id'],
      ['business_staff_shifts', 'business_staff_shifts_user_id_fkey', 'user_id'],
      ['business_time_entries', 'business_time_entries_user_id_fkey', 'user_id'],
    ];
    for (const [table, constraint, column] of expected) {
      const { rows: [def] } = await db.query(
        `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = $1`,
        [constraint]
      );
      expect(def.def).toContain('ON DELETE SET NULL');
      const { rows: [col] } = await db.query(
        `SELECT is_nullable FROM information_schema.columns
          WHERE table_name = $1 AND column_name = $2`,
        [table, column]
      );
      expect(col.is_nullable).toBe('YES');
    }

    // And the semantics land: a history row can carry a NULL user (the
    // state a deleted employee's records end in) instead of being forced
    // out with the account.
    const { rows: [entry] } = await db.query(
      `INSERT INTO business_time_entries (business_id, user_id, hours_worked)
       VALUES ($1, NULL, 8) RETURNING id`,
      [bizId]
    );
    expect(entry.id).toBeTruthy();
  });

  // ── S-13 ────────────────────────────────────────────────────────────────
  test('S-13: legacy crew bootstrap seeds no completed/passed/awarded states, and updateModule requires manage', async () => {
    // One restaurant per business (unique index), so reuse the fixture
    // restaurant — nothing else in this suite touches the crew tables.
    const rest2 = { id: restaurantId };

    const boot = await call(crewCtrl.bootstrapDefaults, {
      user: { id: OWNER },
      params: { restaurantId: String(rest2.id) },
      body: {},
    });
    expect(boot.error).toBeNull();
    expect(boot.res.statusCode).toBe(200);
    expect(boot.res.body.modules.length).toBeGreaterThan(0);
    expect(boot.res.body.modules.every((m) => m.is_complete === false)).toBe(true);
    expect(boot.res.body.quizzes.every((q) => q.passed === false)).toBe(true);
    expect(boot.res.body.badges.every((b) => b.awarded === false)).toBe(true);

    const moduleId = boot.res.body.modules[0].id;
    // MANAGER2 is a member (manager) — allowed. Use a fresh employee
    // membership for the denial: JOINER joined as employee via Vortex.
    const denied = await call(crewCtrl.updateModule, {
      user: { id: JOINER },
      params: { restaurantId: String(rest2.id), moduleId: String(moduleId) },
      body: { title: 'Renamed by a cook' },
    });
    expect(denied.error).toBeTruthy();
    expect(denied.error.statusCode).toBe(403);

    const allowed = await call(crewCtrl.updateModule, {
      user: { id: MANAGER },
      params: { restaurantId: String(rest2.id), moduleId: String(moduleId) },
      body: { title: 'Renamed by a manager' },
    });
    expect(allowed.error).toBeNull();
    expect(allowed.res.statusCode).toBe(200);
    expect(allowed.res.body.module.title).toBe('Renamed by a manager');
  });
});
