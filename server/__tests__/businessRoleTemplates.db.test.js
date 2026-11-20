'use strict';
const raw=process.env.ACCESS_TEST_DATABASE_URL;
if(raw){const url=new URL(raw);if(!['127.0.0.1','localhost'].includes(url.hostname)||url.pathname!=='/credit_statement_test')throw new Error('Disposable role database required');process.env.DATABASE_URL=raw;}
jest.unmock('pg');jest.unmock('../db');jest.unmock('../utils/transaction');
jest.mock('../middleware/auth',()=>({authenticate:(req,res,next)=>{const id=req.get('x-role-user');if(!id)return res.sendStatus(401);req.user={id};next();}}));
const crypto=require('crypto'),db=require('../db'),service=require('../services/businessRoleTemplates'),permissions=require('../services/permissionsService'),access=require('../services/access/accessService');
const owner=crypto.randomUUID(),member=crypto.randomUUID(),outsider=crypto.randomUUID();let businessId,otherBusiness,memberId,otherMember;
const describeDb=raw?describe:describe.skip;
const body=extra=>({name:'Booking coordinator',role:'representative',overrides:[{permission_code:'invoices.view',effect:'deny'}],...extra});
function app(){const express=require('express'),instance=express();instance.use(express.json());instance.use('/api/businesses',require('../routes/businessTeam'));instance.use(require('../middleware/errorHandler').errorHandler);return instance;}
describeDb('owner-controlled role templates and permission previews',()=>{
 beforeAll(async()=>{
  for(const id of [owner,member,outsider])await db.query(`INSERT INTO users(id,email,password_hash,first_name,last_name,role,email_verified,is_active,id_verified,terms_accepted,terms_accepted_at,terms_version) VALUES($1,$2,'x','Role','Fixture','customer',TRUE,TRUE,TRUE,TRUE,NOW(),'role-test')`,[id,`role-${id}@example.invalid`]);
  businessId=(await db.query("INSERT INTO businesses(user_id,business_name,is_primary,is_active,is_listed) VALUES($1,'Role templates',FALSE,TRUE,FALSE) RETURNING id",[owner])).rows[0].id;
  otherBusiness=(await db.query("INSERT INTO businesses(user_id,business_name,is_primary,is_active,is_listed) VALUES($1,'Independent scope',FALSE,TRUE,FALSE) RETURNING id",[outsider])).rows[0].id;
  for(const id of [businessId,otherBusiness]){
   const row=(await db.query("INSERT INTO business_members(business_id,owner_id,member_id,invite_email,role,status) VALUES($1,$2,$3,$4,'employee','active') RETURNING id",[id,id===businessId?owner:outsider,member,`role-${member}@example.invalid`])).rows[0];if(id===businessId)memberId=row.id;else otherMember=row.id;
  }
  await db.query("INSERT INTO access_grants(user_id,capability,subject_type,subject_key,status,provenance,policy_version) VALUES($1,'helper.offer_services','self','self','active','legacy_backfill','helper-policy-1')",[member]);
 });
 afterAll(async()=>{await db.query('DELETE FROM businesses WHERE id=ANY($1::int[])',[[businessId,otherBusiness]]);await db.query('DELETE FROM access_grants WHERE user_id=$1',[member]);permissions.invalidateCache(businessId);permissions.invalidateCache(otherBusiness);await db.end();});
 test('templates are descriptive until an owner explicitly applies; preview uses actual defaults',async()=>{
  const template=await service.save(businessId,owner,body());
  const preview=await service.preview(businessId,owner,template.id,memberId);expect(preview.after_role).toBe('representative');expect(preview.after).not.toContain('invoices.view');expect(preview.confirmation).toMatch(/^[a-f0-9]{64}$/);
  expect((await db.query('SELECT role FROM business_members WHERE id=$1',[memberId])).rows[0].role).toBe('employee');
  await expect(service.apply(businessId,owner,template.id,{membership_id:memberId,confirmation:preview.confirmation,reason:'Confirmed by owner',confirm:false})).rejects.toMatchObject({statusCode:400});
  await expect(service.apply(businessId,member,template.id,{membership_id:memberId,confirmation:preview.confirmation,reason:'Escalate',confirm:true})).rejects.toMatchObject({statusCode:404});
  await service.apply(businessId,owner,template.id,{membership_id:memberId,confirmation:preview.confirmation,reason:'Assign booking coordination',confirm:true});
  const result=await permissions.getEffectivePermissions({businessId,userId:member,role:'representative',membershipId:memberId});expect(result.permissions.has('invoices.view')).toBe(false);
  expect((await db.query('SELECT role FROM business_members WHERE id=$1',[otherMember])).rows[0].role).toBe('employee');
  expect((await access.can(member,'helper.offer_services')).allowed).toBe(true);
  const history=(await service.list(businessId,owner)).history;expect(history[0]).toMatchObject({template_name:'Booking coordinator',reason:'Assign booking coordination'});
 });
 test('template and membership changes invalidate a prior confirmation, including override edits',async()=>{
  const template=await service.save(businessId,owner,body({name:'Limited employee',role:'employee'}));
  let preview=await service.preview(businessId,owner,template.id,memberId);
  await service.save(businessId,owner,body({name:'Limited employee',role:'employee',expectedVersion:1}),template.id);
  await expect(service.apply(businessId,owner,template.id,{membership_id:memberId,confirmation:preview.confirmation,reason:'Stale template',confirm:true})).rejects.toMatchObject({statusCode:409});
  preview=await service.preview(businessId,owner,template.id,memberId);
  await db.query("UPDATE membership_permission_overrides SET reason='Updated outside templates' WHERE membership_id=$1",[memberId]);
  await expect(service.apply(businessId,owner,template.id,{membership_id:memberId,confirmation:preview.confirmation,reason:'Stale member',confirm:true})).rejects.toMatchObject({statusCode:409});
  await expect(service.save(businessId,owner,body({expectedVersion:1}),template.id)).rejects.toMatchObject({statusCode:409});
 });
 test('simultaneous confirmations apply once and preserve both before/after audit states',async()=>{
  const template=await service.save(businessId,owner,body({name:'Support desk',role:'support_agent'})),preview=await service.preview(businessId,owner,template.id,memberId);
  const input={membership_id:memberId,confirmation:preview.confirmation,reason:'Assign support desk',confirm:true};
  const result=await Promise.allSettled([service.apply(businessId,owner,template.id,input),service.apply(businessId,owner,template.id,input)]);
  expect(result.filter(row=>row.status==='fulfilled')).toHaveLength(1);expect(result.find(row=>row.status==='rejected').reason.statusCode).toBe(409);
  const {rows:[history]}=await db.query("SELECT before_state,after_state FROM business_role_template_history WHERE business_id=$1 AND reason='Assign support desk'",[businessId]);expect(history.after_state.role).toBe('support_agent');expect(Array.isArray(history.before_state.permissions)).toBe(true);
 });
 test('foreign scopes, revoked members, unknown permissions and owner self-edit cannot be applied',async()=>{
  const template=await service.save(businessId,owner,body({name:'Another preset'}));
  await expect(service.preview(otherBusiness,outsider,template.id,otherMember)).rejects.toMatchObject({statusCode:404});
  await expect(service.preview(businessId,owner,template.id,otherMember)).rejects.toMatchObject({statusCode:404});
  await expect(service.save(businessId,owner,body({overrides:[{permission_code:'invented.authority',effect:'allow'}]}))).rejects.toMatchObject({statusCode:400});
  await db.query("UPDATE business_members SET status='revoked' WHERE id=$1",[memberId]);
  await expect(service.preview(businessId,owner,template.id,memberId)).rejects.toMatchObject({statusCode:404});
  await db.query("UPDATE business_members SET status='active' WHERE id=$1",[memberId]);
  await expect(service.remove(otherBusiness,outsider,template.id,1)).rejects.toMatchObject({statusCode:409});
  await service.remove(businessId,owner,template.id,1);
 });
 test('HTTP routes require authentication, current ownership and uncached data',async()=>{
  const request=require('supertest');await request(app()).get(`/api/businesses/${businessId}/team/role-templates`).expect(401);
  await request(app()).get(`/api/businesses/${businessId}/team/role-templates`).set('x-role-user',member).expect(404);
  const result=await request(app()).get(`/api/businesses/${businessId}/team/role-templates`).set('x-role-user',owner).expect(200);expect(result.headers['cache-control']).toBe('no-store');
 });
});
