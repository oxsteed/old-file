'use strict';
const raw=process.env.ACCESS_TEST_DATABASE_URL;
if(raw){const url=new URL(raw);if(!['127.0.0.1','localhost'].includes(url.hostname)||url.pathname!=='/credit_statement_test')throw new Error('Disposable quote database required');process.env.DATABASE_URL=raw;}
jest.unmock('pg');jest.unmock('../db');jest.unmock('../utils/transaction');
jest.mock('../middleware/auth',()=>({authenticate:(req,res,next)=>{const id=req.get('x-quote-user');if(!id)return res.sendStatus(401);req.user={id,role:'customer'};next();}}));
const crypto=require('crypto');const db=require('../db');const service=require('../services/helperQuoteNegotiation');
const helper=crypto.randomUUID(),customer=crypto.randomUUID(),outsider=crypto.randomUUID();const jobs=[];
const describeDb=raw?describe:describe.skip;
function body(extra={}){return {line_items:[{description:'Labor',type:'labor',quantity:2,unit_price_cents:12500},{description:'Gasket material',type:'material',quantity:1.5,unit_price_cents:1000}],notes:'Repair seal',tax_basis_points:500,valid_days:7,requestId:crypto.randomUUID(),expectedJobRevision:1,...extra};}
async function job(currency='USD'){const {rows:[row]}=await db.query(`INSERT INTO jobs(client_id,title,description,status,currency_code) VALUES($1,'Repair seal','Disposable quote job','published',$2) RETURNING *`,[customer,currency]);jobs.push(row.id);return row;}
function app(){const express=require('express');const instance=express();instance.use(express.json());instance.use('/api/helper-quotes',require('../routes/helperQuotes'));instance.use(require('../middleware/errorHandler').errorHandler);return instance;}
describeDb('itemized helper quote lifecycle',()=>{
 beforeAll(async()=>{
  for(const id of [helper,customer,outsider])await db.query(`INSERT INTO users(id,email,password_hash,first_name,last_name,role,email_verified,is_active,id_verified,terms_accepted,terms_accepted_at,terms_version) VALUES($1,$2,'x','Quote','Fixture','customer',TRUE,TRUE,TRUE,TRUE,NOW(),'quote-test')`,[id,`quote-${id}@example.invalid`]);
  for(const id of [helper,outsider])await db.query(`INSERT INTO access_grants(user_id,capability,subject_type,subject_key,status,provenance,policy_version) VALUES($1,'helper.offer_services','self','self','active','legacy_backfill','helper-policy-1')`,[id]);
 });
 afterAll(async()=>{if(jobs.length)await db.query('DELETE FROM jobs WHERE id=ANY($1::uuid[])',[jobs]);await db.query('DELETE FROM helper_material_templates WHERE helper_id=ANY($1::uuid[])',[[helper,outsider]]);await db.query('DELETE FROM access_grants WHERE user_id=ANY($1::uuid[])',[[helper,outsider]]);await db.end();});
 test('server totals and quote submission retries are exact',async()=>{
  const target=await job(),input=body();const first=await service.create(target.id,helper,input);
  expect(first).toMatchObject({subtotal_cents:26500,tax_cents:1325,total_cents:27825,version:1,status:'sent'});
  expect((await service.create(target.id,helper,input)).id).toBe(first.id);
  await expect(service.create(target.id,helper,{...input,notes:'changed'})).rejects.toMatchObject({code:'idempotency_conflict'});
  expect((await service.list(target.id,customer)).quotes).toHaveLength(1);
  expect((await service.list(target.id,outsider)).quotes).toHaveLength(0);
 });
 test('validation rejects fractional minor units, overflow, invalid expiry and self-quotes',async()=>{
  const target=await job();
  await expect(service.create(target.id,helper,body({valid_days:0}))).rejects.toMatchObject({statusCode:400});
  await expect(service.create(target.id,helper,body({line_items:[{description:'Invalid',type:'labor',quantity:1,unit_price_cents:0.1}]}))).rejects.toMatchObject({statusCode:400});
  await expect(service.create(target.id,helper,body({line_items:[{description:'Overflow',type:'labor',quantity:10000,unit_price_cents:100000000}]}))).rejects.toMatchObject({statusCode:400});
  await expect(service.create(target.id,customer,body())).rejects.toMatchObject({code:'own_job_quote'});
 });
 test('customer counterproposal requires helper agreement then explicit customer acceptance',async()=>{
  const target=await job();const first=await service.create(target.id,helper,body());
  await expect(service.counter(first.id,helper,body({expectedVersion:1}))).rejects.toMatchObject({statusCode:403});
  const input=body({expectedVersion:1,notes:'Customer revised scope',tax_basis_points:0});
  const proposed=await service.counter(first.id,customer,input);
  expect((await service.counter(first.id,customer,input)).id).toBe(proposed.id);
  const result=await service.counterRespond(proposed.id,helper,{status:'accepted',expectedVersion:1});
  expect(result.quote).toMatchObject({version:2,status:'sent',parent_quote_id:first.id,total_cents:26500});
  expect((await db.query('SELECT id FROM bids WHERE job_id=$1',[target.id])).rows).toHaveLength(0);
  await expect(service.respond(first.id,customer,{status:'accepted',expectedVersion:1})).rejects.toMatchObject({statusCode:409});
  const accepted=await service.respond(result.quote.id,customer,{status:'accepted',expectedVersion:2});
  expect(accepted.bid_id).toBeTruthy();
  expect((await service.respond(result.quote.id,customer,{status:'accepted',expectedVersion:2})).bid_id).toBe(accepted.bid_id);
  const {rows:[bid]}=await db.query('SELECT amount_cents,currency_code,status FROM bids WHERE id=$1',[accepted.bid_id]);
  expect(bid).toMatchObject({amount_cents:26500,currency_code:'USD',status:'pending'});
  await expect(service.revise(result.quote.id,helper,body({expectedVersion:2}))).rejects.toMatchObject({code:'quote_locked'});
 });
 test('simultaneous revisions preserve one current version and immutable original terms',async()=>{
  const target=await job();const first=await service.create(target.id,helper,body());
  const attempts=await Promise.allSettled([service.revise(first.id,helper,body({expectedVersion:1,notes:'Version A'})),service.revise(first.id,helper,body({expectedVersion:1,notes:'Version B'}))]);
  expect(attempts.filter(row=>row.status==='fulfilled')).toHaveLength(1);
  const history=await service.list(target.id,customer);
  expect(history.quotes).toHaveLength(2);
  expect(history.quotes.filter(row=>!row.superseded_at)).toHaveLength(1);
  expect(history.quotes.find(row=>row.id===first.id).notes).toBe('Repair seal');
 });
 test('expired quotes cannot be accepted through the legacy endpoint, but can be renewed as new versions',async()=>{
  const target=await job();const first=await service.create(target.id,helper,body());
  await db.query("UPDATE helper_quotes SET valid_until=NOW()-INTERVAL '1 minute' WHERE id=$1",[first.id]);
  const response=await require('supertest')(app()).patch(`/api/helper-quotes/${first.id}/status`).set('x-quote-user',customer).send({status:'accepted',expectedVersion:1});
  expect(response.status).toBe(409);expect(response.body.code).toBe('quote_expired');
  expect((await db.query('SELECT status FROM helper_quotes WHERE id=$1',[first.id])).rows[0].status).toBe('sent');
  const renewed=await service.revise(first.id,helper,body({expectedVersion:1}));expect(renewed.version).toBe(2);
 });
 test('job edits invalidate old terms; provider can issue a freshly reviewed revision',async()=>{
  const target=await job();const first=await service.create(target.id,helper,body());
  await db.query("UPDATE jobs SET title='Revised scope',revision=revision+1 WHERE id=$1",[target.id]);
  await expect(service.respond(first.id,customer,{status:'accepted',expectedVersion:1})).rejects.toMatchObject({code:'job_revision_changed'});
  const {rows:[current]}=await db.query('SELECT revision FROM jobs WHERE id=$1',[target.id]);
  const fresh=await service.revise(first.id,helper,body({expectedVersion:1,expectedJobRevision:current.revision}));
  expect(fresh.job_revision).toBe(current.revision);
 });
 test('currency exponents and the current job revision survive quote-to-bid conversion',async()=>{
  for(const currency of ['JPY','KWD']){
   const target=await job(currency);
   const first=await service.create(target.id,helper,body({tax_basis_points:0,line_items:[{description:'Work',type:'labor',quantity:1,unit_price_cents:12345}]}));
   const accepted=await service.respond(first.id,customer,{status:'accepted',expectedVersion:1});
   const {rows:[bid]}=await db.query('SELECT amount,amount_cents,currency_code,job_revision FROM bids WHERE id=$1',[accepted.bid_id]);
   expect(bid.currency_code).toBe(currency);expect(bid.amount_cents).toBe(12345);expect(Number(bid.amount)).toBe(currency==='JPY'?12345:12.345);expect(bid.job_revision).toBe(1);
  }
 });
 test('materials templates support scoped editing and reject stale overwrites',async()=>{
  const template=await service.templateCreate(helper,{...body(),name:'Repair kit',currency_code:'USD'});
  expect((await service.templates(outsider))).toEqual([]);
  await expect(service.templateUpdate(outsider,template.id,{...body(),name:'Forged',currency_code:'USD',expectedVersion:1})).rejects.toMatchObject({statusCode:409});
  const updated=await service.templateUpdate(helper,template.id,{...body(),name:'Updated kit',currency_code:'USD',expectedVersion:1});expect(updated.version).toBe(2);
  await expect(service.templateUpdate(helper,template.id,{...body(),name:'Stale',currency_code:'USD',expectedVersion:1})).rejects.toMatchObject({code:'template_version_conflict'});
  await service.templateDelete(helper,template.id);
 });
 test('a revoked provider cannot issue quotes or have old terms accepted; unrelated access survives',async()=>{
  const target=await job();const first=await service.create(target.id,helper,body());
  await db.query("UPDATE access_grants SET status='revoked' WHERE user_id=$1",[helper]);
  await expect(service.create((await job()).id,helper,body())).rejects.toMatchObject({statusCode:403});
  await expect(service.respond(first.id,customer,{status:'accepted',expectedVersion:1})).rejects.toMatchObject({statusCode:403});
  const request=require('supertest');
  await request(app()).get(`/api/helper-quotes/negotiations/jobs/${target.id}`).set('x-quote-user',helper).expect(403);
  await request(app()).get(`/api/helper-quotes/negotiations/jobs/${target.id}`).expect(401);
  const own=await service.create((await job()).id,outsider,body());expect(own.status).toBe('sent');
 });
});
