'use strict';
const crypto = require('crypto');
const schema = `business_scope_${crypto.randomBytes(6).toString('hex')}`;
const url = process.env.STATEMENT_TEST_DATABASE_URL;
if (url) {
  const target = new URL(url);
  if (!['127.0.0.1','localhost'].includes(target.hostname) || target.pathname !== '/credit_statement_test') throw new Error('Disposable DB required');
  target.searchParams.set('options', `-c search_path=${schema},public`);process.env.DATABASE_URL = target.toString();
}
jest.unmock('pg');jest.unmock('../db');
const db = require('../db');
const access = require('../utils/businessOwnership');
const requireBusinessAccess = require('../middleware/requireBusinessAccess');
const owner = '11111111-1111-4111-8111-111111111111', member = '22222222-2222-4222-8222-222222222222';

(url ? describe : describe.skip)('business scope convergence preserves domain policies', () => {
  beforeAll(async () => {
    await db.query(`CREATE SCHEMA ${schema}; CREATE TABLE businesses(id BIGINT PRIMARY KEY,business_name TEXT,is_primary BOOLEAN,tax_rate NUMERIC,user_id UUID,is_active BOOLEAN,deleted_at TIMESTAMPTZ);
      CREATE TABLE business_members(id BIGSERIAL PRIMARY KEY,business_id BIGINT,member_id UUID,role TEXT,status TEXT)`);
  });
  afterAll(async () => { await db.query(`DROP SCHEMA ${schema} CASCADE`);await db.end(); });
  beforeEach(async () => {await db.query(`TRUNCATE businesses,business_members; INSERT INTO businesses VALUES(1,'Synthetic business',true,5,'${owner}',true,NULL)`);});

  test.each(['owner','manager','representative','support_agent','employee'])('keeps %s membership separate from actual ownership', async role => {
    await db.query(`INSERT INTO business_members(business_id,member_id,role,status) VALUES(1,$1,$2,'active')`,[member,role]);
    expect(await access.ownedBusiness(member,1)).toBeNull();
    expect(!!(await access.canEditProfile(member,1))).toBe(role==='manager');
    expect(!!(await access.canManageBusinessFinance(member,1))).toBe(role==='manager');
    expect(await access.canAccessBusinessTeam(member,1)).toEqual({id:'1',owner_id:owner});
    expect(await access.ownedBusiness(owner,1)).toEqual({id:'1',business_name:'Synthetic business',is_primary:true,tax_rate:'5'});
  });

  test('inactive memberships confer no access and deleted-finance behavior is preserved', async () => {
    await db.query(`INSERT INTO business_members(business_id,member_id,role,status) VALUES(1,$1,'manager','inactive')`,[member]);
    expect(await access.canEditProfile(member,1)).toBeNull();
    await db.query('UPDATE businesses SET deleted_at=NOW()');
    expect(await access.ownedBusiness(owner,1)).not.toBeNull();
    expect(await access.canEditProfile(owner,1)).not.toBeNull();
    expect(await access.canManageBusinessFinance(owner,1)).toBeNull();
  });

  async function middleware(userId,businessId) {
    const req = {user:userId?{id:userId}:null,params:{businessId}};
    const res = {status:jest.fn().mockReturnThis(),json:jest.fn().mockReturnThis()};const next=jest.fn();
    await requireBusinessAccess({resolvePermissions:false})(req,res,next);return{req,res,next};
  }
  test('middleware retains attachments, authentication, validation and hidden-row behavior', async () => {
    const ok = await middleware(owner,'1');expect(ok.next).toHaveBeenCalledWith();
    expect(ok.req.businessRole).toBe('owner');expect(ok.req.membership).toBeNull();
    expect(ok.req.business.owner_id).toBe(owner);
    expect((await middleware(null,'1')).res.status).toHaveBeenCalledWith(401);
    expect((await middleware(owner,'bad')).res.status).toHaveBeenCalledWith(400);
    expect((await middleware(member,'1')).res.status).toHaveBeenCalledWith(404);
    await db.query('UPDATE businesses SET is_active=FALSE');
    expect((await middleware(owner,'1')).res.status).toHaveBeenCalledWith(404);
  });
});
