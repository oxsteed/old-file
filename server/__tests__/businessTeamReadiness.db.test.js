'use strict';
const raw=process.env.ACCESS_TEST_DATABASE_URL;
if(raw){const url=new URL(raw);if(!['127.0.0.1','localhost'].includes(url.hostname)||url.pathname!=='/credit_statement_test')throw new Error('Disposable team database required');process.env.DATABASE_URL=raw;}
jest.unmock('pg');jest.unmock('../db');jest.unmock('../utils/transaction');
jest.mock('../middleware/auth',()=>({authenticate:(req,res,next)=>{const id=req.get('x-team-user');if(!id)return res.sendStatus(401);req.user={id};next();}}));
const crypto=require('crypto'),db=require('../db'),service=require('../services/businessTeamReadiness'),{applyStaffOffboarding}=require('../services/staffOffboarding');
const owner=crypto.randomUUID(),member=crypto.randomUUID(),coworker=crypto.randomUUID(),other=crypto.randomUUID();let businessId,otherBusiness,membershipId;
const describeDb=raw?describe:describe.skip;
const task=(extra={})=>({kind:'task',title:'Call customer after service',due_at:'2020-01-01T12:00:00Z',assignee_id:member,requestId:crypto.randomUUID(),...extra});
describeDb('scoped team guides, policy history, due reminders and offboarding',()=>{
 beforeAll(async()=>{
  for(const id of [owner,member,coworker,other])await db.query("INSERT INTO users(id,email,password_hash,first_name,last_name,role,is_active,email_verified) VALUES($1,$2,'x','Team','Fixture','customer',TRUE,TRUE)",[id,`team-${id}@example.invalid`]);
  businessId=(await db.query("INSERT INTO businesses(user_id,business_name,is_primary,is_active,is_listed) VALUES($1,'Team readiness',FALSE,TRUE,FALSE) RETURNING id",[owner])).rows[0].id;
  otherBusiness=(await db.query("INSERT INTO businesses(user_id,business_name,is_primary,is_active,is_listed) VALUES($1,'Other team',FALSE,TRUE,FALSE) RETURNING id",[other])).rows[0].id;
  for(const id of [member,coworker]){const result=await db.query("INSERT INTO business_members(business_id,owner_id,member_id,invite_email,role,status) VALUES($1,$2,$3,$4,'employee','active') RETURNING id",[businessId,owner,id,`team-${id}@example.invalid`]);if(id===member)membershipId=result.rows[0].id;}
 });
 afterAll(async()=>{await db.query('DELETE FROM business_team_acknowledgments WHERE user_id=ANY($1::uuid[])',[[owner,member,coworker,other]]);await db.query('DELETE FROM staff_offboarding_records WHERE business_id=$1',[businessId]);await db.query('DELETE FROM businesses WHERE id=ANY($1::int[])',[[businessId,otherBusiness]]);await db.end();});
 test('guide/policy publication is owner-only, versioned and keeps exact acknowledgment history',async()=>{
  const input={kind:'guide',title:'First shift guide',body:'Read the arrival instructions and contact your supervisor.',expectedVersion:0};
  await expect(service.publish(businessId,member,input)).rejects.toMatchObject({statusCode:403});
  const first=await service.publish(businessId,owner,input);await service.acknowledge(businessId,member,first.id);await service.acknowledge(businessId,member,first.id);
  expect((await service.read(businessId,member)).history).toHaveLength(1);
  const second=await service.publish(businessId,owner,{...input,body:'Updated arrival point',expectedVersion:1});
  const current=await service.read(businessId,member);expect(current.documents[0]).toMatchObject({id:second.id,version:2,acknowledged:false});expect(current.history[0].id).toBe(first.id);
  await expect(service.publish(businessId,owner,{...input,expectedVersion:1})).rejects.toMatchObject({statusCode:409});
  await expect(service.acknowledge(otherBusiness,other,first.id)).rejects.toMatchObject({statusCode:404});
  await expect(service.read(businessId,other)).rejects.toMatchObject({statusCode:404});
 });
 test('overdue alerts and reminders are assignee-scoped, retry-safe and version checked',async()=>{
  const input=task(),created=await service.createTask(businessId,owner,input);
  expect((await service.createTask(businessId,owner,input)).id).toBe(created.id);
  expect((await service.read(businessId,member)).overdue_count).toBe(1);expect((await service.read(businessId,coworker)).tasks).toEqual([]);
  await expect(service.createTask(businessId,member,task())).rejects.toMatchObject({statusCode:403});
  const reminder=await service.createTask(businessId,member,task({kind:'reminder',title:'My follow-up',due_at:'2030-01-01T12:00:00Z'}));expect(reminder.assignee_id).toBe(member);
  await expect(service.createTask(businessId,member,task({kind:'reminder',assignee_id:coworker}))).rejects.toMatchObject({statusCode:403});
  await expect(service.completeTask(businessId,coworker,created.id,{status:'completed',expectedVersion:1})).rejects.toMatchObject({statusCode:409});
  await service.completeTask(businessId,member,created.id,{status:'completed',expectedVersion:1});
  await expect(service.completeTask(businessId,member,created.id,{status:'open',expectedVersion:1})).rejects.toMatchObject({statusCode:409});
  expect((await service.read(businessId,member)).overdue_count).toBe(0);
 });
 test('competing publications and request retries cannot duplicate versions or tasks',async()=>{
  const input={kind:'policy',title:'Tool storage policy',body:'Lock tools after the shift.',expectedVersion:0};
  const published=await Promise.allSettled([service.publish(businessId,owner,input),service.publish(businessId,owner,input)]);expect(published.filter(row=>row.status==='fulfilled')).toHaveLength(1);
  const todo=task({title:'Concurrent task'}),created=await Promise.all([service.createTask(businessId,owner,todo),service.createTask(businessId,owner,todo)]);expect(created[0].id).toBe(created[1].id);
 });
 test('267: a manager can allocate a task to someone else and link it to a job',async()=>{
  await db.query("UPDATE business_members SET role='manager',role_updated_by=$3 WHERE business_id=$1 AND member_id=$2",[businessId,coworker,owner]);
  const jobId=(await db.query("INSERT INTO jobs(client_id,title,description) VALUES($1,'Fix sink','Replace the kitchen tap') RETURNING id",[owner])).rows[0].id;
  try{
   const created=await service.createTask(businessId,coworker,task({assignee_id:member,job_id:jobId}));
   expect(created.job_id).toBe(jobId);
   const read=await service.read(businessId,coworker);
   expect(read.canAllocate).toBe(true);
   expect(read.tasks.some((row)=>row.id===created.id)).toBe(true);
   expect(read.tasks.find((row)=>row.id===created.id)?.job_title).toBe('Fix sink');
   await expect(service.createTask(businessId,coworker,task({job_id:crypto.randomUUID()}))).rejects.toMatchObject({statusCode:404});
   await expect(service.createTask(businessId,coworker,task({job_id:'not-a-uuid'}))).rejects.toMatchObject({statusCode:400});
   await expect(service.createTask(businessId,member,task({assignee_id:coworker}))).rejects.toMatchObject({statusCode:403});
  }finally{
   await db.query('DELETE FROM business_team_tasks WHERE job_id=$1',[jobId]);
   await db.query('DELETE FROM jobs WHERE id=$1',[jobId]);
   await db.query("UPDATE business_members SET role='employee',role_updated_by=$3 WHERE business_id=$1 AND member_id=$2",[businessId,coworker,owner]);
  }
 });
 test('269: team documents can be scoped to a job or a member, and are hidden from everyone else',async()=>{
  const jobId=(await db.query("INSERT INTO jobs(client_id,title,description,assigned_helper_id) VALUES($1,'Fix sink','Replace the kitchen tap',$2) RETURNING id",[owner,member])).rows[0].id;
  const ver=async(kind,job,assignee)=>(await db.query('SELECT COALESCE(MAX(version),0)::int AS n FROM business_team_documents WHERE business_id=$1 AND kind=$2 AND job_id IS NOT DISTINCT FROM $3 AND assignee_id IS NOT DISTINCT FROM $4',[businessId,kind,job||null,assignee||null])).rows[0].n;
  try{
   const wide=await service.publish(businessId,owner,{kind:'guide',title:'Wide guide',body:'For everyone on the team.',expectedVersion:await ver('guide')});
   const jobDoc=await service.publish(businessId,owner,{kind:'guide',title:'Gate code',body:'Side door code 1234.',expectedVersion:await ver('guide',jobId),job_id:jobId});
   const memberDoc=await service.publish(businessId,owner,{kind:'policy',title:'For one member',body:'Only for the named member.',expectedVersion:await ver('policy',null,member),assignee_id:member});
   expect(jobDoc.version).toBe(1);
   // The wide chain is untouched by the scoped publish: its next version follows the wide one.
   const wide2=await service.publish(businessId,owner,{kind:'guide',title:'Wide guide v2',body:'Updated.',expectedVersion:await ver('guide')});
   expect(wide2.version).toBe(wide.version+1);
   const memberRead=await service.read(businessId,member);
   expect(memberRead.documents.map((row)=>row.id)).toEqual(expect.arrayContaining([wide2.id,jobDoc.id,memberDoc.id]));
   expect(memberRead.documents.find((row)=>row.id===jobDoc.id)?.job_title).toBe('Fix sink');
   const coworkerRead=await service.read(businessId,coworker);
   expect(coworkerRead.documents.map((row)=>row.id)).toEqual(expect.arrayContaining([wide2.id]));
   expect(coworkerRead.documents.map((row)=>row.id)).not.toEqual(expect.arrayContaining([jobDoc.id,memberDoc.id]));
   await expect(service.acknowledge(businessId,coworker,jobDoc.id)).rejects.toMatchObject({statusCode:404});
   await service.acknowledge(businessId,member,jobDoc.id);
   await expect(service.publish(businessId,owner,{kind:'guide',title:'Ghost',body:'No such job.',expectedVersion:await ver('guide',crypto.randomUUID()),job_id:crypto.randomUUID()})).rejects.toMatchObject({statusCode:404});
   await expect(service.publish(businessId,owner,{kind:'guide',title:'Ghost',body:'Bad job id.',expectedVersion:0,job_id:'not-a-uuid'})).rejects.toMatchObject({statusCode:400});
  }finally{
   await db.query('DELETE FROM business_team_documents WHERE job_id=$1 OR assignee_id=$2',[jobId,member]);
   await db.query('DELETE FROM jobs WHERE id=$1',[jobId]);
  }
 });
 test('offboarding reassigns open team work and exposes a scoped outcome, retaining completed history',async()=>{
  const client=await db.connect();try{await client.query('BEGIN');await client.query("UPDATE business_members SET status='revoked' WHERE id=$1",[membershipId]);const result=await applyStaffOffboarding(client,{businessId,userId:member,membershipId,removedBy:owner,reassignToUserId:owner,reason:'End temporary assignment'});expect(result.teamTasksReassigned).toBeGreaterThan(0);await client.query('COMMIT');}catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
  await expect(service.read(businessId,member)).rejects.toMatchObject({statusCode:404});
  const dashboard=await service.read(businessId,owner);expect(dashboard.offboarding[0].team_tasks_reassigned).toBeGreaterThan(0);
  expect(dashboard.tasks.filter(row=>row.status==='open').every(row=>row.assignee_id===owner)).toBe(true);
  expect(dashboard.tasks.some(row=>row.status==='completed'&&row.assignee_id===member)).toBe(true);
  expect((await service.read(businessId,coworker)).offboarding).toEqual([]);
 });
 test('read routes require current business standing and return uncached data',async()=>{
  const express=require('express'),app=express();app.use(express.json());app.use('/api/businesses',require('../routes/businessTeam'));app.use(require('../middleware/errorHandler').errorHandler);const request=require('supertest');
  await request(app).get(`/api/businesses/${businessId}/team/readiness`).expect(401);
  await request(app).get(`/api/businesses/${businessId}/team/readiness`).set('x-team-user',member).expect(404);
  const response=await request(app).get(`/api/businesses/${businessId}/team/readiness`).set('x-team-user',owner).expect(200);expect(response.headers['cache-control']).toBe('no-store');
 });
});
