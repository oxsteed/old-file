'use strict';

// G-27: removing a team member, changing their role, or replacing/clearing
// their location assignments must bump that member's projection version in
// the same transaction, so their nav and BusinessSwitcher stop showing
// stale access. Runs only against the disposable Track A database:
//   STATEMENT_TEST_DATABASE_URL=postgresql://oxsteed:statement-test-password@127.0.0.1:5432/credit_statement_test_pr804_a

jest.unmock('pg');
const databaseUrl = process.env.STATEMENT_TEST_DATABASE_URL;
const permitted = (() => {
  try {
    const u = new URL(databaseUrl);
    return ['postgres:', 'postgresql:'].includes(u.protocol)
      && ['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname)
      && u.pathname === '/credit_statement_test_pr804_a';
  } catch { return false; }
})();
if (permitted) process.env.DATABASE_URL = databaseUrl;
const dbDescribe = permitted ? describe : describe.skip;

const crypto = require('crypto');
const pool = require('../db');
const accessCtrl = require('../controllers/businessAccessCodesController');
const teamCtrl = require('../controllers/businessTeamController');
const locationCtrl = require('../controllers/restaurantLocationAccessController');

jest.setTimeout(60000);

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

async function projectionVersion(userId) {
  const { rows } = await pool.query(
    'SELECT version FROM access_projection_versions WHERE user_id = $1',
    [userId],
  );
  return rows.length ? Number(rows[0].version) : 0;
}

const stamp = `${Date.now()}`;
const rid = crypto.randomBytes(2).toString('hex');
const uid = (tail) => `b0000000-0000-4000-8000-${rid}${tail}`;
const OWNER = uid('11111111');
const REMOVE_MEMBER = uid('22222222');
const ROLE_MEMBER = uid('33333333');
const LOC_MEMBER = uid('44444444');

let bizId;
let restaurantId;
let loc1Id;
let loc2Id;
let removeMembershipId;
let roleMembershipId;
let locMembershipId;

async function insertUser(id, email, firstName) {
  await pool.query(
    `INSERT INTO users (id, email, password_hash, first_name, last_name, is_active)
     VALUES ($1, $2, 'x', $3, 'Test', TRUE)
     ON CONFLICT (id) DO NOTHING`,
    [id, email, firstName],
  );
}

async function insertMembership(memberId, role) {
  const { rows: [row] } = await pool.query(
    `INSERT INTO business_members (business_id, owner_id, member_id, role, invite_email, status, accepted_at)
     VALUES ($1, $2, $3, $4, $5, 'active', NOW())
     RETURNING id`,
    [bizId, OWNER, memberId, role, `member-${memberId.slice(1, 5)}@example.com`],
  );
  return row.id;
}

dbDescribe('projection bump on membership change (G-27)', () => {
  beforeAll(async () => {
    await insertUser(OWNER, `owner-${stamp}@example.com`, 'Olive');
    await insertUser(REMOVE_MEMBER, `remove-${stamp}@example.com`, 'Remy');
    await insertUser(ROLE_MEMBER, `role-${stamp}@example.com`, 'Rosa');
    await insertUser(LOC_MEMBER, `loc-${stamp}@example.com`, 'Lena');

    const { rows: [biz] } = await pool.query(
      'INSERT INTO businesses (user_id, business_name) VALUES ($1, $2) RETURNING id',
      [OWNER, `Projection Bump Biz ${stamp}`],
    );
    bizId = biz.id;

    const { rows: [rest] } = await pool.query(
      `INSERT INTO food_restaurants (business_id, owner_user_id, display_name)
       VALUES ($1, $2, $3) RETURNING id`,
      [bizId, OWNER, `Projection Bump Restaurant ${stamp}`],
    );
    restaurantId = rest.id;

    const { rows: [loc1] } = await pool.query(
      'INSERT INTO restaurant_locations (restaurant_id, name) VALUES ($1, $2) RETURNING id',
      [restaurantId, 'Downtown'],
    );
    loc1Id = loc1.id;
    const { rows: [loc2] } = await pool.query(
      'INSERT INTO restaurant_locations (restaurant_id, name) VALUES ($1, $2) RETURNING id',
      [restaurantId, 'Airport'],
    );
    loc2Id = loc2.id;

    removeMembershipId = await insertMembership(REMOVE_MEMBER, 'employee');
    roleMembershipId = await insertMembership(ROLE_MEMBER, 'employee');
    locMembershipId = await insertMembership(LOC_MEMBER, 'employee');
  });

  afterAll(async () => { if (pool) await pool.end(); });

  test('removeMembership bumps the removed member projection version', async () => {
    expect(await projectionVersion(REMOVE_MEMBER)).toBe(0);
    const { res, error } = await call(accessCtrl.removeMembership, {
      user: { id: OWNER },
      params: { membershipId: String(removeMembershipId) },
      business: { id: bizId, business_name: `Projection Bump Biz ${stamp}`, owner_id: OWNER },
      businessRole: 'owner',
      body: {},
    });
    expect(error).toBeNull();
    expect(res.statusCode).toBe(200);
    const { rows: [membership] } = await pool.query(
      'SELECT status FROM business_members WHERE id = $1', [removeMembershipId],
    );
    expect(membership.status).toBe('revoked');
    expect(await projectionVersion(REMOVE_MEMBER)).toBe(1);
  });

  test('changeMembershipRole bumps the member projection version', async () => {
    expect(await projectionVersion(ROLE_MEMBER)).toBe(0);
    const { res, error } = await call(teamCtrl.changeMembershipRole, {
      user: { id: OWNER },
      params: { membershipId: String(roleMembershipId) },
      business: { id: bizId },
      businessRole: 'owner',
      body: { role: 'representative', reason: 'Covers the sales desk', confirm: true },
    });
    expect(error).toBeNull();
    expect(res.statusCode).toBe(200);
    expect(res.body.data.role).toBe('representative');
    expect(await projectionVersion(ROLE_MEMBER)).toBe(1);
  });

  test('location replace then clear each bump the member projection version', async () => {
    expect(await projectionVersion(LOC_MEMBER)).toBe(0);
    const replaced = await call(locationCtrl.replace, {
      user: { id: OWNER },
      params: { restaurantId: String(restaurantId), membershipId: String(locMembershipId) },
      body: { locationIds: [loc1Id, loc2Id] },
    });
    expect(replaced.error).toBeNull();
    expect(replaced.res.statusCode).toBe(200);
    expect(replaced.res.body.assignments).toHaveLength(2);
    expect(await projectionVersion(LOC_MEMBER)).toBe(1);

    const cleared = await call(locationCtrl.clear, {
      user: { id: OWNER },
      params: { restaurantId: String(restaurantId), membershipId: String(locMembershipId) },
      body: {},
    });
    expect(cleared.error).toBeNull();
    expect(cleared.res.statusCode).toBe(200);
    expect(cleared.res.body).toEqual({ cleared: 2, scope: 'all' });
    expect(await projectionVersion(LOC_MEMBER)).toBe(2);
  });
});
