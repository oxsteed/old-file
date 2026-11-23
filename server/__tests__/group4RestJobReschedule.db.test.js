'use strict';
// Group 4 rest (item 181): job-level reschedule proposals (proposal-only).
const raw = process.env.ACCESS_TEST_DATABASE_URL;
if (raw) {
  const parsed = new URL(raw);
  if (!['127.0.0.1', 'localhost'].includes(parsed.hostname)
    || !/^\/(credit_statement_test|pa_g\d+)$/.test(parsed.pathname)) throw new Error('Disposable database required');
  process.env.DATABASE_URL = raw;
}
jest.mock('../services/notificationService', () => ({ sendNotification: jest.fn().mockResolvedValue({ success: true }) }));
jest.unmock('pg');
jest.unmock('../db');
jest.unmock('../utils/transaction');
const crypto = require('crypto');
const pool = require('../db');
const svc = require('../services/jobRescheduleService');
const { sendNotification } = require('../services/notificationService');
const describeDb = raw ? describe : describe.skip;
const helper = crypto.randomUUID(), client = crypto.randomUUID(), stranger = crypto.randomUUID();
const jobIds = [];
const inDays = (d) => new Date(Date.now() + d * 86400000).toISOString();
let jobId;

describeDb('Group 4 rest: job reschedule proposals (181)', () => {
  beforeAll(async () => {
    for (const id of [helper, client, stranger]) {
      await pool.query(`INSERT INTO users(id,email,password_hash,first_name,last_name,role,is_active,email_verified,id_verified,terms_accepted,terms_accepted_at,terms_version)
        VALUES($1,$2,'x','Move','Fixture','customer',TRUE,TRUE,TRUE,TRUE,NOW(),'g4r-test')`, [id, `g4m-${id}@example.invalid`]);
    }
    const { rows: [j] } = await pool.query(`INSERT INTO jobs(client_id,assigned_helper_id,title,description,status,scheduled_time,final_price_cents)
      VALUES($1,$2,'Move job','Fixture','accepted',NOW() + interval '2 days',5000) RETURNING id`, [client, helper]);
    jobId = j.id; jobIds.push(j.id);
  });
  afterAll(async () => {
    await pool.query('DELETE FROM jobs WHERE id = ANY($1::uuid[])', [jobIds]);
    await pool.end();
  });

  test('propose leaves the job untouched; accept by the other party moves it; price never changes', async () => {
    const p = await svc.propose(helper, jobId, { proposedTime: inDays(5), reason: 'Part delayed' });
    const { rows: [before] } = await pool.query('SELECT scheduled_time FROM jobs WHERE id=$1', [jobId]);
    expect(new Date(before.scheduled_time).getTime()).toBeLessThan(Date.now() + 3 * 86400000);
    expect(sendNotification).toHaveBeenCalledWith(expect.objectContaining({ userId: client, type: 'job_reschedule_proposed' }));
    await expect(svc.respond(helper, jobId, p.id, { action: 'accept' })).rejects.toMatchObject({ statusCode: 403 });
    await expect(svc.respond(stranger, jobId, p.id, { action: 'accept' })).rejects.toMatchObject({ statusCode: 404 });
    await svc.respond(client, jobId, p.id, { action: 'accept' });
    const { rows: [after] } = await pool.query('SELECT scheduled_time, final_price_cents FROM jobs WHERE id=$1', [jobId]);
    expect(new Date(after.scheduled_time).toISOString()).toBe(new Date(p.proposedTime).toISOString());
    expect(after.final_price_cents).toBe(5000);
    await expect(svc.respond(client, jobId, p.id, { action: 'decline' })).rejects.toMatchObject({ code: 'proposal_closed' });
  });

  test('decline keeps the time; a second proposal from the same side supersedes; proposer withdraws', async () => {
    const { rows: [t0] } = await pool.query('SELECT scheduled_time FROM jobs WHERE id=$1', [jobId]);
    const a = await svc.propose(client, jobId, { proposedTime: inDays(7) });
    const b = await svc.propose(client, jobId, { proposedTime: inDays(8) });
    const list = await svc.list(helper, jobId);
    expect(list.find((x) => x.id === a.id).status).toBe('superseded');
    await svc.respond(helper, jobId, b.id, { action: 'decline' });
    const { rows: [t1] } = await pool.query('SELECT scheduled_time FROM jobs WHERE id=$1', [jobId]);
    expect(t1.scheduled_time).toEqual(t0.scheduled_time);
    const c = await svc.propose(client, jobId, { proposedTime: inDays(9) });
    await expect(svc.respond(helper, jobId, c.id, { action: 'withdraw' })).rejects.toMatchObject({ statusCode: 403 });
    expect((await svc.respond(client, jobId, c.id, { action: 'withdraw' })).status).toBe('withdrawn');
  });

  test('out-of-range times, started jobs, and jobs with an appointment are refused', async () => {
    await expect(svc.propose(client, jobId, { proposedTime: inDays(-1) })).rejects.toMatchObject({ code: 'reschedule_time_out_of_range' });
    await expect(svc.propose(client, jobId, { proposedTime: inDays(400) })).rejects.toMatchObject({ code: 'reschedule_time_out_of_range' });
    await pool.query(`INSERT INTO appointments (job_id, customer_id, helper_id, status, service_description, scheduled_start_time, scheduled_end_time)
      VALUES ($1,$2,$3,'confirmed','x',NOW() + interval '40 days',NOW() + interval '40 days 1 hour')`, [jobId, client, helper]);
    await expect(svc.propose(client, jobId, { proposedTime: inDays(3) })).rejects.toMatchObject({ code: 'use_appointment_reschedule' });
    await pool.query('DELETE FROM appointments WHERE job_id=$1', [jobId]);
    await pool.query("UPDATE jobs SET status='in_progress' WHERE id=$1", [jobId]);
    await expect(svc.propose(client, jobId, { proposedTime: inDays(3) })).rejects.toMatchObject({ code: 'reschedule_not_allowed' });
  });
});
