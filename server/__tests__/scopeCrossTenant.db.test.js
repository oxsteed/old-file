'use strict';

// Cross-tenant denial for every shared scope gate, against real SQL.
// Tenant A (business 1 / restaurant 10) and tenant B (business 2 / restaurant 20)
// each have an owner, a manager, a representative and a support agent; nobody
// from A may pass a gate for B. Route coverage (every tenant route carries one
// of these gates) is enforced by routeScopeGuard.test.js.
const crypto = require('crypto');
const schema = `scope_cross_${crypto.randomBytes(6).toString('hex')}`;
const url = process.env.STATEMENT_TEST_DATABASE_URL;
if (url) {
  const target = new URL(url);
  if (!['127.0.0.1', 'localhost'].includes(target.hostname) || target.pathname !== '/credit_statement_test') throw new Error('Disposable DB required');
  target.searchParams.set('options', `-c search_path=${schema},public`);
  process.env.DATABASE_URL = target.toString();
}
jest.unmock('pg');
jest.unmock('../db');
const db = require('../db');
const requireBusinessAccess = require('../middleware/requireBusinessAccess');
const { requireRestaurantAccess, requireSupportBusinessAccess, businessScopeSatisfies, supportScopeSatisfies } = require('../middleware/scopeGates');
const scopeModel = require('../services/scopeModel');

const uid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const A = { business: 1, restaurant: 10, owner: uid(1), manager: uid(2), rep: uid(3), agent: uid(4) };
const B = { business: 2, restaurant: 20, owner: uid(11), manager: uid(12), rep: uid(13), agent: uid(14) };
const STAFF = ['owner', 'manager', 'rep', 'agent'];

async function run(mw, user, params) {
  const req = { user: { id: user, role: 'customer' }, params };
  let status = null;
  let nextErr;
  const res = { status: jest.fn((s) => { status = s; return res; }), json: jest.fn(() => res) };
  let passed = false;
  await new Promise((resolve) => {
    Promise.resolve(mw(req, res, (err) => { nextErr = err; passed = !err; resolve(); })).then(() => setImmediate(resolve));
  });
  if (nextErr && !nextErr.statusCode) throw nextErr;
  return { passed, status: status || (nextErr && nextErr.statusCode) || null, req };
}

(url ? describe : describe.skip)('scope gates deny cross-tenant access', () => {
  beforeAll(async () => {
    await db.query(`CREATE SCHEMA ${schema};
      CREATE TABLE businesses(id INT PRIMARY KEY, business_name TEXT, is_primary BOOLEAN, tax_rate NUMERIC, user_id UUID, is_active BOOLEAN DEFAULT TRUE, deleted_at TIMESTAMPTZ);
      CREATE TABLE business_members(id BIGSERIAL PRIMARY KEY, business_id INT, member_id UUID, role TEXT, status TEXT);
      CREATE TABLE food_restaurants(id INT PRIMARY KEY, business_id INT, owner_user_id UUID, name TEXT);
      CREATE TABLE support_employers(id INT PRIMARY KEY, kind TEXT, business_id INT, helper_user_id UUID);
      CREATE TABLE support_agents(id SERIAL PRIMARY KEY, user_id UUID, employer_id INT, status TEXT, created_at TIMESTAMPTZ DEFAULT NOW());`);
    for (const t of [A, B]) {
      await db.query(`INSERT INTO businesses(id,business_name,is_primary,tax_rate,user_id) VALUES($1,'Biz',true,0,$2)`, [t.business, t.owner]);
      await db.query(`INSERT INTO business_members(business_id,member_id,role,status) VALUES($1,$2,'manager','active'),($1,$3,'representative','active')`, [t.business, t.manager, t.rep]);
      await db.query(`INSERT INTO food_restaurants(id,business_id,name) VALUES($1,$2,'R')`, [t.restaurant, t.business]);
      await db.query(`INSERT INTO support_employers(id,kind,business_id) VALUES($1,'business',$1)`, [t.business]);
      await db.query(`INSERT INTO support_agents(user_id,employer_id,status) VALUES($1,$2,'active')`, [t.agent, t.business]);
    }
  });
  afterAll(async () => { await db.query(`DROP SCHEMA ${schema} CASCADE`); await db.end(); });

  test.each(STAFF)('business gate: tenant A %s cannot reach business B', async (who) => {
    for (const minRole of ['any', 'representative', 'manager', 'owner']) {
      const r = await run(requireBusinessAccess({ minRole, resolvePermissions: false }), A[who], { businessId: String(B.business) });
      expect(r.passed).toBe(false);
      expect(r.status).toBe(404);
    }
  });

  test('business gate admits A staff to A at their role and scopes to A only', async () => {
    const r = await run(requireBusinessAccess({ minRole: 'manager', resolvePermissions: false }), A.manager, { businessId: '1' });
    expect(r.passed).toBe(true);
    expect(businessScopeSatisfies(r.req, 1, 'manager')).toBe(true);
    expect(businessScopeSatisfies(r.req, 2, 'any')).toBe(false);
    expect(businessScopeSatisfies(r.req, 1, 'owner')).toBe(false);
    const rep = await run(requireBusinessAccess({ minRole: 'manager', resolvePermissions: false }), A.rep, { businessId: '1' });
    expect(rep.status).toBe(403);
  });

  test.each(STAFF)('restaurant gate: tenant A %s cannot reach restaurant B', async (who) => {
    const r = await run(requireRestaurantAccess(), A[who], { restaurantId: String(B.restaurant) });
    expect(r.passed).toBe(false);
    expect(r.status).toBe(404);
  });

  test('restaurant gate admits A staff to A and hands off only that row', async () => {
    const r = await run(requireRestaurantAccess(), A.manager, { restaurantId: '10' });
    expect(r.passed).toBe(true);
    expect(r.req.restaurantRole).toBe('manager');
    // Outside the gate's async context nothing is handed off: a B lookup reads fresh and is denied.
    await expect(scopeModel.resolveRestaurantAccess(A.manager, 20)).rejects.toMatchObject({ statusCode: 404 });
  });

  test.each(STAFF)('support gate: tenant A %s cannot reach business B at any level', async (who) => {
    for (const level of ['conversations', 'manage', 'administrate']) {
      const r = await run(requireSupportBusinessAccess(level), A[who], { businessId: String(B.business) });
      expect(r.passed).toBe(false);
      expect(r.status).toBe(403);
    }
  });

  test('support gate levels inside tenant A match the controller helpers', async () => {
    const expectPass = async (user, level, ok) => {
      const r = await run(requireSupportBusinessAccess(level), user, { businessId: '1' });
      expect([user, level, r.passed]).toEqual([user, level, ok]);
      if (ok) expect(supportScopeSatisfies(r.req, 2, 'conversations')).toBe(false);
    };
    await expectPass(A.owner, 'administrate', true);
    await expectPass(A.rep, 'administrate', true);
    await expectPass(A.agent, 'administrate', false);
    await expectPass(A.agent, 'manage', false);
    await expectPass(A.agent, 'conversations', true);
  });
});
