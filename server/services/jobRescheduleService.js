'use strict';
// Group 4 rest, item 181: job-level reschedule proposals for hired jobs with
// no appointment. Either party (customer or assigned helper) proposes; only
// the other party accepts or declines; the proposer may withdraw. A new
// proposal from the same side supersedes their open one. Accepting
// re-checks the job is still hired and not started, then moves
// jobs.scheduled_time/scheduled_date in the same transaction. Price,
// payment and payout are never touched.
const pool = require('../db');
const { withTransaction } = require('../utils/transaction');
const AppError = require('../utils/appError');
const logger = require('../utils/logger');
const { sendNotification } = require('./notificationService');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_DAYS_AHEAD = 180;

async function loadJob(db, jobId, userId, lock = false) {
  if (!UUID.test(jobId || '')) throw new AppError('Invalid job', 400, 'validation_failed');
  const { rows: [job] } = await db.query(
    `SELECT id, client_id, assigned_helper_id, status, scheduled_time FROM jobs
      WHERE id = $1 AND deleted_at IS NULL${lock ? ' FOR UPDATE' : ''}`, [jobId]);
  const party = job && (String(job.client_id) === String(userId) || String(job.assigned_helper_id) === String(userId));
  if (!job || !party || !job.assigned_helper_id) throw new AppError('Job not found', 404, 'not_found');
  return job;
}

function present(r) {
  return { id: r.id, proposedBy: r.proposed_by, proposedTime: r.proposed_time, previousTime: r.previous_time,
    reason: r.reason, status: r.status, decidedAt: r.decided_at, createdAt: r.created_at };
}

async function notify(userId, type, job, proposalId) {
  try {
    await sendNotification({ userId, type, data: { job_id: job.id, proposal_id: proposalId },
      action_url: `/jobs/${job.id}`, idempotencyKey: `${type}:${proposalId}` });
  } catch (error) {
    logger.warn('Job reschedule notification failed', { jobId: job.id, error: error.message });
  }
}

async function list(userId, jobId) {
  const job = await loadJob(pool, jobId, userId);
  const { rows } = await pool.query('SELECT * FROM job_reschedule_proposals WHERE job_id = $1 ORDER BY created_at DESC LIMIT 50', [job.id]);
  return rows.map(present);
}

async function propose(userId, jobId, body) {
  const when = new Date(body?.proposedTime);
  const reason = body?.reason == null ? null : String(body.reason).trim().slice(0, 1000) || null;
  if (Number.isNaN(when.getTime())) throw new AppError('Validation failed', 400, 'validation_failed', { proposedTime: 'required ISO time' });
  if (when.getTime() <= Date.now() || when.getTime() > Date.now() + MAX_DAYS_AHEAD * 86400000) {
    throw new AppError('Pick a time in the future, within 180 days', 400, 'reschedule_time_out_of_range');
  }
  const out = await withTransaction(pool, async (db) => {
    const job = await loadJob(db, jobId, userId, true);
    if (job.status !== 'accepted') throw new AppError('Only hired jobs that have not started can be rescheduled', 409, 'reschedule_not_allowed');
    const { rows: [appt] } = await db.query(
      "SELECT 1 FROM appointments WHERE job_id = $1 AND status NOT IN ('cancelled','completed','no_show') LIMIT 1", [job.id]);
    if (appt) throw new AppError('This job has an appointment; reschedule the appointment instead', 409, 'use_appointment_reschedule');
    await db.query(
      `UPDATE job_reschedule_proposals SET status = 'superseded', decided_at = NOW()
        WHERE job_id = $1 AND proposed_by = $2 AND status = 'proposed'`, [job.id, userId]);
    const { rows: [row] } = await db.query(
      `INSERT INTO job_reschedule_proposals (job_id, proposed_by, proposed_time, previous_time, reason)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`, [job.id, userId, when.toISOString(), job.scheduled_time, reason]);
    return { job, row };
  }, 'job_reschedule_propose');
  const other = String(out.job.client_id) === String(userId) ? out.job.assigned_helper_id : out.job.client_id;
  await notify(other, 'job_reschedule_proposed', out.job, out.row.id);
  return present(out.row);
}

async function respond(userId, jobId, proposalId, body) {
  const action = body?.action;
  if (!['accept', 'decline', 'withdraw'].includes(action)) throw new AppError('Validation failed', 400, 'validation_failed', { action: 'accept, decline or withdraw' });
  if (!UUID.test(proposalId || '')) throw new AppError('Invalid proposal', 400, 'validation_failed');
  const out = await withTransaction(pool, async (db) => {
    const job = await loadJob(db, jobId, userId, true);
    const { rows: [p] } = await db.query(
      'SELECT * FROM job_reschedule_proposals WHERE id = $1 AND job_id = $2 FOR UPDATE', [proposalId, job.id]);
    if (!p) throw new AppError('Proposal not found', 404, 'not_found');
    if (p.status !== 'proposed') throw new AppError('This proposal is no longer open', 409, 'proposal_closed');
    const mine = String(p.proposed_by) === String(userId);
    if (action === 'withdraw' ? !mine : mine) throw new AppError('Not allowed for this proposal', 403, 'proposal_forbidden');
    if (action === 'accept') {
      if (job.status !== 'accepted') throw new AppError('The job can no longer be rescheduled', 409, 'reschedule_not_allowed');
      if (new Date(p.proposed_time).getTime() <= Date.now()) throw new AppError('The proposed time has passed', 409, 'reschedule_time_passed');
      await db.query(
        `UPDATE jobs SET scheduled_time = $2, scheduled_date = ($2::timestamptz AT TIME ZONE 'UTC')::date, updated_at = NOW()
          WHERE id = $1`, [job.id, p.proposed_time]);
    }
    const status = { accept: 'accepted', decline: 'declined', withdraw: 'withdrawn' }[action];
    const { rows: [row] } = await db.query(
      `UPDATE job_reschedule_proposals SET status = $2, decided_by = $3, decided_at = NOW() WHERE id = $1 RETURNING *`,
      [p.id, status, userId]);
    return { job, row };
  }, 'job_reschedule_respond');
  if (action !== 'withdraw') await notify(out.row.proposed_by, `job_reschedule_${out.row.status}`, out.job, out.row.id);
  return present(out.row);
}

module.exports = { list, propose, respond };
