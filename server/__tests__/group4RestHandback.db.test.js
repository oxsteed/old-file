'use strict';
// Group 4 rest (item 184): replacement handoff (helper hands a hired job back before it starts).
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
const svc = require('../services/jobHandbackService');
const { sendNotification } = require('../services/notificationService');
const describeDb = raw ? describe : describe.skip;
const helper = crypto.randomUUID(), client = crypto.randomUUID(), other = crypto.randomUUID(), refused = crypto.randomUUID();
const jobIds = [];

async function hiredJob(extra = '') {
  const { rows: [j] } = await pool.query(`INSERT INTO jobs(client_id,assigned_helper_id,title,description,status,scheduled_time)
    VALUES($1,$2,'Hand-back job','Fixture','accepted',NOW() + interval '3 days') RETURNING id`, [client, helper]);
  jobIds.push(j.id);
  const hireAt = '2026-11-20T10:00:00Z';
  await pool.query(`INSERT INTO bids(job_id,helper_id,amount,currency_code,status,updated_at) VALUES
    ($1,$2,50,'USD','accepted',$5),($1,$3,60,'USD','rejected',$5),($1,$4,70,'USD','rejected','2026-11-19T10:00:00Z')`,
  [j.id, helper, other, refused, hireAt]);
  if (extra) await pool.query(extra, [j.id]);
  return j.id;
}

describeDb('Group 4 rest: replacement handoff (184)', () => {
  beforeAll(async () => {
    for (const id of [helper, client, other, refused]) {
      await pool.query(`INSERT INTO users(id,email,password_hash,first_name,last_name,role,is_active,email_verified,id_verified,terms_accepted,terms_accepted_at,terms_version)
        VALUES($1,$2,'x','Hand','Fixture','customer',TRUE,TRUE,TRUE,TRUE,NOW(),'g4r-test')`, [id, `g4h-${id}@example.invalid`]);
    }
  });
  afterAll(async () => {
    await pool.query('DELETE FROM appointments WHERE customer_id = $1', [client]);
    await pool.query('DELETE FROM jobs WHERE id = ANY($1::uuid[])', [jobIds]);
    await pool.end();
  });

  test('reopens the job, withdraws the helper bid, revives only bids rejected by this hire, detaches the appointment', async () => {
    const jobId = await hiredJob();
    const { rows: [appt] } = await pool.query(`INSERT INTO appointments (job_id, customer_id, helper_id, status, service_description, scheduled_start_time, scheduled_end_time)
      VALUES ($1,$2,$3,'confirmed','x',NOW() + interval '3 days',NOW() + interval '3 days 1 hour') RETURNING id`, [jobId, client, helper]);
    await expect(svc.handBack(client, jobId, { reasonCode: 'illness' })).rejects.toMatchObject({ statusCode: 404 });
    await expect(svc.handBack(helper, jobId, { reasonCode: 'other' })).rejects.toMatchObject({ statusCode: 400 });
    const out = await svc.handBack(helper, jobId, { reasonCode: 'schedule_conflict' });
    expect(out.reopenedBidCount).toBe(1);
    const { rows: [job] } = await pool.query('SELECT status, assigned_helper_id FROM jobs WHERE id=$1', [jobId]);
    expect(job).toEqual({ status: 'published', assigned_helper_id: null });
    const { rows: bids } = await pool.query('SELECT helper_id, status FROM bids WHERE job_id=$1', [jobId]);
    const by = Object.fromEntries(bids.map((b) => [b.helper_id, b.status]));
    expect(by).toEqual({ [helper]: 'withdrawn', [other]: 'pending', [refused]: 'rejected' });
    const { rows: [a] } = await pool.query('SELECT job_id, status, cancelled_by FROM appointments WHERE id=$1', [appt.id]);
    expect(a).toEqual({ job_id: null, status: 'cancelled', cancelled_by: 'helper' });
    expect(sendNotification).toHaveBeenCalledWith(expect.objectContaining({ userId: client, type: 'job_handed_back' }));
    await expect(svc.handBack(helper, jobId, { reasonCode: 'illness' })).rejects.toMatchObject({ statusCode: 404 });
    // Private Trust & Safety log (admin-only reader); not part of ratings.
    const oversight = await require('../services/helperHandbackOversightService').forHelper(helper);
    expect(oversight.counts).toMatchObject({ total: 1, last30: 1, last90: 1 });
    expect(oversight.handbacks[0]).toMatchObject({ jobId, reasonCode: 'schedule_conflict', reopenedBidCount: 1 });
    const fs = require('fs'), path = require('path');
    for (const f of ['services/helperReputationService.js', 'controllers/helpersController.js']) {
      expect(fs.readFileSync(path.join(__dirname, '..', f), 'utf8')).not.toContain('job_handbacks');
    }
  });

  test('refuses when money is attached, the agreement is signed, or the helper has arrived', async () => {
    const paid = await hiredJob(`UPDATE jobs SET metadata = '{"creditCollateralHoldId":"h1"}'::jsonb WHERE id = $1`);
    await expect(svc.handBack(helper, paid, { reasonCode: 'travel' })).rejects.toMatchObject({ code: 'handback_money_on_job' });
    const signed = await hiredJob();
    await pool.query("INSERT INTO work_agreements (job_id, helper_id, customer_id, status) VALUES ($1,$2,$3,'active')", [signed, helper, client]);
    await expect(svc.handBack(helper, signed, { reasonCode: 'travel' })).rejects.toMatchObject({ code: 'handback_agreement_signed' });
    const arrived = await hiredJob('UPDATE jobs SET arrived_at = NOW() WHERE id = $1');
    await expect(svc.handBack(helper, arrived, { reasonCode: 'travel' })).rejects.toMatchObject({ code: 'handback_not_allowed' });
    const late = await hiredJob("UPDATE jobs SET scheduled_time = NOW() - interval '1 hour' WHERE id = $1");
    await expect(svc.handBack(helper, late, { reasonCode: 'travel' })).rejects.toMatchObject({ code: 'handback_after_start' });
    const { rows } = await pool.query("SELECT count(*)::int AS n FROM jobs WHERE id = ANY($1::uuid[]) AND status = 'accepted'", [[paid, signed, arrived, late]]);
    expect(rows[0].n).toBe(4);
  });
});
