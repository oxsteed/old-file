'use strict';

// Group 9 Slice G (item 500): driver shifts and shift closeout.
//
// A shift is the driver's availability window: start shift / end
// shift. The closeout is an explicit driver action that summarizes
// the shift — jobs completed in the window, distance, pieces, worked
// minutes (pickup to delivery), earnings accrued, exceptions raised —
// and closes the shift with a closeout summary the driver can review
// later. The rollup reads the existing rows (jobs, payouts, issues)
// the same way the weekly report does (deliveryWeeklyReportService),
// but scoped to the shift window instead of a calendar week, and
// stored as its own record, not a weekly report (D-95).
//
// A driver has at most one open shift (D-93): the partial unique
// index on delivery_driver_shifts enforces it, and startShift 409s
// when one is already open. Closeout refuses, with the list, while
// the driver still has an active in-progress job (D-94): closing a
// shift must never strand a job. Open issues do not block closeout,
// but they must be explicitly confirmed (confirmOpenIssues) — the
// closeout summary records them either way, so nothing is silently
// closed over. Closing a shift never deletes history, payouts, or
// receipts; the closeout is a summary row.

const AppError = require('../utils/appError');

const ACTIVE_JOB_STATUSES = ['assigned', 'picked_up', 'in_transit'];

function shiftError(code, message, status, fields) {
  return new AppError(message, status, code, fields || {});
}

function serializeShift(row) {
  if (!row) return null;
  return {
    id: row.id,
    driverUserId: row.driver_user_id,
    status: row.status,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    closeoutSummary: row.closeout_summary || {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function startShift(db, driverUserId) {
  const { rows: [existing] } = await db.query(
    'SELECT id FROM delivery_driver_shifts WHERE driver_user_id = $1 AND status = $2',
    [driverUserId, 'open'],
  );
  if (existing) {
    throw shiftError('delivery_shift_already_open', 'You already have an open shift', 409, { shiftId: existing.id });
  }
  const { rows: [shift] } = await db.query(
    `INSERT INTO delivery_driver_shifts (driver_user_id, status)
     VALUES ($1, 'open') RETURNING *`,
    [driverUserId],
  );
  return serializeShift(shift);
}

async function getOpenShift(db, driverUserId) {
  const { rows: [shift] } = await db.query(
    `SELECT * FROM delivery_driver_shifts
      WHERE driver_user_id = $1 AND status = $2
      ORDER BY started_at DESC, id DESC LIMIT 1`,
    [driverUserId, 'open'],
  );
  return serializeShift(shift);
}

async function listShifts(db, driverUserId, limit = 20) {
  const { rows } = await db.query(
    `SELECT * FROM delivery_driver_shifts
      WHERE driver_user_id = $1
      ORDER BY started_at DESC, id DESC LIMIT $2`,
    [driverUserId, Math.min(100, Math.max(1, Number(limit) || 20))],
  );
  return rows.map(serializeShift);
}

async function getShift(db, driverUserId, shiftId) {
  const { rows: [shift] } = await db.query(
    'SELECT * FROM delivery_driver_shifts WHERE id = $1 AND driver_user_id = $2',
    [shiftId, driverUserId],
  );
  if (!shift) throw shiftError('delivery_shift_not_found', 'Shift not found', 404);
  return serializeShift(shift);
}

// The closeout rollup for [startedAt, endedAt]: jobs the driver
// completed in the window, payouts accrued in the window, exceptions
// the driver raised in the window, plus the open items that decide
// whether closeout may proceed — active in-progress jobs (block),
// in-transit jobs with no proof yet (a subset of the active jobs,
// listed separately so the driver sees why the proof is still open),
// and issues raised during the shift that are still open (confirm).
async function buildShiftSummary(db, driverUserId, startedAt, endedAt) {
  const { rows: jobs } = await db.query(
    `SELECT id, reference, status, distance_miles, pieces,
            picked_up_at, delivered_at, driver_payout_cents,
            origin_city, destination_city
       FROM delivery_jobs
      WHERE (helper_user_id = $1 OR internal_driver_user_id = $1)
        AND status = 'delivered'
        AND delivered_at >= $2 AND delivered_at <= $3
      ORDER BY delivered_at ASC, id ASC`,
    [driverUserId, startedAt, endedAt],
  );
  const { rows: [payouts] } = await db.query(
    `SELECT COALESCE(SUM(payout_cents), 0)::int AS cents, COUNT(*)::int AS count
       FROM delivery_driver_payouts
      WHERE driver_user_id = $1
        AND created_at >= $2 AND created_at <= $3`,
    [driverUserId, startedAt, endedAt],
  );
  const { rows: exceptions } = await db.query(
    `SELECT i.id, i.code, i.description, i.status, i.delivery_job_id,
            j.reference AS job_reference
       FROM delivery_issues i
       JOIN delivery_jobs j ON j.id = i.delivery_job_id
      WHERE (j.helper_user_id = $1 OR j.internal_driver_user_id = $1)
        AND i.created_at >= $2 AND i.created_at <= $3
      ORDER BY i.created_at ASC, i.id ASC`,
    [driverUserId, startedAt, endedAt],
  );
  const { rows: activeJobs } = await db.query(
    `SELECT id, reference, status, origin_city, destination_city
       FROM delivery_jobs
      WHERE (helper_user_id = $1 OR internal_driver_user_id = $1)
        AND status::text = ANY($2::text[])
      ORDER BY created_at ASC, id ASC`,
    [driverUserId, ACTIVE_JOB_STATUSES],
  );
  const openIssues = exceptions.filter((issue) => issue.status === 'open');
  const unsubmittedProofJobs = activeJobs.filter((job) => job.status === 'in_transit');

  const jobsCompleted = jobs.length;
  const distanceMiles = jobs.reduce((sum, job) => sum + Number(job.distance_miles || 0), 0);
  const pieces = jobs.reduce((sum, job) => sum + Number(job.pieces || 0), 0);
  const workedMinutes = jobs.reduce((sum, job) => {
    if (!job.picked_up_at || !job.delivered_at) return sum;
    return sum + Math.max(0, Math.round((new Date(job.delivered_at) - new Date(job.picked_up_at)) / 60000));
  }, 0);

  return {
    jobsCompleted,
    distanceMiles: Math.round(distanceMiles * 100) / 100,
    pieces,
    workedMinutes,
    earningsAccruedCents: payouts?.cents || 0,
    payoutsCount: payouts?.count || 0,
    exceptionsCount: exceptions.length,
    exceptions: exceptions.map((issue) => ({
      id: issue.id, code: issue.code, description: issue.description,
      status: issue.status, jobId: issue.delivery_job_id, jobReference: issue.job_reference,
    })),
    openIssues: openIssues.map((issue) => ({
      id: issue.id, code: issue.code, description: issue.description,
      jobId: issue.delivery_job_id, jobReference: issue.job_reference,
    })),
    activeJobs: activeJobs.map((job) => ({
      id: job.id, reference: job.reference, status: job.status,
      originCity: job.origin_city, destinationCity: job.destination_city,
    })),
    unsubmittedProofJobs: unsubmittedProofJobs.map((job) => ({
      id: job.id, reference: job.reference, status: job.status,
    })),
    jobs: jobs.map((job) => ({
      id: job.id, reference: job.reference,
      originCity: job.origin_city, destinationCity: job.destination_city,
      distanceMiles: job.distance_miles == null ? null : Number(job.distance_miles),
      pieces: job.pieces, deliveredAt: job.delivered_at,
      driverPayoutCents: Number(job.driver_payout_cents || 0),
    })),
  };
}

async function closeShift(db, driverUserId, shiftId, { confirmOpenIssues = false } = {}) {
  const endedAt = new Date();
  const { rows: [shift] } = await db.query(
    'SELECT * FROM delivery_driver_shifts WHERE id = $1 AND driver_user_id = $2 FOR UPDATE',
    [shiftId, driverUserId],
  );
  if (!shift) throw shiftError('delivery_shift_not_found', 'Shift not found', 404);
  if (shift.status !== 'open') throw shiftError('delivery_shift_already_closed', 'This shift is already closed', 409, { shiftId: shift.id });

  const summary = await buildShiftSummary(db, driverUserId, shift.started_at, endedAt);
  if (summary.activeJobs.length > 0) {
    throw shiftError(
      'delivery_shift_active_job',
      'Closeout is blocked: you still have jobs in progress',
      409,
      { activeJobs: summary.activeJobs, unsubmittedProofJobs: summary.unsubmittedProofJobs },
    );
  }
  if (summary.openIssues.length > 0 && confirmOpenIssues !== true) {
    throw shiftError(
      'delivery_shift_open_issues',
      'You still have open issues from this shift. Confirm them to close the shift.',
      409,
      { openIssues: summary.openIssues },
    );
  }

  const closeoutSummary = {
    ...summary,
    closedAt: endedAt.toISOString(),
    openIssuesConfirmed: summary.openIssues.length > 0,
  };
  const { rows: [closed] } = await db.query(
    `UPDATE delivery_driver_shifts
        SET status = 'closed', ended_at = $2, closeout_summary = $3::jsonb, updated_at = NOW()
      WHERE id = $1 RETURNING *`,
    [shift.id, endedAt, JSON.stringify(closeoutSummary)],
  );
  return serializeShift(closed);
}

module.exports = {
  ACTIVE_JOB_STATUSES,
  startShift,
  getOpenShift,
  listShifts,
  getShift,
  buildShiftSummary,
  closeShift,
};
