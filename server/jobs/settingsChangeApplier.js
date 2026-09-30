'use strict';

/**
 * Settings change applier worker.
 *
 * Picks up approved/scheduled settings change requests whose effective time
 * has arrived and applies each one through
 * `server/controllers/settingsChangeController.js`'s `applyChangeRequest`.
 *
 * Concurrency/idempotency design (matches the refund reconciliation jobs):
 * - `withJobLock` guarantees only one applier runs cluster-wide at a time.
 *   The lock itself lives in the database, so the worker naturally refuses
 *   to run when the DB is unreachable.
 * - Due rows are discovered in a single transaction with SELECT ... FOR UPDATE
 *   so the due set is a consistent snapshot. That transaction is committed
 *   before applying: `applyChangeRequest` owns its own BEGIN/COMMIT per row
 *   and re-locks the row (SELECT ... FOR UPDATE), re-validating the status
 *   inside that transaction. Double-application is therefore impossible: the
 *   discovery SELECT excludes 'applied', and even a row that slips through
 *   would fail the re-validation inside `applyChangeRequest`.
 * - A failing row never blocks the rest: its error is recorded in
 *   `admin_audit_log` (best-effort, never throwing) and the worker continues.
 */

const cron = require('node-cron');
const pool = require('../db');
const logger = require('../utils/logger');
const { withJobLock } = require('./jobLockingService');
const { logAdminAction } = require('../services/auditService');

const CRON_EXPRESSION = '* * * * *';
const CRON_TIMEZONE = 'UTC';
const JOB_NAME = 'settings-change-applier';
const BATCH_SIZE = 100;
// Must match the migration/table owned by the settings-change feature
// (server/controllers/settingsChangeController.js). Overridable so tests and
// unusual deployments do not need a code change.
const CHANGE_REQUESTS_TABLE = process.env.SETTINGS_CHANGE_REQUESTS_TABLE || 'settings_change_requests';
if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(CHANGE_REQUESTS_TABLE)) {
  throw new Error(`Invalid SETTINGS_CHANGE_REQUESTS_TABLE: ${CHANGE_REQUESTS_TABLE}`);
}

// Lazy require on purpose: the controller lands in a parallel change set, and
// tests inject it via jest.mock. Once loaded it is cached by Node like any
// other module.
function getApplyChangeRequest() {
  const { applyChangeRequest } = require('../controllers/settingsChangeController');
  if (typeof applyChangeRequest !== 'function') {
    throw new Error('settingsChangeController must export applyChangeRequest(client, request, adminId)');
  }
  return applyChangeRequest;
}

function adminIdFor(request) {
  // reviewed_by is the approving admin. applyChangeRequest falls back to it
  // internally when adminId is null, which is the correct attribution for a
  // scheduled apply performed by the worker rather than a human session.
  return request.reviewed_by || request.proposed_by || null;
}

async function runSettingsChangeApplierOnce(db = pool, { limit = BATCH_SIZE } = {}) {
  const boundedLimit = Math.min(BATCH_SIZE, Math.max(1, Number(limit) || BATCH_SIZE));
  const result = { locked: false, due: 0, applied: 0, failed: 0 };

  await withJobLock(JOB_NAME, async () => {
    result.locked = true;
    const applyChangeRequest = getApplyChangeRequest();

    // Discover the due set atomically. Commit before applying: each
    // applyChangeRequest runs its own transaction (BEGIN ... COMMIT) on a
    // dedicated client, so it cannot nest inside this discovery transaction.
    const discovery = await db.connect();
    let dueRows;
    try {
      await discovery.query('BEGIN');
      const { rows } = await discovery.query(
        `SELECT *
           FROM ${CHANGE_REQUESTS_TABLE}
          WHERE status IN ('approved', 'scheduled')
            AND (effective_at IS NULL OR effective_at <= NOW())
          ORDER BY effective_at NULLS FIRST, id ASC
          LIMIT $1
          FOR UPDATE`,
        [boundedLimit]
      );
      dueRows = rows;
      await discovery.query('COMMIT');
    } catch (error) {
      await discovery.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      discovery.release();
    }

    result.due = dueRows.length;
    for (const request of dueRows) {
      const client = await db.connect();
      try {
        await applyChangeRequest(client, request, adminIdFor(request));
        result.applied += 1;
        logger.info('Settings change request applied', { changeRequestId: request.id });
      } catch (error) {
        result.failed += 1;
        const message = String(error && error.message ? error.message : error || 'Unknown error');
        logger.warn('Settings change request apply failed', {
          changeRequestId: request.id,
          error: message,
        });
        // Record the failure in the admin audit log but never let a bad row
        // (or a failed audit write) block the remaining rows.
        try {
          await logAdminAction({
            adminId: adminIdFor(request),
            action: 'settings_change_apply_failed',
            targetType: 'settings_change_request',
            targetId: request.id,
            description: `Scheduled settings change apply failed: ${message.slice(0, 1000)}`,
          });
        } catch (auditError) {
          logger.warn('Failed to audit settings change apply failure', {
            changeRequestId: request.id,
            error: auditError.message,
          });
        }
      } finally {
        client.release();
      }
    }
  }, 300, { throwOnLockError: true });

  return result;
}

function startSettingsChangeApplierJob() {
  // DB-reachability guard: the job lock is stored in the database, so
  // withJobLock refuses to run when the DB is unreachable and this callback
  // just logs and skips the tick. Same pattern as the refund reconciliation
  // jobs.
  cron.schedule(CRON_EXPRESSION, () => {
    runSettingsChangeApplierOnce(pool).catch((error) => {
      logger.error('Settings change applier worker failed', { error: error.message });
    });
  }, { timezone: CRON_TIMEZONE });
  logger.info('Settings change applier job scheduled', {
    cron: CRON_EXPRESSION,
    timezone: CRON_TIMEZONE,
    batchSize: BATCH_SIZE,
  });
}

module.exports = {
  CRON_EXPRESSION,
  CRON_TIMEZONE,
  JOB_NAME,
  BATCH_SIZE,
  CHANGE_REQUESTS_TABLE,
  runSettingsChangeApplierOnce,
  startSettingsChangeApplierJob,
};
