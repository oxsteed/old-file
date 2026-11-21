'use strict';
const raw=process.env.ACCESS_TEST_DATABASE_URL;
if(raw){const url=new URL(raw);if(!['127.0.0.1','localhost'].includes(url.hostname)||url.pathname!=='/credit_statement_test')throw new Error('Disposable membership database required');process.env.DATABASE_URL=raw;}
jest.unmock('pg');jest.unmock('../db');jest.unmock('../utils/transaction');jest.unmock('../services/businessMembershipExpiry');
const crypto=require('crypto'),jwt=require('jsonwebtoken'),db=require('../db'),expiry=require('../services/businessMembershipExpiry'),scope=require('../services/scopeModel'),access=require('../services/access/accessService'),team=require('../services/businessTeamReadiness');
const owner=crypto.randomUUID(),member=crypto.randomUUID(),other=crypto.randomUUID(),businesses=[];let sessionId;
const describeDb=raw?describe:describe.skip;
async function workspace(userId=owner){const {rows:[b]}=await db.query("INSERT INTO businesses(user_id,business_name,is_primary,is_active,is_listed) VALUES($1,'Timed membership',FALSE,TRUE,FALSE) RETURNING id",[userId]);businesses.push(b.id);const {rows:[m]}=await db.query("INSERT INTO business_members(business_id,owner_id,member_id,invite_email,role,status) VALUES($1,$2,$3,$4,'manager','active') RETURNING *",[b.id,userId,member,`expiry-${member}@example.invalid`]);return {id:b.id,membership:m};}
function app(){const express=require('express'),instance=express();instance.use(express.json());instance.use('/api/businesses',require('../routes/businessTeam'));instance.use('/api/helpers/me',require('../routes/helperWork'));instance.use(require('../middleware/errorHandler').errorHandler);return instance;}
const token=userId=>jwt.sign({id:userId,typ:'access',sid:String(sessionId||'expiry-fixture')},process.env.JWT_SECRET,{expiresIn:'1h'});
describeDb('time-bound membership authority and isolated cleanup',()=>{
 beforeAll(async()=>{
  for(const id of [owner,member,other])await db.query("INSERT INTO users(id,email,password_hash,first_name,last_name,role,email_verified,is_active,id_verified,identity_verified,didit_enforcement_required,didit_status,terms_accepted,terms_accepted_at,terms_version) VALUES($1,$2,'x','Expiry','Fixture','customer',TRUE,TRUE,TRUE,TRUE,FALSE,'verified',TRUE,NOW(),'expiry-test')",[id,`expiry-${id}@example.invalid`]);
  await db.query("INSERT INTO access_grants(user_id,capability,subject_type,subject_key,status,provenance,policy_version) VALUES($1,'helper.offer_services','self','self','active','legacy_backfill','helper-policy-1')",[member]);
  sessionId=(await db.query("INSERT INTO sessions(user_id,refresh_token,expires_at,is_valid) VALUES($1,$2,NOW()+INTERVAL '1 day',TRUE) RETURNING id",[member,crypto.randomUUID()])).rows[0].id;
 });
 afterAll(async()=>{await db.query('DELETE FROM staff_offboarding_records WHERE business_id=ANY($1::int[])',[businesses]);await db.query('DELETE FROM businesses WHERE id=ANY($1::int[])',[businesses]);await db.query('DELETE FROM sessions WHERE id=$1',[sessionId]);await db.query('DELETE FROM access_grants WHERE user_id=$1',[member]);await db.end();});
 test('only owner schedules/clears active access; versions and invite expiry remain distinct',async()=>{
  const business=await workspace();
  await expect(expiry.schedule(business.id,member,business.membership.id,{expectedVersion:1,expires_at:'2030-01-01T00:00:00Z'})).rejects.toMatchObject({statusCode:404});
  const set=await expiry.schedule(business.id,owner,business.membership.id,{expectedVersion:1,expires_at:'2030-01-01T00:00:00Z'});expect(set.permission_version).toBe(2);
  expect((await db.query('SELECT expires_at FROM business_members WHERE id=$1',[business.membership.id])).rows[0].expires_at).toBeNull();
  await expect(expiry.schedule(business.id,owner,business.membership.id,{expectedVersion:1,expires_at:null})).rejects.toMatchObject({statusCode:409});
  await expiry.schedule(business.id,owner,business.membership.id,{expectedVersion:2,expires_at:null});
  expect((await scope.resolveBusinessAccess(member,business.id)).effective_role).toBe('manager');
 });
 test('scope and projection deny a past deadline before cleanup, including restaurant scope',async()=>{
  const business=await workspace();const restaurant=(await db.query("INSERT INTO food_restaurants(business_id,owner_user_id,display_name,status) VALUES($1,$2,'Timed restaurant','active') RETURNING id",[business.id,owner])).rows[0].id;
  await db.query("INSERT INTO membership_permission_overrides(membership_id,permission_id,effect,reason) SELECT $1,id,'allow','Finance fixture' FROM team_permissions WHERE code='payouts.view'",[business.membership.id]);
  const finance=require('../services/access/financeStanding');
  expect(await finance.memberFinanceReadStanding(db,{businessId:business.id,userId:member,restaurantId:restaurant})).toBe('finance');
  await db.query("UPDATE business_members SET access_valid_until=NOW()-INTERVAL '1 minute' WHERE id=$1",[business.membership.id]);
  expect(await finance.memberFinanceReadStanding(db,{businessId:business.id,userId:member,restaurantId:restaurant})).toBeNull();
  expect(await scope.resolveBusinessAccess(member,business.id)).toBeNull();
  await expect(scope.resolveRestaurantAccess(member,restaurant)).rejects.toMatchObject({statusCode:404});
  const projection=await access.getProjection(member);expect(projection.organizations.some(row=>String(row.id)===String(business.id))).toBe(false);
  await expiry.expireForUser(member);
 });
 test('a real authenticated old link expires only one relationship and preserves other work and sessions',async()=>{
  const ending=await workspace(),retained=await workspace(other);
  await team.createTask(ending.id,owner,{kind:'task',title:'Assigned work stays with the business',assignee_id:member,due_at:'2030-01-01T12:00:00Z',requestId:crypto.randomUUID()});
  await db.query("UPDATE business_members SET access_valid_until=NOW()-INTERVAL '1 second' WHERE id=$1",[ending.membership.id]);
  const request=require('supertest')(app()),bearer=`Bearer ${token(member)}`;
  await request.get(`/api/businesses/${ending.id}/team/readiness`).set('Authorization',bearer).expect(404);
  await request.get(`/api/businesses/${retained.id}/team/readiness`).set('Authorization',bearer).expect(200);
  await request.get('/api/helpers/me/capacity').set('Authorization',bearer).expect(200);
  expect((await db.query('SELECT is_valid FROM sessions WHERE id=$1',[sessionId])).rows[0].is_valid).toBe(true);
  const record=await team.read(ending.id,owner);expect(record.tasks[0].assignee_id).toBe(owner);expect(record.offboarding[0].team_tasks_reassigned).toBe(1);
  expect((await access.can(member,'helper.offer_services')).allowed).toBe(true);
 });
 test('concurrent expiry checks commit one offboarding and cannot silently revive expired access',async()=>{
  const business=await workspace();await db.query("UPDATE business_members SET access_valid_until=NOW()-INTERVAL '1 minute' WHERE id=$1",[business.membership.id]);
  await expect(expiry.schedule(business.id,owner,business.membership.id,{expires_at:null,expectedVersion:2})).rejects.toMatchObject({statusCode:409});
  const results=await Promise.all([expiry.expireForUser(member),expiry.expireForUser(member)]);expect(results.reduce((a,b)=>a+b,0)).toBe(1);
  expect((await db.query('SELECT id FROM staff_offboarding_records WHERE membership_id=$1',[business.membership.id])).rows).toHaveLength(1);
  expect((await db.query("SELECT id FROM business_membership_expiry_history WHERE membership_id=$1 AND event='expired'",[business.membership.id])).rows).toHaveLength(1);
 });
 test('expiry lookup failure blocks authenticated operations as retryable, not customer authority',async()=>{
  const business=await workspace(),spy=jest.spyOn(expiry,'expireForUser').mockRejectedValueOnce(Object.assign(new Error('Synthetic unavailable'),{code:'membership_expiry_unavailable'}));
  const response=await require('supertest')(app()).get(`/api/businesses/${business.id}/team/readiness`).set('Authorization',`Bearer ${token(member)}`).expect(503);expect(response.body.retryable).toBe(true);spy.mockRestore();
 });
 test('cleanup failure rolls back membership, reassignment and audit writes together',async()=>{
  const business=await workspace();await team.createTask(business.id,owner,{kind:'task',title:'Rollback fixture',assignee_id:member,due_at:'2030-01-01T00:00:00Z',requestId:crypto.randomUUID()});
  await db.query("UPDATE business_members SET access_valid_until=NOW()-INTERVAL '1 minute' WHERE id=$1",[business.membership.id]);
  const name=`expiry_failure_${crypto.randomUUID().replace(/-/g,'')}`;
  await db.query(`CREATE FUNCTION ${name}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF OLD.business_id=${Number(business.id)} THEN RAISE EXCEPTION 'Synthetic cleanup failure'; END IF;RETURN NEW;END $$`);
  try{
   await db.query(`CREATE TRIGGER ${name} BEFORE UPDATE ON business_team_tasks FOR EACH ROW EXECUTE FUNCTION ${name}()`);
   await expect(expiry.expireForUser(member)).rejects.toMatchObject({statusCode:503,code:'membership_expiry_unavailable'});
   expect((await db.query('SELECT status FROM business_members WHERE id=$1',[business.membership.id])).rows[0].status).toBe('active');
   expect((await db.query('SELECT assignee_id FROM business_team_tasks WHERE business_id=$1',[business.id])).rows[0].assignee_id).toBe(member);
   expect((await db.query("SELECT id FROM business_membership_expiry_history WHERE membership_id=$1 AND event='expired'",[business.membership.id])).rows).toEqual([]);
   expect(await scope.resolveBusinessAccess(member,business.id)).toBeNull();
  }finally{await db.query(`DROP TRIGGER IF EXISTS ${name} ON business_team_tasks`);await db.query(`DROP FUNCTION ${name}()`);}
  expect(await expiry.expireForUser(member)).toBe(1);
 });
});
