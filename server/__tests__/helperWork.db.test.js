'use strict';
// Opt-in, disposable database only. Uses the real resolver and transactions.
const raw = process.env.ACCESS_TEST_DATABASE_URL;
if (raw) {
  const parsed = new URL(raw);
  if (!['127.0.0.1','localhost'].includes(parsed.hostname) || parsed.pathname !== '/credit_statement_test') throw new Error('Disposable helper work database required');
  process.env.DATABASE_URL = raw;
}
jest.mock('../middleware/auth',()=>({authenticate:(req,res,next)=>{const id=req.get('x-work-user');if(!id)return res.sendStatus(401);req.user={id};next();}}));
jest.unmock('pg');
jest.unmock('../db');
jest.unmock('../utils/transaction');
const crypto = require('crypto');
const pool = require('../db');
const work = require('../services/helperWorkService');
const access = require('../services/access/accessService');
const describeDb = raw ? describe : describe.skip;
const helper = crypto.randomUUID(), client = crypto.randomUUID(), other = crypto.randomUUID();
let jobId;
const draft = (version=0) => ({ expectedVersion:version,checklist:[{label:'Check water supply',done:false}],private_notes:'Private gate code',handover:'Replaced gasket',aftercare:'Wait one hour before use' });
describeDb('helper work execution and isolation',()=>{
 beforeAll(async()=>{
  for(const id of [helper,client,other]) {
   await pool.query(`INSERT INTO users(id,email,password_hash,first_name,last_name,role,is_active,email_verified,id_verified,terms_accepted,terms_accepted_at,terms_version)
    VALUES($1,$2,'x','Work','Fixture','customer',TRUE,TRUE,TRUE,TRUE,NOW(),'work-test')`,[id,`work-${id}@example.invalid`]);
  }
  for(const id of [helper,other]) await pool.query(`INSERT INTO access_grants(user_id,capability,subject_type,subject_key,status,provenance,policy_version)
    VALUES($1,'helper.offer_services','self','self','active','legacy_backfill','helper-policy-1')`,[id]);
  const {rows:[job]}=await pool.query(`INSERT INTO jobs(client_id,assigned_helper_id,title,description,status) VALUES($1,$2,'Gasket repair','Fixture job','accepted') RETURNING id`,[client,helper]);
  jobId=job.id;
 });
 afterAll(async()=>{
  if(jobId) await pool.query('DELETE FROM jobs WHERE id=$1',[jobId]);
  await pool.query('DELETE FROM access_grants WHERE user_id=ANY($1::uuid[])',[[helper,client,other]]);
  // The disposable database owns synthetic account cleanup. Account deletion
  // has domain-level Credit integrity triggers unrelated to this suite.
  await pool.end();
 });
 test('only the assigned helper can write; customer sees public fields only',async()=>{
  await expect(work.save(jobId,client,draft())).rejects.toMatchObject({statusCode:404});
  await expect(work.save(jobId,other,draft())).rejects.toMatchObject({statusCode:404});
  expect(await work.save(jobId,helper,draft())).toEqual({version:1});
  const customer=await work.read(jobId,client);
  expect(customer.work).toEqual({version:1,handover:'Replaced gasket',aftercare:'Wait one hour before use'});
  expect(JSON.stringify(customer)).not.toContain('Private gate code');
  expect(customer.writable).toBe(false);
  expect((await work.read(jobId,helper)).work.private_notes).toBe('Private gate code');
 });
 test('concurrent saves never silently overwrite one another',async()=>{
  const attempts=await Promise.allSettled([work.save(jobId,helper,draft(1)),work.save(jobId,helper,{...draft(1),private_notes:'Other device'})]);
  expect(attempts.filter(result=>result.status==='fulfilled')).toHaveLength(1);
  expect(attempts.find(result=>result.status==='rejected').reason).toMatchObject({code:'work_version_conflict'});
 });
 test('progress is customer visible, retry-safe, and cannot reuse a key for different content',async()=>{
  const body={body:'Arrived with replacement parts',requestId:crypto.randomUUID()};
  const first=await work.publish(jobId,helper,body);
  expect((await work.publish(jobId,helper,body)).id).toBe(first.id);
  expect((await work.read(jobId,client)).updates).toHaveLength(1);
  await expect(work.publish(jobId,helper,{...body,body:'Changed content'})).rejects.toMatchObject({code:'idempotency_conflict'});
 });
 test('templates belong to the helper and reset completion',async()=>{
  const template=await work.createTemplate(helper,{name:'Plumbing',items:[{label:'Bring gasket',done:true}]});
  expect(template.items[0].done).toBe(false);
  expect(await work.templates(other)).toEqual([]);
  await expect(work.removeTemplate(other,template.id)).rejects.toMatchObject({statusCode:404});
  await work.removeTemplate(helper,template.id);
  expect(await work.templates(helper)).toEqual([]);
 });
 test('HTTP reads are private and unauthenticated requests are rejected',async()=>{
  const express=require('express');
  const request=require('supertest');
  const app=express();app.use(express.json());app.use('/api/helpers/me',require('../routes/helperWork'));app.use(require('../middleware/errorHandler').errorHandler);
  await request(app).get(`/api/helpers/me/work-records/${jobId}`).expect(401);
  const customer=await request(app).get(`/api/helpers/me/work-records/${jobId}`).set('x-work-user',client).expect(200);
  expect(customer.headers['cache-control']).toBe('no-store');
  expect(customer.body.work).not.toHaveProperty('private_notes');
  expect(customer.body.work).not.toHaveProperty('checklist');
 });
 test('invalid checklist input cannot enter the work record',async()=>{
  await expect(work.save(jobId,helper,{...draft(2),checklist:[{label:'Task',done:'false'}]})).rejects.toMatchObject({statusCode:400});
  await expect(work.createTemplate(helper,{name:'Empty',items:[]})).rejects.toMatchObject({statusCode:400});
 });
 test('reassignment hides the old helper data and removes old-link access',async()=>{
  await pool.query('UPDATE jobs SET assigned_helper_id=$2 WHERE id=$1',[jobId,other]);
  await expect(work.read(jobId,helper)).rejects.toMatchObject({statusCode:404});
  await expect(work.save(jobId,helper,draft(2))).rejects.toMatchObject({statusCode:404});
  const next=await work.read(jobId,other);
  expect(next.work.checklist).toEqual([]);
  expect(next.work.private_notes).toBe('');
  expect(next.updates).toEqual([]);
  expect((await work.read(jobId,client)).work.handover).toBe('');
 });
 test('revocation rejects every protected operation while unrelated helper access stays effective',async()=>{
  await pool.query("UPDATE access_grants SET status='revoked' WHERE user_id=$1",[other]);
  await expect(work.read(jobId,other)).rejects.toMatchObject({statusCode:403});
  await expect(work.publish(jobId,other,{body:'Old link',requestId:crypto.randomUUID()})).rejects.toMatchObject({statusCode:403});
  await expect(work.board(other)).rejects.toMatchObject({statusCode:403});
  await expect(work.templates(other)).rejects.toMatchObject({statusCode:403});
  expect((await access.can(helper,'helper.offer_services')).allowed).toBe(true);
  expect((await work.read(jobId,client)).writable).toBe(false);
  const express=require('express'),request=require('supertest');
  const app=express();app.use(express.json());app.use('/api/helpers/me',require('../routes/helperWork'));app.use(require('../middleware/errorHandler').errorHandler);
  await request(app).get(`/api/helpers/me/work-records/${jobId}`).set('x-work-user',helper).expect(404);
  await request(app).put(`/api/helpers/me/work-records/${jobId}`).set('x-work-user',other).send(draft()).expect(403);
 });
});
