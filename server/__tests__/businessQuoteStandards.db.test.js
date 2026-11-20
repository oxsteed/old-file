'use strict';
const raw=process.env.ACCESS_TEST_DATABASE_URL;
if(raw){const url=new URL(raw);if(!['127.0.0.1','localhost'].includes(url.hostname)||url.pathname!=='/credit_statement_test')throw new Error('Disposable business database required');process.env.DATABASE_URL=raw;}
jest.unmock('pg');jest.unmock('../db');jest.unmock('../utils/transaction');
jest.mock('../middleware/auth',()=>{const authenticate=(req,res,next)=>{const id=req.get('x-business-user');if(!id)return res.sendStatus(401);req.user={id};next();};return{authenticate,requireAuth:authenticate};});
const crypto=require('crypto'),db=require('../db'),standards=require('../services/businessQuoteStandards'),permissions=require('../services/permissionsService');
const owner=crypto.randomUUID(),reader=crypto.randomUUID(),outsider=crypto.randomUUID();let businessId,otherBusiness,memberId;
const describeDb=raw?describe:describe.skip;
function app(){const express=require('express'),instance=express();instance.use(express.json());instance.use('/api/businesses',require('../routes/businessFinance'));instance.use('/api/businesses',require('../routes/businessLeads'));instance.use(require('../middleware/errorHandler').errorHandler);return instance;}
const template=(extra={})=>({name:'Standard repair',line_items:[{description:'Labor',quantity:2.5,unit_price_cents:6000}],tax_rate:5,terms:'Clean work area after service',...extra});
describeDb('business quote terms and scoped pricing templates',()=>{
 beforeAll(async()=>{
  for(const id of [owner,reader,outsider])await db.query(`INSERT INTO users(id,email,password_hash,first_name,last_name,role,email_verified,is_active) VALUES($1,$2,'x','Business','Fixture','customer',TRUE,TRUE)`,[id,`standards-${id}@example.invalid`]);
  businessId=(await db.query(`INSERT INTO businesses(user_id,business_name,is_primary,is_active,is_listed) VALUES($1,'Standards test',FALSE,TRUE,FALSE) RETURNING id`,[owner])).rows[0].id;
  otherBusiness=(await db.query(`INSERT INTO businesses(user_id,business_name,is_primary,is_active,is_listed) VALUES($1,'Other business',FALSE,TRUE,FALSE) RETURNING id`,[outsider])).rows[0].id;
  memberId=(await db.query(`INSERT INTO business_members(business_id,owner_id,member_id,invite_email,role,status) VALUES($1,$2,$3,$4,'employee','active') RETURNING id`,[businessId,owner,reader,`standards-${reader}@example.invalid`])).rows[0].id;
  await db.query(`INSERT INTO membership_permission_overrides(membership_id,permission_id,effect,reason) SELECT $1,id,'allow','Read-only accountant' FROM team_permissions WHERE code='invoices.view'`,[memberId]);
 });
 afterAll(async()=>{await db.query('DELETE FROM business_quotes WHERE business_id=ANY($1::int[])',[[businessId,otherBusiness]]);await db.query('DELETE FROM business_leads WHERE business_id=ANY($1::int[])',[[businessId,otherBusiness]]);await db.query('DELETE FROM businesses WHERE id=ANY($1::int[])',[[businessId,otherBusiness]]);permissions.invalidateCache(businessId);await db.end();});
 test('business permission guards distinguish reader, writer, foreign scopes and revoked memberships',async()=>{
  const request=require('supertest');await request(app()).get(`/api/businesses/${businessId}/quote-standards`).expect(401);
  await request(app()).get(`/api/businesses/${businessId}/quote-standards`).set('x-business-user',outsider).expect(404);
  const own=await request(app()).get(`/api/businesses/${businessId}/quote-standards`).set('x-business-user',owner).expect(200);expect(own.headers['cache-control']).toBe('no-store');
  await request(app()).get(`/api/businesses/${businessId}/quote-standards`).set('x-business-user',reader).expect(200);
  await request(app()).put(`/api/businesses/${businessId}/quote-standards`).set('x-business-user',reader).send({terms:'Escalate',expectedVersion:1}).expect(403);
  await db.query("UPDATE business_members SET status='revoked' WHERE id=$1",[memberId]);
  await request(app()).get(`/api/businesses/${businessId}/quote-standards`).set('x-business-user',reader).expect(404);
 });
 test('standard terms use CAS and apply to every new quote without rewriting prior snapshots',async()=>{
  expect((await standards.read(businessId)).defaults).toMatchObject({terms:'',version:1});
  await standards.save(businessId,{terms:'Terms A',expectedVersion:1});
  await expect(standards.save(businessId,{terms:'Lost update',expectedVersion:1})).rejects.toMatchObject({statusCode:409});
  const first=(await db.query(`INSERT INTO business_quotes(business_id,client_name,title,line_items,subtotal_cents,total_cents,status) VALUES($1,'Client','Chat path quote','[]',100,100,'sent') RETURNING *`,[businessId])).rows[0];expect(first.standard_terms).toBe('Terms A');
  await standards.save(businessId,{terms:'Terms B',expectedVersion:2});
  expect((await db.query('SELECT standard_terms FROM business_quotes WHERE id=$1',[first.id])).rows[0].standard_terms).toBe('Terms A');
  await expect(db.query('UPDATE business_quotes SET standard_terms=$2 WHERE id=$1',[first.id,'Changed after sending'])).rejects.toMatchObject({constraint:'business_quote_terms_locked'});
  const lead=(await db.query(`INSERT INTO business_leads(business_id,customer_id,description) VALUES($1,$2,'Lead') RETURNING id`,[businessId,reader])).rows[0];
  const leadQuote=(await db.query(`INSERT INTO lead_quotes(lead_id,business_id,description,amount) VALUES($1,$2,'Lead quote',1) RETURNING *`,[lead.id,businessId])).rows[0];expect(leadQuote.standard_terms).toBe('Terms B');
  const created=await require('supertest')(app()).post(`/api/businesses/${businessId}/leads/${lead.id}/quotes`).set('x-business-user',owner).send({amount_cents:15000,description:'Scoped lead quote',valid_until:'2030-12-31'}).expect(201);
  expect(created.body).toMatchObject({business_id:businessId,amount:'150.00',standard_terms:'Terms B'});
 });
 test('templates preserve cents/quantity and isolate updates and deletions by business and version',async()=>{
  const first=await standards.saveTemplate(businessId,template());expect(first.line_items[0]).toMatchObject({quantity:2.5,unit_price_cents:6000,unit_price:60});
  expect((await standards.read(otherBusiness)).templates).toEqual([]);
  await expect(standards.saveTemplate(otherBusiness,template({expectedVersion:1}),first.id)).rejects.toMatchObject({statusCode:409});
  const updated=await standards.saveTemplate(businessId,template({name:'Revised repair',expectedVersion:1}),first.id);expect(updated.version).toBe(2);
  await expect(standards.saveTemplate(businessId,template({expectedVersion:1}),first.id)).rejects.toMatchObject({statusCode:409});
  await expect(standards.remove(otherBusiness,first.id,2)).rejects.toMatchObject({statusCode:409});
  await expect(standards.remove(businessId,first.id,1)).rejects.toMatchObject({statusCode:409});
  await standards.remove(businessId,first.id,2);expect((await standards.read(businessId)).templates).toEqual([]);
 });
 test('public handoff shows frozen terms, requires sending and records a single customer decision',async()=>{
  const request=require('supertest'),client=request(app());
  const created=await client.post(`/api/businesses/${businessId}/quotes`).set('x-business-user',owner).send({client_name:'Customer',title:'Repair quote',line_items:template().line_items,tax_rate:5,valid_until:'2030-12-31',standard_terms:'Reviewed custom terms'}).expect(201);
  const quote=created.body;expect(quote.total_cents).toBe(15750);expect(quote.standard_terms).toBe('Reviewed custom terms');
  await client.get(`/api/businesses/quotes/view/${quote.token}`).expect(404);
  await client.post(`/api/businesses/${businessId}/quotes/${quote.id}/send`).set('x-business-user',owner).send({}).expect(200);
  const shared=await client.get(`/api/businesses/quotes/view/${quote.token}`).expect(200);expect(shared.body.standard_terms).toBe('Reviewed custom terms');expect(shared.headers['cache-control']).toBe('no-store');expect(shared.body).not.toHaveProperty('client_email');
  await client.put(`/api/businesses/${businessId}/quotes/${quote.id}`).set('x-business-user',owner).send({standard_terms:'Secret replacement'}).expect(409);
  const accepted=await client.post(`/api/businesses/quotes/view/${quote.token}/respond`).send({response:'approved'}).expect(200);expect(accepted.body.standard_terms).toBe('Reviewed custom terms');
  await client.post(`/api/businesses/quotes/view/${quote.token}/respond`).send({response:'declined'}).expect(404);
 });
 test('invalid terms and price templates cannot be persisted',async()=>{
  await expect(standards.save(businessId,{terms:'x'.repeat(4001),expectedVersion:3})).rejects.toMatchObject({statusCode:400});
  await expect(standards.saveTemplate(businessId,template({line_items:[{description:'Bad',quantity:-1,unit_price_cents:10}]}))).rejects.toMatchObject({statusCode:400});
  await expect(standards.saveTemplate(businessId,template({tax_rate:101}))).rejects.toMatchObject({statusCode:400});
 });
});
