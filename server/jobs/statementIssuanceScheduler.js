'use strict';

/**
 * statementIssuanceScheduler — the automatic monthly issuance loop (workstream 1).
 *
 * pollIssuanceCycle({ workerId }) is idempotent and safe to run hourly:
 *  1. Compute the latest closed UTC month. Until ISSUANCE_GRACE_HOURS have
 *     elapsed past month-end, the cycle does nothing for that month (late
 *     postings settle first). The outbox drain still runs.
 *  2. Per product (oxsteed, restaurant): get-or-create the open run for the
 *     month. A paused run is respected: no discovery, no claiming.
 *  3. While the run is 'discovering', scan accounts in bounded cursor batches
 *     (500), create one job per eligible (account, currency) scope, and record
 *     policy skips as dead_letter job rows with their reason. The scan is
 *     idempotent, so a crashed pass simply rescans. When a full pass finds
 *     nothing new, the run moves to 'running'. Missed accounts (created
 *     mid-cycle, reactivated after a skip) are picked up by the catch-up route.
 *  4. Claim up to MAX_JOBS_PER_CYCLE jobs and issue each via
 *     statementIssuanceService.issueAccountStatement.
 *  5. When no non-terminal jobs remain, close the run.
 *  6. Drain `statement.ready` outbox events into localized in-app + email
 *     notifications (artifact must be ready/verified first).
 *
 * Wire-up (NOT done here; the coordinator owns mounts):
 *   server/workerMain.js — add to TRACKING_WORKER_SCHEDULE:
 *     ['statementIssuance', pollIssuanceCycle, 60 * 60 * 1000, { workerId: 'worker-main-statement-issuance' }],
 *   with: const { pollIssuanceCycle } = require('./jobs/statementIssuanceScheduler');
 */

const pool = require('../db');
const logger = require('../utils/logger');
const jobs = require('../services/statementJobService');
const policy = require('../services/statementIssuancePolicy');
const issuance = require('../services/statementIssuanceService');

const OPEN_RUN_STATES = ['discovering', 'running', 'paused'];

async function findOpenRun(product, periodFrom, periodTo) {
  const { rows: [run] } = await pool.query(
    `SELECT * FROM statement_issuance_runs
     WHERE product = $1 AND period_from = $2 AND period_to = $3
       AND state = ANY($4)
     ORDER BY created_at DESC
     LIMIT 1`,
    [product, periodFrom, periodTo, OPEN_RUN_STATES]);
  return run || null;
}

async function findAnyRun(product, periodFrom, periodTo) {
  const { rows: [run] } = await pool.query(
    `SELECT * FROM statement_issuance_runs
     WHERE product = $1 AND period_from = $2 AND period_to = $3
     ORDER BY created_at DESC
     LIMIT 1`,
    [product, periodFrom, periodTo]);
  return run || null;
}

/**
 * One full discovery pass over the product's account tables. Bounded batches,
 * idempotent inserts: re-running after a crash converges without duplicates.
 * Returns { discovered, skipped, revived }.
 */
async function runDiscoveryPass(run) {
  const periodFrom = run.period_from instanceof Date
    ? run.period_from.toISOString().slice(0, 10) : String(run.period_from);
  const periodTo = run.period_to instanceof Date
    ? run.period_to.toISOString().slice(0, 10) : String(run.period_to);
  let cursor = null;
  let discovered = 0;
  let skipped = 0;
  let revived = 0;
  for (;;) {
    const { eligible, skipped: batchSkipped, nextCursor } = await issuance.discoverEligibleAccounts({
      product: run.product,
      periodFrom,
      periodTo,
      batchSize: policy.DISCOVERY_BATCH_SIZE,
      cursor,
    });
    // Reactivated accounts first: a recorded skip must not block a job for an
    // account that became eligible again before the run closed.
    revived += await issuance.reviveEligibleSkips(run.id, eligible);
    if (eligible.length > 0) {
      discovered += await jobs.discoverAccountJobs(run.id, eligible);
    }
    skipped += await issuance.recordSkippedJobs(run.id, batchSkipped);
    if (!nextCursor) break;
    cursor = nextCursor;
  }
  return { discovered, skipped, revived };
}

async function markRunRunning(runId) {
  const { rows: [run] } = await pool.query(
    `UPDATE statement_issuance_runs
     SET state = 'running', updated_at = transaction_timestamp()
     WHERE id = $1 AND state = 'discovering'
     RETURNING *`,
    [runId]);
  return run || null;
}

async function maybeCompleteRun(runId) {
  const { rows: [{ open }] } = await pool.query(
    `SELECT COUNT(*)::int AS open FROM statement_account_jobs
     WHERE run_id = $1 AND state NOT IN ('complete', 'dead_letter')`,
    [runId]);
  if (open !== 0) return null;
  const { rows: [run] } = await pool.query(
    `UPDATE statement_issuance_runs
     SET state = 'complete', completed_at = transaction_timestamp(),
         updated_at = transaction_timestamp()
     WHERE id = $1 AND state = ANY($2)
     RETURNING *`,
    [runId, ['discovering', 'running']]);
  return run || null;
}

async function issueClaimedJobs(run, workerId, maxJobs = policy.MAX_JOBS_PER_CYCLE) {
  let issued = 0;
  let failed = 0;
  for (let n = 0; n < maxJobs; n += 1) {
    // Claims are global across runs: a job from a concurrent manual run is
    // still safe to issue here (issuance is product/account/currency scoped
    // and fully idempotent), so the cycle issues whatever it wins.
    const job = await jobs.claimNextAccountJob(workerId);
    if (!job) break;
    try {
      await issuance.issueAccountStatement({ job, workerId });
      issued += 1;
    } catch (error) {
      // issueAccountStatement already recorded the failure on the job row
      // (failJob) unless the lease went stale, in which case there is nothing
      // honest left to do for this job in this cycle.
      failed += 1;
      logger.warn('statement issuance job failed in scheduler cycle', {
        jobId: job.id,
        issuanceKey: job.issuance_key,
        error: String((error && error.message) || error).slice(0, 500),
      });
    }
  }
  return { issued, failed };
}

async function processProductCycle(product, period, workerId, maxJobsPerProduct) {
  const summary = { product, period, runId: null, runState: null, discovered: 0, skipped: 0, revived: 0, issued: 0, failed: 0, completed: false };
  let run = await findOpenRun(product, period.from, period.to);
  if (!run) {
    if (await findAnyRun(product, period.from, period.to)) {
      // A terminal run already exists for this month: the month is done.
      // Never silently open a second run for the same period.
      summary.runState = 'already-complete';
      return summary;
    }
    run = await jobs.createRun({ product, periodFrom: period.from, periodTo: period.to });
    logger.info('statement issuance run created', { runId: run.id, product, period });
  }
  summary.runId = run.id;

  if (run.state === 'paused') {
    // Pause is respected: no discovery, no claiming. The outbox drain below
    // still runs so already-issued statements keep their notifications.
    summary.runState = 'paused';
    return summary;
  }

  if (run.state === 'discovering') {
    const pass = await runDiscoveryPass(run);
    summary.discovered = pass.discovered;
    summary.skipped = pass.skipped;
    summary.revived = pass.revived;
    if (pass.discovered === 0 && pass.skipped === 0 && pass.revived === 0) {
      // A full scan that recorded nothing new: discovery is complete.
      await markRunRunning(run.id);
      run.state = 'running';
    }
  }

  const claimed = await issueClaimedJobs(
    run,
    workerId,
    maxJobsPerProduct === undefined ? policy.MAX_JOBS_PER_CYCLE : maxJobsPerProduct,
  );
  summary.issued = claimed.issued;
  summary.failed = claimed.failed;

  const completed = await maybeCompleteRun(run.id);
  if (completed) {
    summary.completed = true;
    summary.runState = 'complete';
  } else {
    const { rows: [current] } = await pool.query(
      'SELECT state FROM statement_issuance_runs WHERE id = $1', [run.id]);
    summary.runState = current ? current.state : run.state;
  }
  return summary;
}

/**
 * One scheduler cycle. `now` is injectable for tests. Always drains the
 * statement.ready outbox, even when the grace period has not elapsed or every
 * run is paused: notifications for already-issued statements must not stall.
 */
async function pollIssuanceCycle({ workerId, now = new Date(), maxJobsPerProduct } = {}) {
  if (!workerId || typeof workerId !== 'string') {
    throw new Error('pollIssuanceCycle requires a workerId');
  }
  const reference = now instanceof Date ? now : new Date(now);
  const period = issuance.latestClosedMonthPeriod(reference);
  const summary = {
    workerId,
    period,
    graceElapsed: issuance.issuanceGraceElapsed(period.to, reference),
    products: {},
    outbox: null,
  };
  if (summary.graceElapsed) {
    for (const product of policy.PRODUCTS) {
      try {
        summary.products[product] = await processProductCycle(product, period, workerId, maxJobsPerProduct);
      } catch (error) {
        logger.error('statement issuance product cycle failed', {
          product,
          error: String((error && error.message) || error).slice(0, 500),
        });
        summary.products[product] = { product, period, error: String((error && error.message) || error).slice(0, 200) };
      }
    }
  }
  try {
    summary.outbox = await issuance.processStatementReadyOutbox({ workerId });
  } catch (error) {
    logger.error('statement.ready outbox drain failed', {
      error: String((error && error.message) || error).slice(0, 500),
    });
    summary.outbox = { error: String((error && error.message) || error).slice(0, 200) };
  }
  return summary;
}

module.exports = {
  pollIssuanceCycle,
  runDiscoveryPass,
  findOpenRun,
  maybeCompleteRun,
};
