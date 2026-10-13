'use strict';

// Review W3 (P1-131, P2-478) against a real migrated database.
jest.unmock('pg');
jest.unmock('../utils/transaction');
jest.mock('../services/notificationService', () => ({
  sendNotification: jest.fn().mockResolvedValue(undefined),
  sendBulkNotification: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../services/reconciliationExceptions', () => ({ recordException: jest.fn().mockResolvedValue(undefined) }));
const { disposableDatabaseOptIn } = require('./helpers/statementTestDatabase');

const database = disposableDatabaseOptIn('JOB_LIFECYCLE_TEST_DATABASE_URL');
if (database) process.env.DATABASE_URL = database;
const describeDatabase = database ? describe : describe.skip;

const crypto = require('crypto');
const pool = require('../db');
const { sendNotification } = require('../services/notificationService');
const { recordException } = require('../services/reconciliationExceptions');

async function user() {
  const id = crypto.randomUUID();
  await pool.query(
    `INSERT INTO users (id, email, password_hash, first_name, last_name) VALUES ($1, $2, 'x', 'T', 'U')`,
    [id, `${id}@example.test`]);
  return id;
}

async function acceptedJob({ daysAgo, helper, client, withHold = false }) {
  const { rows: [job] } = await pool.query(
    `INSERT INTO jobs (client_id, title, description, status, assigned_helper_id)
     VALUES ($1, 'Fix fence', 'd', 'published', $2) RETURNING id`, [client, helper]);
  await pool.query(`INSERT INTO bids (job_id, helper_id, amount, status) VALUES ($1, $2, 100, 'accepted')`, [job.id, helper]);
  await pool.query(`UPDATE jobs SET status = 'accepted' WHERE id = $1`, [job.id]);
  await pool.query(`UPDATE jobs SET accepted_at = NOW() - ($2::numeric * INTERVAL '1 day') WHERE id = $1`, [job.id, daysAgo]);
  if (withHold) {
    await pool.query(
      `INSERT INTO payments (job_id, payer_id, payee_id, amount, status, escrow_status)
       VALUES ($1, $2, $3, 100, 'authorized', 'held')`, [job.id, client, helper]);
  }
  return job.id;
}

describeDatabase('job acceptance lifecycle (real database)', () => {
  afterAll(async () => { await pool.end?.(); });
  beforeEach(async () => {
    jest.clearAllMocks();
    await pool.query(`DELETE FROM cron_job_locks WHERE lock_id LIKE '%accepted-job-expiry%' OR lock_id LIKE '%helper-completion%'`).catch(() => {});
  });

  test('moving a job to accepted stamps accepted_at (P1-131)', async () => {
    const [client, helper] = [await user(), await user()];
    const { rows: [job] } = await pool.query(
      `INSERT INTO jobs (client_id, title, description, status) VALUES ($1, 't', 'd', 'published') RETURNING id, accepted_at`, [client]);
    expect(job.accepted_at).toBeNull();
    const { rows: [after] } = await pool.query(
      `UPDATE jobs SET status = 'accepted', assigned_helper_id = $2 WHERE id = $1 RETURNING accepted_at`, [job.id, helper]);
    expect(after.accepted_at).not.toBeNull();
  });

  test('stale jobs are cancelled as system, held jobs are escalated, and day-5 jobs are warned', async () => {
    const [client, helper] = [await user(), await user()];
    const stale = await acceptedJob({ daysAgo: 8, client, helper });
    const held = await acceptedJob({ daysAgo: 8, client, helper, withHold: true });
    const warn = await acceptedJob({ daysAgo: 5.5, client, helper });

    const { runAcceptedJobExpiryJob } = require('../jobs/acceptedJobExpiryJob');
    const result = await runAcceptedJobExpiryJob();
    expect(result).toMatchObject({ locked: true, failed: 0 });

    const status = async (id) => (await pool.query('SELECT status, expiry_warning_sent_at FROM jobs WHERE id = $1', [id])).rows[0];
    expect((await status(stale)).status).toBe('cancelled');
    expect((await status(held)).status).toBe('accepted');
    expect((await status(warn)).status).toBe('accepted');
    expect((await status(warn)).expiry_warning_sent_at).not.toBeNull();

    const { rows: [audit] } = await pool.query(
      'SELECT cancelled_by_id, cancelled_by_role, fee_amount_cents FROM cancellation_audit_log WHERE job_id = $1', [stale]);
    expect(audit).toEqual({ cancelled_by_id: null, cancelled_by_role: 'system', fee_amount_cents: 0 });
    expect(recordException).toHaveBeenCalledWith(expect.objectContaining({ referenceId: `stale_accepted_job:${held}` }));
    const types = sendNotification.mock.calls.map(([n]) => `${n.type}:${n.data.job_id}`);
    expect(types).toEqual(expect.arrayContaining([`job_auto_cancelled:${stale}`, `job_auto_cancel_warning:${warn}`]));
    expect(types).not.toContain(`job_auto_cancel_warning:${stale}`);

    // A second run does not warn again.
    sendNotification.mockClear();
    await runAcceptedJobExpiryJob();
    expect(sendNotification.mock.calls.map(([n]) => n.data.job_id)).not.toContain(warn);
  });

  test('a helper completion request auto-confirms after the window (P2-478)', async () => {
    const [client, helper] = [await user(), await user()];
    const { rows: [job] } = await pool.query(
      `INSERT INTO jobs (client_id, title, description, status, assigned_helper_id, completion_requested_at, completion_requested_by)
       VALUES ($1, 't', 'd', 'in_progress', $2, NOW() - INTERVAL '80 hours', $2) RETURNING id`, [client, helper]);
    const { rows: [fresh] } = await pool.query(
      `INSERT INTO jobs (client_id, title, description, status, assigned_helper_id, completion_requested_at, completion_requested_by)
       VALUES ($1, 't', 'd', 'in_progress', $2, NOW() - INTERVAL '1 hour', $2) RETURNING id`, [client, helper]);
    const { runHelperCompletionAutoConfirm } = require('../jobs/helperCompletionAutoConfirm');
    const out = await runHelperCompletionAutoConfirm();
    expect(out.confirmed).toBeGreaterThanOrEqual(1);
    const st = async (id) => (await pool.query('SELECT status FROM jobs WHERE id = $1', [id])).rows[0].status;
    expect(await st(job.id)).toBe('completed');
    expect(await st(fresh.id)).toBe('in_progress');
  });
});
