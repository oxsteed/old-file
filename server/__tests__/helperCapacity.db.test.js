'use strict';
const raw=process.env.ACCESS_TEST_DATABASE_URL;
if(raw){const url=new URL(raw);if(!['127.0.0.1','localhost'].includes(url.hostname)||url.pathname!=='/credit_statement_test')throw new Error('Disposable capacity database required');process.env.DATABASE_URL=raw;}
jest.unmock('pg');jest.unmock('../db');jest.unmock('../utils/transaction');
const crypto=require('crypto');const db=require('../db');const service=require('../services/helperCapacityService');const availability=require('../services/helperAvailabilityService');
const helper=crypto.randomUUID(),customer=crypto.randomUUID();
const describeDb=raw?describe:describe.skip;
async function appointment(start,end,status='confirmed'){
 return (await db.query(`INSERT INTO appointments(customer_id,helper_id,service_description,scheduled_start_time,scheduled_end_time,status,created_by_user_id) VALUES($1,$2,'Capacity test',$3,$4,$5,$1) RETURNING *`,[customer,helper,start,end,status])).rows[0];
}
async function policy(daily,travel){const current=await service.read(helper);return service.save(helper,{daily_job_limit:daily,travel_buffer_minutes:travel,expectedVersion:current.capacity_version});}
describeDb('daily helper capacity and travel enforcement',()=>{
 beforeAll(async()=>{
  for(const id of [helper,customer])await db.query(`INSERT INTO users(id,email,password_hash,first_name,last_name,role,email_verified,is_active,id_verified,terms_accepted,terms_accepted_at,terms_version,timezone) VALUES($1,$2,'x','Capacity','Fixture','customer',TRUE,TRUE,TRUE,TRUE,NOW(),'capacity-test','UTC')`,[id,`capacity-${id}@example.invalid`]);
  await db.query(`INSERT INTO access_grants(user_id,capability,subject_type,subject_key,status,provenance,policy_version) VALUES($1,'helper.offer_services','self','self','active','legacy_backfill','helper-policy-1')`,[helper]);
  for(let day=0;day<7;day++)await db.query("INSERT INTO helper_availability(helper_id,day_of_week,start_time,end_time,is_active) VALUES($1,$2,'08:00','18:00',TRUE)",[helper,day]);
 });
 afterEach(async()=>{await db.query('DELETE FROM appointments WHERE helper_id=$1',[helper]);});
 afterAll(async()=>{await db.query('DELETE FROM access_grants WHERE user_id=$1',[helper]);await db.query('DELETE FROM helper_availability WHERE helper_id=$1',[helper]);await db.query('DELETE FROM helper_profiles WHERE user_id=$1',[helper]);await db.end();});
 test('capacity settings persist, reject stale versions and require effective helper authority',async()=>{
  await expect(service.read(customer)).rejects.toMatchObject({statusCode:403});
  expect((await service.read(helper)).daily_job_limit).toBeNull();
  const changed=await policy(2,30);expect(changed).toMatchObject({daily_job_limit:2,travel_buffer_minutes:30,capacity_version:2});
  await expect(service.save(helper,{daily_job_limit:3,travel_buffer_minutes:0,expectedVersion:1})).rejects.toMatchObject({code:'capacity_version_conflict'});
  await expect(service.save(helper,{daily_job_limit:0,travel_buffer_minutes:0,expectedVersion:2})).rejects.toMatchObject({statusCode:400});
 });
 test('concurrent reservations cannot exceed the daily cap',async()=>{
  await policy(1,0);
  const results=await Promise.allSettled([appointment('2030-06-17T09:00:00Z','2030-06-17T10:00:00Z'),appointment('2030-06-17T12:00:00Z','2030-06-17T13:00:00Z')]);
  expect(results.filter(row=>row.status==='fulfilled')).toHaveLength(1);
  expect(results.find(row=>row.status==='rejected').reason).toMatchObject({constraint:'helper_daily_capacity'});
  const day=await availability.getHourSlots(helper,'2030-06-17',60,db,'UTC');expect(day.slots).toEqual([]);
  expect(await availability.isSlotFree(helper,'2030-06-17T15:00:00Z','2030-06-17T16:00:00Z',db,'UTC')).toMatchObject({free:false,reason:'daily_capacity'});
 });
 test('travel gaps are enforced at writes and reflected in availability',async()=>{
  await policy(null,30);await appointment('2030-06-18T09:00:00Z','2030-06-18T10:00:00Z');
  await expect(appointment('2030-06-18T10:15:00Z','2030-06-18T11:00:00Z')).rejects.toMatchObject({constraint:'helper_travel_conflict'});
  expect((await availability.isSlotFree(helper,'2030-06-18T10:15:00Z','2030-06-18T11:00:00Z',db,'UTC')).free).toBe(false);
  expect((await availability.isSlotFree(helper,'2030-06-18T10:30:00Z','2030-06-18T11:30:00Z',db,'UTC')).free).toBe(true);
  await expect(appointment('2030-06-18T10:30:00Z','2030-06-18T11:30:00Z')).resolves.toBeTruthy();
 });
 test('completed work consumes daily capacity; cancellation releases a reservation',async()=>{
  await policy(1,0);const existing=await appointment('2030-06-19T09:00:00Z','2030-06-19T10:00:00Z');
  await db.query("UPDATE appointments SET status='completed' WHERE id=$1",[existing.id]);
  await expect(appointment('2030-06-19T14:00:00Z','2030-06-19T15:00:00Z')).rejects.toMatchObject({constraint:'helper_daily_capacity'});
  await db.query("UPDATE appointments SET status='cancelled' WHERE id=$1",[existing.id]);
  await expect(appointment('2030-06-19T14:00:00Z','2030-06-19T15:00:00Z')).resolves.toBeTruthy();
 });
 test('daily boundaries follow the helper timezone, including reservations spanning midnight',async()=>{
  await policy(1,0);await db.query("UPDATE users SET timezone='America/New_York' WHERE id=$1",[helper]);
  await appointment('2030-06-21T03:30:00Z','2030-06-21T04:30:00Z');
  await expect(appointment('2030-06-21T15:00:00Z','2030-06-21T16:00:00Z')).rejects.toMatchObject({constraint:'helper_daily_capacity'});
  await db.query("UPDATE users SET timezone='UTC' WHERE id=$1",[helper]);
 });
 test('rescheduling cannot bypass capacity and revoked helpers cannot change policy',async()=>{
  await policy(1,0);const first=await appointment('2030-06-22T09:00:00Z','2030-06-22T10:00:00Z');const second=await appointment('2030-06-23T09:00:00Z','2030-06-23T10:00:00Z');
  await expect(db.query("UPDATE appointments SET scheduled_start_time='2030-06-22T14:00:00Z',scheduled_end_time='2030-06-22T15:00:00Z' WHERE id=$1",[second.id])).rejects.toMatchObject({constraint:'helper_daily_capacity'});
  await expect(db.query("UPDATE appointments SET service_description='Same slot, new note' WHERE id=$1",[first.id])).resolves.toBeTruthy();
  await db.query("UPDATE access_grants SET status='revoked' WHERE user_id=$1",[helper]);
  await expect(service.read(helper)).rejects.toMatchObject({statusCode:403});
  await expect(service.save(helper,{daily_job_limit:null,travel_buffer_minutes:0,expectedVersion:7})).rejects.toMatchObject({statusCode:403});
 });
});
