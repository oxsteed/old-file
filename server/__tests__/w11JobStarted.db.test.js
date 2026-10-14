'use strict';
const crypto = require('crypto');
const schema = `w11_start_${crypto.randomBytes(6).toString('hex')}`;
const url = process.env.STATEMENT_TEST_DATABASE_URL;
if (url) {
  const target = new URL(url);
  if (!['127.0.0.1','localhost'].includes(target.hostname) || target.pathname !== '/credit_statement_test') throw new Error('Disposable statement DB required');
  target.searchParams.set('options', `-c search_path=${schema},public`);
  process.env.DATABASE_URL = target.toString();
}
jest.unmock('pg'); jest.unmock('../db'); jest.unmock('../utils/transaction');
jest.mock('../services/notificationService', () => ({sendNotification: jest.fn().mockResolvedValue({success:true})}));
jest.mock('../services/helperOnboarding', () => ({ loadHelperOnboarding: jest.fn().mockResolvedValue({ complete: true }) }));
const db = require('../db');
const {startJob} = require('../controllers/jobController');
const {sendNotification} = require('../services/notificationService');
const ids = {owner:crypto.randomUUID(),helper:crypto.randomUUID(),other:crypto.randomUUID()};
const describeDb = url ? describe : describe.skip;
describeDb('W11 actual job-start transactions and notification ordering', () => {
  beforeAll(async () => {
    await db.query(`CREATE SCHEMA ${schema}`);
    await db.query(`CREATE TABLE ${schema}.jobs(id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      client_id UUID, assigned_helper_id UUID, status TEXT, expires_at TIMESTAMPTZ,
      title TEXT DEFAULT 'Synthetic job', started_at TIMESTAMPTZ, updated_at TIMESTAMPTZ)`);
    await db.query(`CREATE TABLE ${schema}.appointments(id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      job_id UUID, status TEXT, updated_at TIMESTAMPTZ)`);
  });
  afterAll(async () => { await db.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); await db.end(); });
  beforeEach(() => sendNotification.mockClear());
  async function job(status='accepted',helper=ids.helper) {
    const row = (await db.query('INSERT INTO jobs(client_id,assigned_helper_id,status) VALUES($1,$2,$3) RETURNING *',[ids.owner,helper,status])).rows[0];
    await db.query("INSERT INTO appointments(job_id,status) VALUES($1,'confirmed')",[row.id]); return row;
  }
  async function invoke(row,actor) {
    const next = jest.fn();
    const res = {json:jest.fn(),status:jest.fn()};
    await startJob({params:{id:row.id},user:{id:actor}},res,next);
    return {res,error:next.mock.calls[0]?.[0]};
  }
  async function state(id) { return (await db.query('SELECT * FROM jobs WHERE id=$1',[id])).rows[0]; }
  test.each(['owner','helper'])('%s start commits the job and appointment before notifying the counterparty',async actor => {
    const row=await job();
    sendNotification.mockImplementationOnce(async n => {
      expect((await state(row.id)).status).toBe('in_progress');
      expect((await db.query('SELECT status FROM appointments WHERE job_id=$1',[row.id])).rows[0].status).toBe('in_progress');
      expect(n).toMatchObject({userId:ids[actor==='owner'?'helper':'owner'],type:'job_started',idempotencyKey:`job-started:${row.id}`,action_url:`/jobs/${row.id}`});
      expect(n.body).toBeUndefined(); // localized service copy, no appended English sentence
      return {success:true};
    });
    expect((await invoke(row,ids[actor])).error).toBeUndefined();
    expect(sendNotification).toHaveBeenCalledTimes(1);
    expect((await invoke(row,ids[actor])).error).toMatchObject({code:'invalid_job_state'});
    expect(sendNotification).toHaveBeenCalledTimes(1);
  });
  test.each([['published','invalid_job_state'],['completed','invalid_job_state'],['cancelled','invalid_job_state']])('%s never emits start',async(status,code) => {
    const row=await job(status); expect((await invoke(row,ids.helper)).error).toMatchObject({code});
    expect(sendNotification).not.toHaveBeenCalled(); expect((await state(row.id)).status).toBe(status);
  });
  test('missing assignment and nonparticipants cannot start',async() => {
    expect((await invoke(await job('accepted',null),ids.owner)).error).toMatchObject({code:'no_helper_assigned'});
    expect((await invoke(await job(),ids.other)).error).toMatchObject({code:'job_not_found'});
    expect(sendNotification).not.toHaveBeenCalled();
  });
  test('appointment failure rolls back job and emits no notice',async() => {
    const row=await job();
    await db.query(`ALTER TABLE appointments ADD CONSTRAINT reject_start
      CHECK(status<>'in_progress' OR job_id<>'${row.id}'::uuid)`);
    try {
      expect((await invoke(row,ids.helper)).error).toBeDefined();
      expect((await state(row.id)).status).toBe('accepted');
      expect(sendNotification).not.toHaveBeenCalled();
    } finally { await db.query('ALTER TABLE appointments DROP CONSTRAINT reject_start'); }
  });
  test('reassignment after the precheck fails the transactional participant gate',async() => {
    const row=await job();
    const query=db.query.bind(db);
    const spy=jest.spyOn(db,'query').mockImplementation(async(sql,params) => {
      const result=await query(sql,params);
      if (/SELECT id, client_id, assigned_helper_id, status, expires_at/.test(sql)) {
        await query('UPDATE jobs SET assigned_helper_id=$2 WHERE id=$1',[row.id,ids.other]);
      }
      return result;
    });
    try {
      expect((await invoke(row,ids.helper)).error).toMatchObject({code:'state_conflict'});
      expect((await state(row.id)).status).toBe('accepted');
      expect(sendNotification).not.toHaveBeenCalled();
    } finally { spy.mockRestore(); }
  });
});
