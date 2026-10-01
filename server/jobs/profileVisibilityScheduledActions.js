// server/jobs/profileVisibilityScheduledActions.js
// Workstream A: minute-cron worker that applies due scheduled profile
// visibility actions (migration 617).
//
// Registration: the parent wires startProfileVisibilityScheduler() in
// server/bootstrap/backgroundWorkers.js alongside the other workers (workstream
// A's agent does not touch that file).
//
// Safety model: the whole claim+apply loop runs under withJobLock, and rows
// are claimed inside a transaction with SELECT ... FOR UPDATE SKIP LOCKED so
// two instances polling at the same minute cannot grab the same row. Each row
// applies inside its own SAVEPOINT: a per-row failure marks that row failed
// with a failure_reason and the batch continues.

'use strict';

const cron = require('node-cron');
const db = require('../db');
const logger = require('../utils/logger');
const { withJobLock } = require('./jobLockingService');
const { logAdminAction } = require('../services/auditService');
const { TABLE_BY_TYPE } = require('../controllers/profileVisibilityController');

const CRON_EXPRESSION = '*/1 * * * *'; // every minute
const JOB_NAME = 'profile-visibility-scheduled-actions';
const CLAIM_LIMIT = 100;

function loadNotifier() {
  // Workstream B owns owner notifications; treat as optional so the worker
  // keeps applying hides/restores even before that module lands.
  try {
    return require('../services/profileVisibilityNotifications');
  } catch (err) {
    return null;
  }
}

async function applyScheduledRow(client, row) {
  const spec = TABLE_BY_TYPE[row.profile_type];
  if (!spec) throw new Error(`Unknown profile_type: ${row.profile_type}`);

  const hide = !row.is_visible;
  const reasonCode = hide ? (row.reason || 'admin_decision') : null;

  const { rows: updated } = await client.query(
    `UPDATE ${spec.table}
        SET is_hidden_by_admin = $1,
            hidden_reason      = $2,
            hidden_at          = CASE WHEN $1 THEN NOW() ELSE NULL END,
            hidden_by          = CASE WHEN $1 THEN $3 ELSE NULL END,
            updated_at         = NOW()
      WHERE ${spec.idCol} = $4
      RETURNING is_hidden_by_admin`,
    [hide, reasonCode, row.created_by, row.profile_id]
  );
  if (!updated.length) throw new Error('Profile not found for scheduled action.');

  try {
    await logAdminAction({
      adminId: row.created_by,
      action: 'profile_visibility_scheduled_applied',
      targetType: spec.targetType,
      targetId: String(row.profile_id),
      before: { is_hidden_by_admin: !hide },
      after: { is_hidden_by_admin: hide, hidden_reason: reasonCode, scheduled_action_id: row.id },
      description: [reasonCode, row.note].filter(Boolean).join(' - ') || null,
      client,
      throwOnError: true,
    });
  } catch (e) {
    // Audit failures roll back with the row (client-bound, throwOnError).
    throw e;
  }

  await client.query(
    `UPDATE profile_visibility_scheduled_actions
        SET status = 'applied', applied_at = NOW()
      WHERE id = $1`,
    [row.id]
  );

  // Owner notification is best-effort: never fail an applied action. The
  // idempotency key makes a retried apply notify at most once.
  const notifier = loadNotifier();
  if (notifier && typeof notifier.notifyOwnerOfVisibilityChange === 'function') {
    try {
      await notifier.notifyOwnerOfVisibilityChange({
        profileType: row.profile_type,
        profileId: String(row.profile_id),
        isVisible: row.is_visible,
        actorId: row.created_by,
        idempotencyKey: `pv-sched-${row.id}`,
      });
    } catch (notifyErr) {
      logger.warn('profileVisibility scheduled apply: owner notification failed', {
        actionId: row.id,
        error: notifyErr.message,
      });
    }
  }
}

async function processDueScheduledActions() {
  const outcome = { claimed: 0, applied: 0, failed: 0 };
  await withJobLock(JOB_NAME, async () => {
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `SELECT id, profile_type, profile_id, is_visible, reason, note, created_by
           FROM profile_visibility_scheduled_actions
          WHERE status = 'pending' AND scheduled_for <= NOW()
          ORDER BY scheduled_for ASC
          LIMIT $1
          FOR UPDATE SKIP LOCKED`,
        [CLAIM_LIMIT]
      );
      outcome.claimed = rows.length;

      for (const row of rows) {
        await client.query('SAVEPOINT pv_scheduled_row');
        try {
          await applyScheduledRow(client, row);
          await client.query('RELEASE SAVEPOINT pv_scheduled_row');
          outcome.applied += 1;
        } catch (rowErr) {
          await client.query('ROLLBACK TO SAVEPOINT pv_scheduled_row');
          await client.query(
            `UPDATE profile_visibility_scheduled_actions
                SET status = 'failed', failure_reason = $2
              WHERE id = $1`,
            [row.id, String(rowErr.message || rowErr).slice(0, 1000)]
          );
          outcome.failed += 1;
          logger.error('profileVisibility scheduled action failed', {
            actionId: row.id,
            profileType: row.profile_type,
            profileId: row.profile_id,
            error: rowErr.message,
          });
        }
      }
      await client.query('COMMIT');
    } catch (err) {
      try { await client.query('ROLLBACK'); } catch (e) { /* already broken */ }
      throw err;
    } finally {
      if (typeof client.release === 'function') client.release();
    }
  }, 120);
  if (outcome.claimed) {
    logger.info('profileVisibility scheduled actions processed', outcome);
  }
  return outcome;
}

function startProfileVisibilityScheduler() {
  cron.schedule(CRON_EXPRESSION, () => {
    processDueScheduledActions().catch((err) => {
      logger.error('profileVisibility scheduled actions cron error', { error: err.message });
    });
  });
  logger.info('profileVisibility scheduled actions worker started', { cron: CRON_EXPRESSION });
}

module.exports = {
  CRON_EXPRESSION,
  JOB_NAME,
  processDueScheduledActions,
  startProfileVisibilityScheduler,
};
