'use strict';

/**
 * Staff review S-10 remainders against the real migrated schema: the
 * invite-expiry sweeper job and the manual "expire now" action.
 *
 * Opt-in disposable database, same as the other track suites:
 *   ST_W2_TEST_DATABASE_URL=postgresql://oxsteed:statement-test-password@127.0.0.1:5432/st_w2
 *     npx jest __tests__/staffInviteExpiry.db.test.js
 */
function stW2OptIn() {
  const value = process.env.ST_W2_TEST_DATABASE_URL || '';
  if (!value) return '';
  const url = new URL(value);
  const loopback = ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(url.hostname);
  if (!loopback || url.pathname !== '/st_w2') {
    throw new Error('ST_W2_TEST_DATABASE_URL must be a loopback st_w2 database');
  }
  return value;
}

const url = stW2OptIn();
if (url) process.env.DATABASE_URL = url;
jest.unmock('pg');
jest.unmock('../db');

const db = require('../db');
const membersCtrl = require('../controllers/businessMembersController');
const { sweep } = require('../jobs/staffInviteExpiryJob');

const suite = url ? describe : describe.skip;

function mockRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
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
const rid = require('crypto').randomBytes(2).toString('hex');
const uid = (tail) => `c0000000-0000-4000-8000-${rid}${tail}`;
const OWNER = uid('11111111');
const MANAGER = uid('22222222');
const INVITEE = uid('33333333');
const INVITEE2 = uid('44444444');
const INVITEE3 = uid('55555555');

let bizId;
let bizName;

async function insertUser(id, email) {
  await db.query(
    `INSERT INTO users (id, email, password_hash, first_name, last_name, is_active)
     VALUES ($1, $2, 'x', 'Test', 'User', TRUE)
     ON CONFLICT (id) DO NOTHING`,
    [id, email]
  );
}

async function insertInvite({ memberId, role = 'employee', expiresAt, status = 'pending' }) {
  const { rows: [row] } = await db.query(
    `INSERT INTO business_members
       (business_id, owner_id, member_id, role, invite_email, status, invited_at, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW() - INTERVAL '20 days', $7)
     RETURNING id`,
    [bizId, OWNER, memberId, role, `inv-${row0()}@example.com`, status, expiresAt]
  );
  return row.id;
}
let seq = 0;
function row0() { seq += 1; return `${stamp}${seq}`; }

function asOwner() {
  return {
    user: { id: OWNER, first_name: 'Olive' },
    business: { id: bizId, business_name: bizName, owner_id: OWNER },
    params: { id: String(bizId) },
  };
}
function asManager() {
  return {
    user: { id: MANAGER, first_name: 'Moe' },
    business: { id: bizId, business_name: bizName, owner_id: OWNER },
    businessRole: 'manager',
    params: { id: String(bizId) },
  };
}

suite('S-10 invite expiry (DB)', () => {
  beforeAll(async () => {
    await insertUser(OWNER, `exp-owner-${stamp}@example.com`);
    await insertUser(MANAGER, `exp-manager-${stamp}@example.com`);
    await insertUser(INVITEE, `exp-invitee-${stamp}@example.com`);
    await insertUser(INVITEE2, `exp-invitee2-${stamp}@example.com`);
    await insertUser(INVITEE3, `exp-invitee3-${stamp}@example.com`);
    const { rows: [biz] } = await db.query(
      `INSERT INTO businesses (user_id, business_name) VALUES ($1, $2) RETURNING id, business_name`,
      [OWNER, `Expiry Biz ${stamp}`]
    );
    bizId = biz.id;
    bizName = biz.business_name;
    await db.query(
      `INSERT INTO business_members (business_id, owner_id, member_id, role, invite_email, status, accepted_at)
       VALUES ($1, $2, $3, 'manager', $4, 'active', NOW()) ON CONFLICT DO NOTHING`,
      [bizId, OWNER, MANAGER, `exp-manager-${stamp}@example.com`]
    );
  });

  afterAll(async () => { await db.end(); });

  test('migration 1201: expired is an allowed member status', async () => {
    const { rows } = await db.query(
      `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
        WHERE conrelid = 'business_members'::regclass AND conname = 'business_members_status_check'`
    );
    expect(rows[0].def).toContain('expired');
  });

  test('sweeper expires lapsed invites and notifies the invitee', async () => {
    const past = new Date(Date.now() - 86400000).toISOString();
    const future = new Date(Date.now() + 86400000).toISOString();
    const lapsedId = await insertInvite({ memberId: INVITEE, expiresAt: past });
    const freshId = await insertInvite({ memberId: null, expiresAt: future });

    const result = await sweep(db);
    expect(result.expired).toBeGreaterThanOrEqual(1);

    const { rows } = await db.query(
      `SELECT id, status FROM business_members WHERE id = ANY($1::bigint[])`,
      [[lapsedId, freshId]]
    );
    const byId = new Map(rows.map((r) => [String(r.id), r.status]));
    expect(byId.get(String(lapsedId))).toBe('expired');
    expect(byId.get(String(freshId))).toBe('pending');

    const { rows: notifs } = await db.query(
      `SELECT type FROM notifications WHERE user_id = $1 AND type = 'business_invite_expired'`,
      [INVITEE]
    );
    expect(notifs.length).toBeGreaterThanOrEqual(1);
  });

  test('expireMemberInvite: owner expires a pending invite now', async () => {
    const future = new Date(Date.now() + 86400000 * 5).toISOString();
    const inviteId = await insertInvite({ memberId: INVITEE3, expiresAt: future });
    const { res, error } = await call(membersCtrl.expireMemberInvite, {
      ...asOwner(),
      params: { id: String(bizId), memberId: String(inviteId) },
    });
    expect(error).toBeNull();
    expect(res.statusCode).toBe(200);
    expect(res.body.member.status).toBe('expired');

    const { rows } = await db.query(`SELECT status FROM business_members WHERE id = $1`, [inviteId]);
    expect(rows[0].status).toBe('expired');
  });

  test('expireMemberInvite: non-pending invites are rejected', async () => {
    const { rows: [row] } = await db.query(
      `INSERT INTO business_members (business_id, owner_id, member_id, role, invite_email, status, accepted_at)
       VALUES ($1, $2, $3, 'employee', $4, 'active', NOW()) RETURNING id`,
      [bizId, OWNER, INVITEE2, `active-${stamp}@example.com`]
    );
    const { res } = await call(membersCtrl.expireMemberInvite, {
      ...asOwner(),
      params: { id: String(bizId), memberId: String(row.id) },
    });
    expect(res.statusCode).toBe(409);
  });

  test('expireMemberInvite: manager cannot expire a peer manager invite (S-09 rank)', async () => {
    const future = new Date(Date.now() + 86400000 * 5).toISOString();
    const inviteId = await insertInvite({ memberId: null, role: 'manager', expiresAt: future });
    const { res } = await call(membersCtrl.expireMemberInvite, {
      ...asManager(),
      params: { id: String(bizId), memberId: String(inviteId) },
    });
    expect(res.statusCode).toBe(403);
  });
});
