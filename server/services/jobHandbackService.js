'use strict';
// Group 4 rest, item 184: replacement handoff. The assigned helper hands a
// hired job back before it starts, with a reason; the job reopens
// (status 'published', no helper) so the customer can hire a replacement.
//
// Rules (server-side):
//   - only the assigned helper, only status 'accepted', not arrived, and
//     before the scheduled start (when the job has one);
//   - no money moves: refused (409 handback_money_on_job) when the job has
//     any live payment row, a held Credit payment, Credit collateral, or a
//     confirmed off-platform payment; those cases use cancel or support;
//   - refused when the work agreement is already active/completed (both
//     signed): that is a cancellation, not a hand-back;
//   - the helper's bid becomes 'withdrawn'; bids that were auto-rejected by
//     this hire (same transaction timestamp as the accepted bid) go back to
//     'pending' so the customer can pick a replacement from them;
//   - the linked appointment is cancelled (by 'helper') and detached from
//     the job so a new hire can create its own; open reschedule proposals
//     are withdrawn; the payment rail lock is cleared;
//   - the customer is notified; the hand-back is recorded in job_handbacks.
const pool = require('../db');
const { withTransaction } = require('../utils/transaction');
const AppError = require('../utils/appError');
const logger = require('../utils/logger');
const { sendNotification } = require('./notificationService');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REASONS = ['schedule_conflict', 'illness', 'outside_skills', 'travel', 'other'];

async function moneyOnJob(db, job) {
  const { rows: [p] } = await db.query(
    `SELECT 1 FROM payments WHERE job_id = $1
        AND status::text NOT IN ('failed', 'canceled', 'cancelled', 'refunded', 'expired') LIMIT 1`, [job.id]);
  if (p) return 'payment';
  const { rows: [c] } = await db.query(
    "SELECT 1 FROM job_credit_payments WHERE job_id = $1 AND status IN ('held', 'captured') LIMIT 1", [job.id]);
  if (c) return 'credit_payment';
  if (job.metadata && job.metadata.creditCollateralHoldId) return 'credit_collateral';
  const { rows: [o] } = await db.query(
    `SELECT 1 FROM offline_payment_confirmations WHERE job_id = $1
        AND (customer_confirmed_at IS NOT NULL OR helper_confirmed_at IS NOT NULL) LIMIT 1`, [job.id]);
  if (o) return 'offline_payment_confirmed';
  return null;
}

async function startOf(db, job) {
  const { rows: [a] } = await db.query(
    `SELECT MIN(scheduled_start_time) AS start FROM appointments
      WHERE job_id = $1 AND status NOT IN ('cancelled', 'completed', 'no_show')`, [job.id]);
  return a?.start || job.scheduled_time || null;
}

async function handBack(userId, jobId, body = {}) {
  if (!UUID.test(jobId || '')) throw new AppError('Invalid job', 400, 'validation_failed');
  const reasonCode = body.reasonCode;
  if (!REASONS.includes(reasonCode)) throw new AppError('Validation failed', 400, 'validation_failed', { reasonCode: REASONS.join(', ') });
  const note = body.note == null ? null : String(body.note).trim().slice(0, 1000) || null;
  if (reasonCode === 'other' && !note) throw new AppError('Validation failed', 400, 'validation_failed', { note: 'required for other' });

  const out = await withTransaction(pool, async (db) => {
    const { rows: [job] } = await db.query(
      `SELECT id, client_id, assigned_helper_id, status, arrived_at, scheduled_time, metadata, title
         FROM jobs WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`, [jobId]);
    if (!job || String(job.assigned_helper_id) !== String(userId)) throw new AppError('Job not found', 404, 'not_found');
    if (job.status !== 'accepted' || job.arrived_at) {
      throw new AppError('Only hired jobs that have not started can be handed back', 409, 'handback_not_allowed');
    }
    const start = await startOf(db, job);
    if (start && new Date(start).getTime() <= Date.now()) {
      throw new AppError('The job start time has passed; cancel or contact support instead', 409, 'handback_after_start');
    }
    const money = await moneyOnJob(db, job);
    if (money) throw new AppError('Money is already attached to this job; cancel or contact support instead', 409, 'handback_money_on_job', { money });
    const { rows: [signed] } = await db.query(
      "SELECT 1 FROM work_agreements WHERE job_id = $1 AND helper_id = $2 AND status IN ('active', 'completed') LIMIT 1", [job.id, userId]);
    if (signed) throw new AppError('The work agreement is signed; cancel the job instead', 409, 'handback_agreement_signed');

    // The hire stamps the accepted bid and auto-rejects the others with the
    // same transaction NOW(), so that timestamp identifies them.
    const { rows: [bid] } = await db.query(
      `SELECT id, updated_at AS hired_at FROM bids
        WHERE job_id = $1 AND helper_id = $2 AND status = 'accepted' FOR UPDATE`, [job.id, userId]);
    let reopened = 0;
    if (bid) {
      await db.query("UPDATE bids SET status = 'withdrawn', updated_at = NOW() WHERE id = $1", [bid.id]);
      const r = await db.query(
        `UPDATE bids SET status = 'pending', updated_at = NOW()
          WHERE job_id = $1 AND helper_id <> $2 AND status = 'rejected' AND updated_at = $3`,
        [job.id, userId, bid.hired_at]);
      reopened = r.rowCount;
    }
    const { rows: [appt] } = await db.query(
      `UPDATE appointments SET status = 'cancelled', cancelled_by = 'helper', cancelled_at = NOW(),
              cancellation_reason = 'helper_handback', job_id = NULL, updated_at = NOW()
        WHERE job_id = $1 AND status NOT IN ('completed', 'no_show') RETURNING id`, [job.id]);
    await db.query(
      `UPDATE job_reschedule_proposals SET status = 'withdrawn', decided_by = $2, decided_at = NOW()
        WHERE job_id = $1 AND status = 'proposed'`, [job.id, userId]);
    const { rowCount } = await db.query(
      `UPDATE jobs SET status = 'published', assigned_helper_id = NULL, payment_rail = NULL,
              payment_rail_locked_at = NULL, updated_at = NOW()
        WHERE id = $1 AND status = 'accepted' AND assigned_helper_id = $2`, [job.id, userId]);
    if (!rowCount) throw new AppError('The job changed; reload and try again', 409, 'state_conflict');
    const { rows: [row] } = await db.query(
      `INSERT INTO job_handbacks (job_id, helper_id, bid_id, appointment_id, reason_code, note, reopened_bid_count)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [job.id, userId, bid?.id || null, appt?.id || null, reasonCode, note, reopened]);
    return { job, row };
  }, 'job_handback');

  try {
    await sendNotification({ userId: out.job.client_id, type: 'job_handed_back',
      data: { job_id: out.job.id, reason_code: reasonCode, reopened_bids: out.row.reopened_bid_count },
      action_url: `/jobs/${out.job.id}`, idempotencyKey: `job-handback:${out.row.id}` });
  } catch (error) {
    logger.warn('Hand-back notification failed', { jobId: out.job.id, error: error.message });
  }
  return { id: out.row.id, jobId: out.job.id, reasonCode, reopenedBidCount: out.row.reopened_bid_count, createdAt: out.row.created_at };
}

module.exports = { handBack, REASONS };
