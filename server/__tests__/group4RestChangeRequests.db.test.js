'use strict';
// Group 4 rest (item 183, closes G4-22): change requests on hired jobs without a work agreement.
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
const svc = require('../services/jobChangeRequestService');
const { sendNotification } = require('../services/notificationService');
const describeDb = raw ? describe : describe.skip;
const helper = crypto.randomUUID(), client = crypto.randomUUID(), stranger = crypto.randomUUID();
const jobIds = [];
const scope = 'Replace the cracked subfloor under the tile';

async function hiredJob() {
  const { rows: [j] } = await pool.query(`INSERT INTO jobs(client_id,assigned_helper_id,title,description,status,job_value_cents)
    VALUES($1,$2,'Change job','Fixture','accepted',20000) RETURNING id`, [client, helper]);
  jobIds.push(j.id);
  return j.id;
}

describeDb('Group 4 rest: change requests without a work agreement (183)', () => {
  beforeAll(async () => {
    for (const id of [helper, client, stranger]) {
      await pool.query(`INSERT INTO users(id,email,password_hash,first_name,last_name,role,is_active,email_verified,id_verified,terms_accepted,terms_accepted_at,terms_version)
        VALUES($1,$2,'x','Change','Fixture','customer',TRUE,TRUE,TRUE,TRUE,NOW(),'g4r-test')`, [id, `g4c-${id}@example.invalid`]);
    }
  });
  afterAll(async () => {
    await pool.query('DELETE FROM jobs WHERE id = ANY($1::uuid[])', [jobIds]);
    await pool.end();
  });

  test('helper proposes, customer counters, helper accepts: price changes once, every version kept, no charge', async () => {
    const jobId = await hiredJob();
    await expect(svc.propose(client, jobId, { description: scope, priceChangeCents: 5000 })).rejects.toMatchObject({ code: 'change_request_helper_only' });
    await expect(svc.propose(stranger, jobId, { description: scope, priceChangeCents: 5000 })).rejects.toMatchObject({ statusCode: 404 });
    const v1 = await svc.propose(helper, jobId, { description: scope, lineItems: [{ description: 'Subfloor', quantity: 2, unit_price_cents: 3000, type: 'material' }] });
    expect(v1.priceChangeCents).toBe(6000);
    expect(sendNotification).toHaveBeenCalledWith(expect.objectContaining({ userId: client, type: 'job_change_request_proposed' }));
    await expect(svc.respond(helper, jobId, v1.id, { action: 'accept' })).rejects.toMatchObject({ statusCode: 403 });
    await expect(svc.propose(helper, jobId, { description: scope, priceChangeCents: 1 })).rejects.toMatchObject({ code: 'change_request_open' });
    const v2 = await svc.respond(client, jobId, v1.id, { action: 'counter', description: scope + ' (one sheet only)', priceChangeCents: 4000 });
    expect(v2).toMatchObject({ version: 2, threadId: v1.threadId, parentId: v1.id, status: 'proposed' });
    expect(sendNotification).toHaveBeenCalledWith(expect.objectContaining({ userId: helper, type: 'job_change_request_countered' }));
    const done = await svc.respond(helper, jobId, v2.id, { action: 'accept' });
    expect(done).toMatchObject({ status: 'accepted', appliedJobValueCents: 24000 });
    const { rows: [job] } = await pool.query('SELECT job_value_cents FROM jobs WHERE id=$1', [jobId]);
    expect(Number(job.job_value_cents)).toBe(24000);
    const { rows: pays } = await pool.query('SELECT 1 FROM payments WHERE job_id=$1', [jobId]);
    expect(pays).toHaveLength(0);
    const history = await svc.list(client, jobId);
    expect(history.map((h) => [h.version, h.status]).sort()).toEqual([[1, 'countered'], [2, 'accepted']]);
    const { rows: revs } = await pool.query("SELECT 1 FROM job_revisions WHERE job_id=$1 AND source='change_order'", [jobId]);
    expect(revs.length).toBeGreaterThan(0);
    await expect(svc.respond(helper, jobId, v2.id, { action: 'decline' })).rejects.toMatchObject({ code: 'change_request_closed' });
  });

  test('decline and withdraw leave the job unchanged; agreement jobs and unhired jobs are refused', async () => {
    const jobId = await hiredJob();
    const a = await svc.propose(helper, jobId, { description: scope, priceChangeCents: -2000 });
    await svc.respond(client, jobId, a.id, { action: 'decline' });
    const b = await svc.propose(helper, jobId, { description: scope, priceChangeCents: 1000 });
    expect((await svc.respond(helper, jobId, b.id, { action: 'withdraw' })).status).toBe('withdrawn');
    const { rows: [job] } = await pool.query('SELECT job_value_cents FROM jobs WHERE id=$1', [jobId]);
    expect(Number(job.job_value_cents)).toBe(20000);
    await expect(svc.propose(helper, jobId, { description: 'short', priceChangeCents: 1 })).rejects.toMatchObject({ statusCode: 400 });
    await pool.query("INSERT INTO work_agreements (job_id, helper_id, customer_id, status) VALUES ($1,$2,$3,'active')", [jobId, helper, client]);
    await expect(svc.propose(helper, jobId, { description: scope, priceChangeCents: 1 })).rejects.toMatchObject({ code: 'use_work_agreement_change_order' });
    await pool.query("UPDATE jobs SET status='completed' WHERE id=$1", [jobId]);
    await pool.query('DELETE FROM work_agreements WHERE job_id=$1', [jobId]);
    await expect(svc.propose(helper, jobId, { description: scope, priceChangeCents: 1 })).rejects.toMatchObject({ code: 'change_request_not_allowed' });
  });
});
