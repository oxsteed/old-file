'use strict';
// Group 4 Slice C (166-170): counterparty notifications for the helper-quote
// negotiation flow (169), and validity enforcement on the legacy accept
// path (168). Items 166/167/170 are verified BUILT by survey (see
// persona-roadmap-decisions.md D-162/D-163); this suite proves the two
// partials are closed and that idempotent replays notify nothing twice.
const raw=process.env.ACCESS_TEST_DATABASE_URL;
if(raw){const url=new URL(raw);if(!['127.0.0.1','localhost'].includes(url.hostname)||url.pathname!=='/credit_statement_test')throw new Error('Disposable quote database required');process.env.DATABASE_URL=raw;}
jest.unmock('pg');jest.unmock('../db');jest.unmock('../utils/transaction');
jest.mock('../middleware/auth',()=>({authenticate:(req,res,next)=>{const id=req.get('x-quote-user');if(!id)return res.sendStatus(401);req.user={id,role:'customer'};next();}}));
const crypto=require('crypto');const db=require('../db');const service=require('../services/helperQuoteNegotiation');
const helper=crypto.randomUUID(),customer=crypto.randomUUID(),outsider=crypto.randomUUID();const jobs=[];
const describeDb=raw?describe:describe.skip;
function body(extra={}){return {line_items:[{description:'Labor',type:'labor',quantity:2,unit_price_cents:12500},{description:'Gasket material',type:'material',quantity:1.5,unit_price_cents:1000}],notes:'Repair seal',tax_basis_points:500,valid_days:7,requestId:crypto.randomUUID(),expectedJobRevision:1,...extra};}
async function job(currency='USD'){const {rows:[row]}=await db.query(`INSERT INTO jobs(client_id,title,description,status,currency_code) VALUES($1,'Repair seal','Disposable quote job','published',$2) RETURNING *`,[customer,currency]);jobs.push(row.id);return row;}
async function noticesFor(userId,jobId){return (await db.query(`SELECT type,title,body,data,action_url FROM notifications WHERE user_id=$1 AND type LIKE 'helper_quote%' AND data->>'job_id'=$2 ORDER BY created_at`,[userId,jobId])).rows;}
function app(){const express=require('express');const instance=express();instance.use(express.json());instance.use('/api/helper-quotes',require('../routes/helperQuotes'));instance.use(require('../middleware/errorHandler').errorHandler);return instance;}
async function legacyQuote(target,{expired=false}={}){
 const validUntil=expired?new Date(Date.now()-60000):new Date(Date.now()+7*86400000);
 const {rows:[row]}=await db.query(`INSERT INTO helper_quotes(job_id,helper_id,line_items,tax_rate,subtotal_cents,tax_cents,total_cents,notes,status,valid_until,negotiation_managed)
  VALUES($1,$2,'[{"description":"Labor","quantity":2,"unit_price_cents":12500,"type":"labor"}]'::jsonb,0,25000,0,25000,'Legacy quote','sent',$3,false) RETURNING *`,[target.id,helper,validUntil]);
 return row;
}
describeDb('Group 4 Slice C: quote negotiation notifications and validity',()=>{
 beforeAll(async()=>{
  for(const id of [helper,customer,outsider])await db.query(`INSERT INTO users(id,email,password_hash,first_name,last_name,role,email_verified,is_active,id_verified,terms_accepted,terms_accepted_at,terms_version) VALUES($1,$2,'x','Quote','Fixture','customer',TRUE,TRUE,TRUE,TRUE,NOW(),'quote-test')`,[id,`quote-${id}@example.invalid`]);
  for(const id of [helper,outsider])await db.query(`INSERT INTO access_grants(user_id,capability,subject_type,subject_key,status,provenance,policy_version) VALUES($1,'helper.offer_services','self','self','active','legacy_backfill','helper-policy-1')`,[id]);
 });
 afterAll(async()=>{
  if(jobs.length){
   await db.query('DELETE FROM helper_quote_counters WHERE quote_id IN (SELECT id FROM helper_quotes WHERE job_id=ANY($1::uuid[]))',[jobs]);
   await db.query('DELETE FROM helper_quotes WHERE job_id=ANY($1::uuid[])',[jobs]);
   await db.query('DELETE FROM bids WHERE job_id=ANY($1::uuid[])',[jobs]);
   await db.query('DELETE FROM jobs WHERE id=ANY($1::uuid[])',[jobs]);
  }
  await db.query('DELETE FROM notifications WHERE user_id=ANY($1::uuid[])',[[helper,customer,outsider]]);
  await db.query('DELETE FROM helper_material_templates WHERE helper_id=ANY($1::uuid[])',[[helper,outsider]]);
  await db.query('DELETE FROM access_grants WHERE user_id=ANY($1::uuid[])',[[helper,outsider]]);
  await db.end();
 });
 test('quote create notifies the job owner (169)',async()=>{
  const target=await job();const first=await service.create(target.id,helper,body());
  const rows=await noticesFor(customer,target.id);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({type:'helper_quote_received',action_url:`/jobs/${target.id}`});
  expect(rows[0].title).toBeTruthy();expect(rows[0].body).toBeTruthy();
  expect(rows[0].data).toMatchObject({job_id:target.id,quote_id:first.id,total_cents:27825});
 });
 test('quote revise notifies the owner once; an idempotent replay notifies nothing new (169)',async()=>{
  const target=await job();const first=await service.create(target.id,helper,body());
  const input=body({expectedVersion:1,notes:'Revised scope'});
  const revised=await service.revise(first.id,helper,input);expect(revised.version).toBe(2);
  const again=await service.revise(first.id,helper,input);expect(again.id).toBe(revised.id);
  const rows=await noticesFor(customer,target.id);
  expect(rows.filter(row=>row.type==='helper_quote_received')).toHaveLength(1);
  expect(rows.filter(row=>row.type==='helper_quote_revised')).toHaveLength(1);
  expect(rows.find(row=>row.type==='helper_quote_revised').data).toMatchObject({quote_id:revised.id});
 });
 test('counterproposal notifies the helper; an idempotent replay notifies nothing new (169)',async()=>{
  const target=await job();const first=await service.create(target.id,helper,body());
  const input=body({expectedVersion:1,notes:'Customer revised scope',tax_basis_points:0});
  const proposed=await service.counter(first.id,customer,input);
  const replay=await service.counter(first.id,customer,input);expect(replay.id).toBe(proposed.id);
  const rows=await noticesFor(helper,target.id);
  expect(rows.filter(row=>row.type==='helper_quote_counter_proposed')).toHaveLength(1);
  expect(rows[0]).toMatchObject({type:'helper_quote_counter_proposed',action_url:`/jobs/${target.id}`});
  expect(rows[0].data).toMatchObject({quote_id:first.id,counter_id:proposed.id});
 });
 test('counter decision notifies the customer on accept and on decline (169)',async()=>{
  const acceptedJob=await job();const acceptedFirst=await service.create(acceptedJob.id,helper,body());
  const acceptedCounter=await service.counter(acceptedFirst.id,customer,body({expectedVersion:1,tax_basis_points:0}));
  const accepted=await service.counterRespond(acceptedCounter.id,helper,{status:'accepted',expectedVersion:1});
  expect(accepted.quote).toMatchObject({version:2,status:'sent'});
  const acceptedRows=await noticesFor(customer,acceptedJob.id);
  expect(acceptedRows.filter(row=>row.type==='helper_quote_counter_accepted')).toHaveLength(1);
  expect(acceptedRows.find(row=>row.type==='helper_quote_counter_accepted').data).toMatchObject({counter_id:acceptedCounter.id,quote_id:accepted.quote.id});
  const declinedJob=await job();const declinedFirst=await service.create(declinedJob.id,helper,body());
  const declinedCounter=await service.counter(declinedFirst.id,customer,body({expectedVersion:1,tax_basis_points:0}));
  await service.counterRespond(declinedCounter.id,helper,{status:'declined',expectedVersion:1});
  const declinedRows=await noticesFor(customer,declinedJob.id);
  expect(declinedRows.filter(row=>row.type==='helper_quote_counter_declined')).toHaveLength(1);
  expect((await db.query('SELECT status FROM helper_quotes WHERE id=$1',[declinedFirst.id])).rows[0].status).toBe('sent');
 });
 test('respond notifies the helper on accept (with bid) and on decline (169)',async()=>{
  const acceptedJob=await job();const acceptedFirst=await service.create(acceptedJob.id,helper,body());
  const accepted=await service.respond(acceptedFirst.id,customer,{status:'accepted',expectedVersion:1});
  expect(accepted.bid_id).toBeTruthy();
  const acceptedRows=await noticesFor(helper,acceptedJob.id);
  expect(acceptedRows.filter(row=>row.type==='helper_quote_accepted')).toHaveLength(1);
  expect(acceptedRows.find(row=>row.type==='helper_quote_accepted').data).toMatchObject({quote_id:acceptedFirst.id,bid_id:accepted.bid_id});
  const declinedJob=await job();const declinedFirst=await service.create(declinedJob.id,helper,body());
  await service.respond(declinedFirst.id,customer,{status:'declined',expectedVersion:1});
  const declinedRows=await noticesFor(helper,declinedJob.id);
  expect(declinedRows.filter(row=>row.type==='helper_quote_declined')).toHaveLength(1);
  expect((await db.query('SELECT COUNT(*)::int AS n FROM bids WHERE job_id=$1',[declinedJob.id])).rows[0].n).toBe(0);
 });
 test('legacy endpoint refuses an expired non-negotiation quote and accepts a live one (168)',async()=>{
  const target=await job();const stale=await legacyQuote(target,{expired:true});
  const refused=await require('supertest')(app()).patch(`/api/helper-quotes/${stale.id}/status`).set('x-quote-user',customer).send({status:'accepted'});
  expect(refused.status).toBe(409);expect(refused.body.code).toBe('quote_expired');
  expect((await db.query('SELECT COUNT(*)::int AS n FROM bids WHERE job_id=$1',[target.id])).rows[0].n).toBe(0);
  const live=await legacyQuote(target);
  const accepted=await require('supertest')(app()).patch(`/api/helper-quotes/${live.id}/status`).set('x-quote-user',customer).send({status:'accepted'});
  expect(accepted.status).toBe(200);expect(accepted.body.bid_id).toBeTruthy();
  const {rows:[bid]}=await db.query('SELECT amount_cents,status FROM bids WHERE id=$1',[accepted.body.bid_id]);
  expect(bid).toMatchObject({amount_cents:25000,status:'pending'});
 });
});
