'use strict';

// Group 9 Slice F (item 488): the shipment exception summary.
//
// The exception record already exists — issues, returns, reschedule
// requests, failed dispatch attempts, the automated delay escalation,
// and the pickup piece-count mismatch — but it was scattered across
// four reads (detail page, dispatch review, tracking review queue),
// so nobody could see one shipment's whole exception story, or the
// open exceptions across shipments, in one place. This service only
// READS those stores into two views; it creates no second issue store.
//
// Per shipment: one timeline, newest first, mixing issues, returns,
// reschedule requests, failed dispatch attempts, delay escalations,
// and the pickup mismatch flag, plus the job-level exception state.
// Aggregate (ops): open issues grouped by code with the oldest open
// age per code, and the open-exception jobs with their latest open
// issue, so dispatch can work the oldest exception first.

async function getJobExceptionSummary(db, jobId) {
  const { rows: [job] } = await db.query(
    `SELECT id, reference, status, dispatch_state, exception_code,
            delay_escalated_at, pickup_pieces_mismatch,
            pickup_confirmed_pieces, pieces
       FROM delivery_jobs WHERE id = $1`,
    [jobId],
  );
  if (!job) return null;

  const [issues, returns, reschedules, attempts, escalations] = await Promise.all([
    db.query(
      `SELECT id, code, description, metadata, status, resolution,
              created_at, resolved_at, support_ticket_id
         FROM delivery_issues WHERE delivery_job_id = $1 ORDER BY created_at DESC, id DESC`,
      [jobId],
    ),
    db.query(
      `SELECT id, reason, status, completed_at, created_at
         FROM delivery_returns WHERE delivery_job_id = $1 ORDER BY created_at DESC, id DESC`,
      [jobId],
    ),
    db.query(
      `SELECT id, reason, status, reviewed_at, created_at
         FROM delivery_reschedule_requests WHERE delivery_job_id = $1 ORDER BY created_at DESC, id DESC`,
      [jobId],
    ),
    db.query(
      `SELECT id, action, reason, created_at
         FROM delivery_dispatch_attempts
        WHERE delivery_job_id = $1 AND action = 'assignment_failed'
        ORDER BY created_at DESC, id DESC`,
      [jobId],
    ),
    db.query(
      `SELECT id, payload, created_at FROM delivery_activity
        WHERE delivery_job_id = $1 AND event_type = 'delivery_delay_escalated'
        ORDER BY created_at DESC, id DESC`,
      [jobId],
    ),
  ]);

  const events = [];
  for (const issue of issues.rows) {
    events.push({
      kind: 'issue', id: `issue-${issue.id}`, at: issue.created_at,
      code: issue.code, description: issue.description, metadata: issue.metadata || {},
      status: issue.status, resolution: issue.resolution, resolvedAt: issue.resolved_at,
      supportTicketId: issue.support_ticket_id,
    });
  }
  for (const ret of returns.rows) {
    events.push({
      kind: 'return', id: `return-${ret.id}`, at: ret.created_at,
      reason: ret.reason, status: ret.status, completedAt: ret.completed_at,
    });
  }
  for (const req of reschedules.rows) {
    events.push({
      kind: 'reschedule', id: `reschedule-${req.id}`, at: req.created_at,
      reason: req.reason, status: req.status, reviewedAt: req.reviewed_at,
    });
  }
  for (const attempt of attempts.rows) {
    events.push({
      kind: 'failed_attempt', id: `attempt-${attempt.id}`, at: attempt.created_at,
      action: attempt.action, reason: attempt.reason, status: 'failed',
    });
  }
  for (const escalation of escalations.rows) {
    events.push({
      kind: 'delay_escalation', id: `escalation-${escalation.id}`, at: escalation.created_at,
      code: 'delay', status: 'open', payload: escalation.payload || {},
    });
  }
  if (job.pickup_pieces_mismatch) {
    events.push({
      kind: 'pickup_mismatch', id: 'pickup-mismatch', at: null,
      code: 'pickup_pieces_mismatch', status: 'open',
      description: `Pickup confirmed ${job.pickup_confirmed_pieces} pieces against ${job.pieces} booked.`,
    });
  }
  events.sort((a, b) => {
    const aTime = a.at ? new Date(a.at).getTime() : 0;
    const bTime = b.at ? new Date(b.at).getTime() : 0;
    return bTime - aTime;
  });

  const openIssues = issues.rows.filter((issue) => issue.status === 'open').length;
  return {
    job: {
      id: job.id, reference: job.reference, status: job.status,
      dispatchState: job.dispatch_state, exceptionCode: job.exception_code,
      delayEscalatedAt: job.delay_escalated_at,
      pickupPiecesMismatch: Boolean(job.pickup_pieces_mismatch),
    },
    openCount: openIssues
      + returns.rows.filter((ret) => ['requested', 'approved', 'in_transit'].includes(ret.status)).length
      + reschedules.rows.filter((req) => req.status === 'pending').length,
    events,
  };
}

async function getOpsExceptionSummary(db) {
  const { rows: byCode } = await db.query(
    `SELECT code,
            COUNT(*)::int AS open_count,
            MIN(created_at) AS oldest_open_at,
            MAX(created_at) AS newest_open_at
       FROM delivery_issues
      WHERE status = 'open'
      GROUP BY code
      ORDER BY open_count DESC, oldest_open_at ASC`,
  );
  const { rows: jobs } = await db.query(
    `SELECT j.id, j.reference, j.status, j.dispatch_state, j.exception_code,
            j.delay_escalated_at, j.created_at,
            (SELECT i.code FROM delivery_issues i
              WHERE i.delivery_job_id = j.id AND i.status = 'open'
              ORDER BY i.created_at DESC, i.id DESC LIMIT 1) AS latest_open_issue_code,
            (SELECT i.created_at FROM delivery_issues i
              WHERE i.delivery_job_id = j.id AND i.status = 'open'
              ORDER BY i.created_at ASC, i.id ASC LIMIT 1) AS oldest_open_issue_at,
            (SELECT COUNT(*)::int FROM delivery_issues i
              WHERE i.delivery_job_id = j.id AND i.status = 'open') AS open_issue_count
       FROM delivery_jobs j
      WHERE j.dispatch_state = 'exception'
         OR EXISTS (SELECT 1 FROM delivery_issues i
                     WHERE i.delivery_job_id = j.id AND i.status = 'open')
      ORDER BY oldest_open_issue_at ASC NULLS LAST, j.created_at ASC
      LIMIT 100`,
  );
  const { rows: [delayed] } = await db.query(
    `SELECT COUNT(*)::int AS count FROM delivery_jobs
      WHERE delay_escalated_at IS NOT NULL
        AND status IN ('assigned', 'picked_up', 'in_transit')`,
  );
  return {
    byCode: byCode.map((row) => ({
      code: row.code,
      openCount: row.open_count,
      oldestOpenAt: row.oldest_open_at,
      newestOpenAt: row.newest_open_at,
    })),
    jobs: jobs.map((row) => ({
      id: row.id, reference: row.reference, status: row.status,
      dispatchState: row.dispatch_state, exceptionCode: row.exception_code,
      delayEscalatedAt: row.delay_escalated_at,
      latestOpenIssueCode: row.latest_open_issue_code,
      oldestOpenIssueAt: row.oldest_open_issue_at,
      openIssueCount: row.open_issue_count,
    })),
    delayedActiveCount: delayed?.count || 0,
  };
}

module.exports = { getJobExceptionSummary, getOpsExceptionSummary };
