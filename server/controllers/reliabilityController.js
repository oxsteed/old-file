'use strict';

/**
 * M4 — Reliability workspace API (Releases, Migration status, DB budgets).
 *
 * All routes are admin-only behind the manage_operations grant (wired in
 * server/routes/reliability.js). Release history is recorded manually from
 * the admin UI; there is no CI/deploy webhook feed yet.
 */

const pool = require('../db');
const logger = require('../utils/logger');
const { sendError, sendValidationError, sendSuccess } = require('../utils/apiError');
const { getBudgetConfig, getBudgetState } = require('../utils/dbBudgets');

const RELEASE_STATUSES = ['deployed', 'rolled_back', 'failed'];
const BUDGET_NAMES = ['web', 'jobs', 'exports', 'realtime'];

/**
 * GET /admin/super/reliability/releases
 * Newest 100 recorded releases.
 */
async function listReleases(req, res) {
  try {
    const { rows } = await pool.query(
      `SELECT id, version, commit_sha, status, deployed_at, deployed_by, notes
       FROM release_history
       ORDER BY deployed_at DESC, id DESC
       LIMIT 100`
    );
    return sendSuccess(res, { releases: rows });
  } catch (err) {
    logger.error('reliability.listReleases failed', { error: err.message });
    return sendError(res, 500, 'Could not load release history.', 'releases_unavailable');
  }
}

/**
 * POST /admin/super/reliability/releases
 * Record a release. version and commit_sha are required; deployed_by comes
 * from the authenticated admin.
 */
async function createRelease(req, res) {
  const { version, commit_sha: commitSha, notes, status } = req.body || {};

  const fields = {};
  if (!version || !String(version).trim()) fields.version = 'Version is required.';
  if (!commitSha || !String(commitSha).trim()) fields.commit_sha = 'Commit SHA is required.';
  const releaseStatus = status || 'deployed';
  if (!RELEASE_STATUSES.includes(releaseStatus)) fields.status = 'Status must be one of: deployed, rolled_back, failed.';
  if (Object.keys(fields).length > 0) {
    return sendValidationError(res, fields);
  }

  try {
    const { rows } = await pool.query(
      `INSERT INTO release_history (version, commit_sha, status, deployed_by, notes)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, version, commit_sha, status, deployed_at, deployed_by, notes`,
      [String(version).trim(), String(commitSha).trim(), releaseStatus, req.user?.id || null, notes ? String(notes) : null]
    );
    return sendSuccess(res, { release: rows[0] }, 201);
  } catch (err) {
    logger.error('reliability.createRelease failed', { error: err.message });
    return sendError(res, 500, 'Could not record the release.', 'release_record_failed');
  }
}

/**
 * GET /admin/super/reliability/migrations
 * Read-only view of the _migrations bookkeeping table. Fails closed: on any
 * query error we return 500 and no partial data.
 */
async function listMigrations(req, res) {
  try {
    const { rows } = await pool.query(
      'SELECT filename, status, applied_at FROM _migrations ORDER BY filename'
    );
    return sendSuccess(res, { migrations: rows });
  } catch (err) {
    logger.error('reliability.listMigrations failed', { error: err.message });
    return sendError(res, 500, 'Could not load migration status.', 'migrations_unavailable');
  }
}

/**
 * GET /admin/super/reliability/budgets
 * Read-only snapshot of the E04 DB workload budgets. No mutation, no query.
 */
async function getBudgets(req, res) {
  try {
    const budgets = BUDGET_NAMES.map((name) => ({
      name,
      config: getBudgetConfig(name),
      state: getBudgetState(name),
    }));
    return sendSuccess(res, { budgets });
  } catch (err) {
    logger.error('reliability.getBudgets failed', { error: err.message });
    return sendError(res, 500, 'Could not load budget state.', 'budgets_unavailable');
  }
}

/**
 * GET /admin/super/reliability/fleet-workers
 * Read-only snapshot of the scheduled fleet worker heartbeats.
 *
 * Domain 7 #15: getFleetWorkerHeartbeats() was exported but had no reader.
 * The getter is required lazily so this controller does not pull the whole
 * worker graph (learn/enforcement/statement jobs) into every importer.
 *
 * Honest limits, by design (see scheduledWorkerSchedule.js): the state is
 * per-process in-memory and resets on restart. In combined mode the API
 * process runs the scheduled workers, so this list is live; in
 * dedicated-worker mode this process runs none and the list is empty — the
 * worker process holds the state. Failures still surface as incidents
 * (critical scheduled_worker_failed, warning skipped-streak), so this
 * endpoint is visibility, not the failure signal.
 */
async function getFleetWorkers(req, res) {
  try {
    const { getFleetWorkerHeartbeats } = require('../workers/scheduledWorkerSchedule');
    return sendSuccess(res, {
      workers: getFleetWorkerHeartbeats(),
      perProcess: true,
      note: 'Fleet worker heartbeats from this process only. State is per-process in-memory and resets on restart; in dedicated-worker mode this list is empty and the worker process holds the state. Failures still raise incidents.',
    });
  } catch (err) {
    logger.error('reliability.getFleetWorkers failed', { error: err.message });
    return sendError(res, 500, 'Could not load fleet worker heartbeats.', 'fleet_workers_unavailable');
  }
}

module.exports = {
  listReleases,
  createRelease,
  listMigrations,
  getBudgets,
  getFleetWorkers,
};
