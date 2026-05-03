/**
 * Scheduled Deletion Job
 *
 * Runs daily at 3:00 AM UTC.
 * Finds user accounts whose 30-day admin-deletion grace window has expired
 * and performs the actual hard-delete of their data.
 *
 * Only processes accounts with:
 *   - deletion_type = 'admin'   (not self-deletes — those are already anonymized)
 *   - deletion_scheduled_at <= NOW()  (grace window passed)
 *   - deleted_at IS NOT NULL    (account was locked)
 *
 * Self-deletes (deletion_type = 'self') are already anonymized at deletion time
 * and have no PII left to remove, so this job intentionally skips them.
 */

const cron = require('node-cron');
const pool = require('../db');
const logger = require('../utils/logger');
const { userIdEq } = require('../utils/schemaProbe');

async function tableExists(name) {
  const { rows } = await pool.query(
    `SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = $1
    ) AS exists`,
    [name]
  );
  return rows[0]?.exists ?? false;
}

async function hardDeleteExpiredAccounts() {
  logger.info('scheduledDeletionJob: starting');

  const { rows: candidates } = await pool.query(
    `SELECT id, email, first_name, last_name, deletion_scheduled_at
     FROM users
     WHERE deletion_type = 'admin'
       AND deletion_scheduled_at IS NOT NULL
       AND deletion_scheduled_at <= NOW()
       AND deleted_at IS NOT NULL
     ORDER BY deletion_scheduled_at ASC
     LIMIT 50`
  );

  if (!candidates.length) {
    logger.info('scheduledDeletionJob: no accounts due for hard deletion');
    return;
  }

  logger.info(`scheduledDeletionJob: ${candidates.length} account(s) due for hard deletion`);

  for (const user of candidates) {
    await hardDeleteUser(user);
  }

  logger.info('scheduledDeletionJob: complete');
}

async function hardDeleteUser(user) {
  const userId = user.id;
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const q = (sql, params) => client.query(sql, params);

    const del = async (table, condition) => {
      if (!(await tableExists(table))) return;
      await q(`DELETE FROM ${table} WHERE ${condition}`, [String(userId)]);
    };

    const nullify = async (table, column) => {
      if (!(await tableExists(table))) return;
      await q(`UPDATE ${table} SET ${column} = NULL WHERE ${column}::text = $1`, [String(userId)]);
    };

    // Null out audit/admin references (preserve audit trail, remove user link)
    await nullify('admin_user_action_log', 'admin_id');
    await nullify('admin_user_action_log', 'target_user_id');
    await nullify('admin_audit_log', 'admin_id');
    await nullify('platform_settings', 'updated_by');
    await nullify('feature_flags', 'updated_by');
    await nullify('content_reports', 'reviewed_by');
    await nullify('moderation_queue', 'reported_by');
    await nullify('moderation_queue', 'assigned_to');
    await nullify('moderation_queue', 'resolved_by');

    // Remove financial/dispute records (delete in FK order)
    // Use ::text comparisons so UUID params work when FK columns are BIGINT (or vice versa).
    await del('dispute_messages', userIdEq('sender_id'));
    await del('disputes', userIdEq('raised_by'));
    await del('disputes', userIdEq('against_user'));
    await del('disputes', userIdEq('resolved_by'));
    await del('payments', userIdEq('payer_id'));
    await del('payments', userIdEq('payee_id'));

    // Job-related
    await del('bids', userIdEq('helper_id'));
    await del('conversations', userIdEq('customer_id'));
    await del('conversations', userIdEq('helper_id'));
    await del('jobs', userIdEq('client_id'));
    await del('jobs', userIdEq('assigned_helper_id'));

    // Profile & account data
    await del('notifications', userIdEq('user_id'));
    await del('subscriptions', userIdEq('user_id'));
    await del('helper_profiles', userIdEq('user_id'));
    await del('consent_records', userIdEq('user_id'));
    await del('user_consents', userIdEq('user_id'));
    await del('user_2fa', userIdEq('user_id'));
    await del('sessions', userIdEq('user_id'));
    await del('guest_profile_chat_inbound', userIdEq('helper_id'));

    // Reviews are intentionally kept for counterparty integrity —
    // the reviewee's rating should not silently disappear.
    // Reviewer identity is already anonymized to NULL-safe UUID.

    // Hard delete the user row (businesses cascade via FK ON DELETE CASCADE)
    await q('DELETE FROM users WHERE id::text = $1', [String(userId)]);

    await client.query('COMMIT');

    logger.info('scheduledDeletionJob: hard-deleted user', {
      userId,
      email: user.email,
      scheduledAt: user.deletion_scheduled_at,
    });

    // Recompute stale helper ratings for any reviews that now have a deleted reviewee
    try {
      await pool.query(
        `UPDATE helper_profiles hp SET
          avg_rating = (
            SELECT ROUND(AVG(r.rating)::numeric, 2)
            FROM reviews r WHERE r.reviewee_id = hp.user_id AND r.is_public = true
          ),
          total_reviews = (
            SELECT COUNT(*) FROM reviews r
            WHERE r.reviewee_id = hp.user_id AND r.is_public = true
          )
        WHERE hp.user_id IN (
          SELECT DISTINCT reviewee_id FROM reviews WHERE reviewer_id::text = $1
        )`,
        [String(userId)]
      );
    } catch (e) {
      logger.warn('scheduledDeletionJob: rating recompute failed (non-fatal)', { userId, error: e.message });
    }
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error('scheduledDeletionJob: hard-delete failed', {
      userId,
      email: user.email,
      error: err.message,
      stack: err.stack,
    });
  } finally {
    client.release();
  }
}

function startScheduledDeletionJob() {
  // Run daily at 3:00 AM UTC
  cron.schedule('0 3 * * *', async () => {
    try {
      await hardDeleteExpiredAccounts();
    } catch (err) {
      logger.error('scheduledDeletionJob: unhandled error', { error: err.message });
    }
  });
  logger.info('scheduledDeletionJob: registered (daily at 03:00 UTC)');
}

module.exports = { startScheduledDeletionJob, hardDeleteExpiredAccounts };
