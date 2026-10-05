'use strict';

/**
 * statementIssuanceScheduler — the automatic monthly issuance loop (workstream 1).
 *
 * pollIssuanceCycle({ workerId }) is idempotent and safe to run hourly:
 *  1. Compute the latest closed UTC month. Until ISSUANCE_GRACE_HOURS have
 *     elapsed past month-end, the cycle does nothing for that month (late
 *     postings settle first). The outbox drain still runs.
 *  2. Across all five products, discover missing months from the approved
 *     activation boundary in bounded batches. Respect paused runs.
 *  3. While the run is 'discovering', scan accounts in bounded cursor batches
 *     (500), create one job per eligible (account, currency) scope, and record
 *     policy skips as dead_letter job rows with their reason. The scan is
 *     idempotent, so a crashed batch can be repeated. Persist the cursor and
 *     phase; exhaustion moves the run to 'running'. Missed accounts (created
 *     mid-cycle, reactivated after a skip) are picked up by the catch-up route.
 *  4. Independently claim up to MAX_JOBS_PER_CYCLE jobs per product, including
 *     older runs, and issue each via
 *     statementIssuanceService.issueAccountStatement.
 *  5. Finish only a fully discovered run with no open jobs. Operational dead
 *     letters make coverage failed; policy skips are counted separately.
 *  6. Drain `statement.ready` outbox events into localized in-app + email
 *     notifications (artifact must be ready/verified first).
 *  7. Drain `statement.amended` outbox events (workstream 3): an approved
 *     statement correction notifies its owner exactly once after publication.
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
const amendments = require('../services/statementAmendmentService');

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
 * One bounded discovery pass over the product's account tables. Bounded batches,
 * idempotent inserts: re-running after a crash converges without duplicates.
 * Returns { discovered, skipped, revived, complete, busy? }.
 */
async function runDiscoveryPass(run) {
  const periodFrom = run.period_from instanceof Date
    ? run.period_from.toISOString().slice(0, 10) : String(run.period_from);
  const periodTo = run.period_to instanceof Date
    ? run.period_to.toISOString().slice(0, 10) : String(run.period_to);
  const client = await pool.connect();
  let locked = false;
  let discovered = 0;
  let skipped = 0;
  let revived = 0;
  let complete = false;
  try {
    // Session lock is short-lived and does not hold an MVCC transaction during
    // source scans. Concurrent scans of one run cannot overwrite its cursor.
    const { rows: [lock] } = await client.query(
      'SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS locked', [`statement-discovery:${run.id}`]);
    locked = lock.locked;
    if (!locked) return { discovered, skipped, revived, complete, busy: true };
    for (let n = 0; n < policy.MAX_DISCOVERY_BATCHES_PER_CYCLE; n += 1) {
      const { rows: [current] } = await client.query(
        'SELECT * FROM statement_issuance_runs WHERE id=$1', [run.id]);
      if (!current || current.state !== 'discovering') break;
      const { eligible, skipped: batchSkipped, nextCursor } = await issuance.discoverEligibleAccounts({
        product: run.product, periodFrom, periodTo,
        batchSize: policy.DISCOVERY_BATCH_SIZE, cursor: current.discovery_cursor,
      });
      // Normalize the legacy revival helper's key input for UUID accounts;
      // discoverAccountJobs still receives the original scope shape.
      revived += await issuance.reviveEligibleSkips(run.id,
        eligible.map((account) => ({ ...account, accountId: account.accountUuid || account.accountId })));
      if (eligible.length > 0) discovered += await jobs.discoverAccountJobs(run.id, eligible);
      skipped += await issuance.recordSkippedJobs(run.id, batchSkipped);
      const { rowCount } = await client.query(
        `UPDATE statement_issuance_runs SET discovery_cursor=$2,
           discovery_phase=CASE WHEN $2::text IS NULL THEN 'running' ELSE 'discovering' END,
           state=CASE WHEN state='discovering' AND $2::text IS NULL THEN 'running' ELSE state END,
           updated_at=transaction_timestamp()
         WHERE id=$1 AND discovery_generation=$3 AND state IN ('discovering','paused')`,
        [run.id, nextCursor || null, current.discovery_generation]);
      if (!rowCount) break; // An explicit catch-up fenced this scan.
      if (!nextCursor) { complete = true; break; }
    }
  } finally {
    try {
      if (locked) await client.query('SELECT pg_advisory_unlock(hashtextextended($1, 0))',
        [`statement-discovery:${run.id}`]);
    } finally { client.release(); }
  }
  return { discovered, skipped, revived, complete };
}

async function maybeCompleteRun(runId) {
  // Lock before counting, so a retry that committed while we waited is visible
  // to this statement's fresh READ COMMITTED snapshot.
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT id FROM statement_issuance_runs WHERE id=$1 FOR UPDATE', [runId]);
    const { rows: [run] } = await client.query(
    `UPDATE statement_issuance_runs
     SET state = CASE WHEN EXISTS (SELECT 1 FROM statement_account_jobs j
                        WHERE j.run_id=$1 AND j.state='dead_letter'
                          AND COALESCE(j.last_error,'') NOT LIKE 'skip:%')
                      THEN 'failed' ELSE 'complete' END,
         completed_at = transaction_timestamp(),
         updated_at = transaction_timestamp()
     WHERE id = $1 AND state = 'running' AND discovery_phase='running'
       AND NOT EXISTS (SELECT 1 FROM statement_account_jobs j
                       WHERE j.run_id=$1 AND j.state NOT IN ('complete','dead_letter'))
     RETURNING *`,
    [runId]);
    await client.query('COMMIT');
    return run || null;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}

async function issueClaimedJobs(product, workerId, maxJobs = policy.MAX_JOBS_PER_CYCLE) {
  let issued = 0;
  let failed = 0;
  for (let n = 0; n < maxJobs; n += 1) {
    // Old and manual runs share the same per-product queue budget.
    const job = await jobs.claimNextAccountJob(workerId, 120, { product });
    if (!job) break;
    if (job.state === 'dead_letter') { failed += 1; continue; }
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

async function processProductCycle(product, period) {
  const summary = { product, period, runId: null, runState: null, discovered: 0, skipped: 0, revived: 0, issued: 0, failed: 0, completed: false };
  let run = await findOpenRun(product, period.from, period.to);
  if (!run) {
    if (await findAnyRun(product, period.from, period.to)) {
      // A terminal run already exists for this month: the month is done.
      // Never silently open a second run for the same period.
      summary.runState = 'already-complete';
      return summary;
    }
    run = await jobs.createRun({ product, periodFrom: period.from, periodTo: period.to, reuseExisting: true });
    logger.info('statement issuance run created', { runId: run.id, product, period });
  }
  summary.runId = run.id;

  if (run.state === 'paused') {
    // Pause is respected; notifications for already-issued statements continue.
    summary.runState = 'paused';
    return summary;
  }

  if (run.state === 'discovering') {
    const pass = await runDiscoveryPass(run);
    summary.discovered = pass.discovered;
    summary.skipped = pass.skipped;
    summary.revived = pass.revived;
  }

  const completed = await maybeCompleteRun(run.id);
  if (completed) {
    summary.completed = completed.state === 'complete';
    summary.runState = completed.state;
  } else {
    const { rows: [current] } = await pool.query(
      'SELECT state FROM statement_issuance_runs WHERE id = $1', [run.id]);
    summary.runState = current ? current.state : run.state;
  }
  return summary;
}

async function discoverMissedPeriods(product, latest, activation) {
  if (!activation || activation > latest.from) return;
  const { rows } = await pool.query(
    `SELECT month::date AS period_from, (month + interval '1 month - 1 day')::date AS period_to
     FROM generate_series($2::date, $3::date, interval '1 month') AS month
     WHERE NOT EXISTS (SELECT 1 FROM statement_issuance_runs r
       WHERE r.product=$1 AND r.period_from=month::date
         AND r.period_to=(month + interval '1 month - 1 day')::date)
     ORDER BY month LIMIT $4`,
    [product, activation, latest.from, policy.MAX_PERIODS_PER_PRODUCT_CYCLE]);
  for (const row of rows) {
    await jobs.createRun({ product, periodFrom: dateText(row.period_from),
      periodTo: dateText(row.period_to), reuseExisting: true });
  }
}

function dateText(value) {
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value);
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
  let activation = null;
  try { activation = policy.activationMonth(); }
  catch (error) { summary.activationError = error.message; }
  summary.activationMonth = activation;
  const approvedLatest = summary.graceElapsed ? period : issuance.latestClosedMonthPeriod(
    new Date(`${period.from}T00:00:00Z`));
    for (const product of policy.PRODUCTS) {
      try {
        await discoverMissedPeriods(product, approvedLatest, activation);
        const { rows: runs } = await pool.query(
          `SELECT * FROM statement_issuance_runs WHERE product=$1 AND state IN ('discovering','running')
           ORDER BY period_from, created_at, id LIMIT $2`,
          [product, policy.MAX_PERIODS_PER_PRODUCT_CYCLE]);
        summary.products[product] = [];
        for (const run of runs) {
          summary.products[product].push(await processProductCycle(product,
            { from: dateText(run.period_from), to: dateText(run.period_to) }));
        }
      } catch (error) {
        logger.error('statement issuance product cycle failed', {
          product,
          error: String((error && error.message) || error).slice(0, 500),
        });
        summary.products[product] = { product, period, error: String((error && error.message) || error).slice(0, 200) };
      }
    }
  // Drain globally, even if all current runs are terminal or rollout is not
  // configured. Per-run pause still gates claims. The budget stays bounded.
  const perProduct = maxJobsPerProduct === undefined ? policy.MAX_JOBS_PER_CYCLE : maxJobsPerProduct;
  if (!Number.isSafeInteger(perProduct) || perProduct < 0 || perProduct > policy.MAX_JOBS_PER_CYCLE) {
    throw new Error('maxJobsPerProduct exceeds the statement cycle budget');
  }
  summary.jobs = { issued: 0, failed: 0 };
  for (const product of policy.PRODUCTS) {
    const result = await issueClaimedJobs(product, workerId, perProduct);
    summary.jobs.issued += result.issued;
    summary.jobs.failed += result.failed;
  }
  const { rows: finishing } = await pool.query(
    `SELECT id FROM statement_issuance_runs WHERE state='running' AND discovery_phase='running'
     ORDER BY period_from, created_at LIMIT 100`);
  for (const run of finishing) await maybeCompleteRun(run.id);
  try {
    summary.outbox = await issuance.processStatementReadyOutbox({ workerId });
  } catch (error) {
    logger.error('statement.ready outbox drain failed', {
      error: String((error && error.message) || error).slice(0, 500),
    });
    summary.outbox = { error: String((error && error.message) || error).slice(0, 200) };
  }
  // Amendment publications notify the owner exactly once via their own
  // statement.amended outbox events (workstream 3). Drained every cycle like
  // statement.ready so an approved correction's notification never stalls.
  try {
    summary.amendedOutbox = await amendments.processStatementAmendedOutbox({ workerId });
  } catch (error) {
    logger.error('statement.amended outbox drain failed', {
      error: String((error && error.message) || error).slice(0, 500),
    });
    summary.amendedOutbox = { error: String((error && error.message) || error).slice(0, 200) };
  }
  return summary;
}

module.exports = {
  pollIssuanceCycle,
  runDiscoveryPass,
  findOpenRun,
  maybeCompleteRun,
};
