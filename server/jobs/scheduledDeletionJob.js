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
 *
 * Audit-evidence safety (H6): audit tables reference businesses / restaurants
 * / legal documents with ON DELETE RESTRICT (migration 624). A hard delete
 * that would wipe audit history now fails closed with a foreign-key
 * violation; the user is skipped and the failure is logged as
 * 'retained_for_audit_evidence' so an operator can run an archive-then-delete
 * (archive the audit rows / transfer the business, then re-run). The job
 * never deletes audit history to complete a user deletion.
 */

const cron = require('node-cron');
const pool = require('../db');
const logger = require('../utils/logger');
const { userIdEq } = require('../utils/schemaProbe');

// P3-11-F03: permanent sentinel "system" user (migration 812). Audit FK
// columns that are NOT NULL cannot be nulled on user deletion, so audit
// rows are reassigned here instead. The row is inactive and never targeted
// by this job.
const AUDIT_SENTINEL_USER_ID = '00000000-0000-0000-0000-000000000000';

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

async function findCreditRetentionTables() {
  const candidates = [
    'oxsteed_credit_accounts',
    'oxsteed_credit_cards',
    'oxsteed_credit_customer_entitlements',
    'oxsteed_credit_transactions',
    'oxsteed_credit_holds',
    'oxsteed_credit_disputes',
    'oxsteed_credit_currency_conversions',
    'oxsteed_credit_entitlement_bulk_requests',
    'oxsteed_credit_entitlement_requests',
    'oxsteed_credit_partners',
    'oxsteed_credit_partner_agreements',
    'oxsteed_credit_partner_funding_records',
    'oxsteed_credit_partner_ledgers',
    'oxsteed_credit_settlements',
    'oxsteed_credit_settlement_reversals',
    'oxsteed_credit_audit_events',
    'oxsteed_credit_notification_outbox',
    'food_customer_wallet_accounts',
    'food_customer_wallet_ledger',
    'food_restaurants',
    'money_movement_approvals',
    'restaurant_payouts',
  ];
  const exists = await Promise.all(candidates.map((table) => tableExists(table)));
  return candidates.filter((_, index) => exists[index]);
}

async function hasCreditRecords(client, userId, tables) {
  if (!tables.length) return false;
  const predicates = [];
  if (tables.includes('oxsteed_credit_accounts')) predicates.push('EXISTS (SELECT 1 FROM oxsteed_credit_accounts WHERE customer_id = $1)');
  if (tables.includes('oxsteed_credit_cards')) predicates.push('EXISTS (SELECT 1 FROM oxsteed_credit_cards WHERE customer_id = $1)');
  if (tables.includes('oxsteed_credit_customer_entitlements')) predicates.push('EXISTS (SELECT 1 FROM oxsteed_credit_customer_entitlements WHERE customer_id = $1)');
  if (tables.includes('oxsteed_credit_transactions')) predicates.push('EXISTS (SELECT 1 FROM oxsteed_credit_transactions WHERE actor_user_id = $1)');
  if (tables.includes('oxsteed_credit_holds')) predicates.push('EXISTS (SELECT 1 FROM oxsteed_credit_holds WHERE customer_id = $1 OR created_by = $1 OR captured_by = $1 OR released_by = $1)');
  if (tables.includes('oxsteed_credit_disputes')) predicates.push('EXISTS (SELECT 1 FROM oxsteed_credit_disputes WHERE customer_id = $1 OR opened_by = $1 OR resolved_by = $1)');
  if (tables.includes('oxsteed_credit_currency_conversions')) predicates.push('EXISTS (SELECT 1 FROM oxsteed_credit_currency_conversions WHERE customer_id = $1 OR actor_user_id = $1)');
  if (tables.includes('oxsteed_credit_entitlement_bulk_requests')) predicates.push('EXISTS (SELECT 1 FROM oxsteed_credit_entitlement_bulk_requests WHERE customer_id = $1 OR created_by = $1)');
  if (tables.includes('oxsteed_credit_entitlement_requests')) predicates.push('EXISTS (SELECT 1 FROM oxsteed_credit_entitlement_requests WHERE customer_id = $1 OR created_by = $1)');
  if (tables.includes('oxsteed_credit_partners')) predicates.push('EXISTS (SELECT 1 FROM oxsteed_credit_partners WHERE created_by = $1)');
  if (tables.includes('oxsteed_credit_partner_agreements')) predicates.push('EXISTS (SELECT 1 FROM oxsteed_credit_partner_agreements WHERE created_by = $1 OR approved_by = $1)');
  if (tables.includes('oxsteed_credit_partner_funding_records')) predicates.push('EXISTS (SELECT 1 FROM oxsteed_credit_partner_funding_records WHERE actor_user_id = $1)');
  if (tables.includes('oxsteed_credit_partner_ledgers')) predicates.push('EXISTS (SELECT 1 FROM oxsteed_credit_partner_ledgers WHERE created_by = $1)');
  if (tables.includes('oxsteed_credit_settlements')) predicates.push('EXISTS (SELECT 1 FROM oxsteed_credit_settlements WHERE created_by = $1 OR approved_by = $1)');
  if (tables.includes('oxsteed_credit_settlement_reversals')) predicates.push('EXISTS (SELECT 1 FROM oxsteed_credit_settlement_reversals WHERE actor_user_id = $1)');
  if (tables.includes('oxsteed_credit_audit_events')) predicates.push('EXISTS (SELECT 1 FROM oxsteed_credit_audit_events WHERE actor_user_id = $1)');
  if (tables.includes('oxsteed_credit_notification_outbox')) predicates.push('EXISTS (SELECT 1 FROM oxsteed_credit_notification_outbox WHERE user_id = $1)');
  if (tables.includes('food_customer_wallet_accounts')) predicates.push('EXISTS (SELECT 1 FROM food_customer_wallet_accounts WHERE customer_id = $1)');
  if (tables.includes('food_customer_wallet_ledger')) predicates.push('EXISTS (SELECT 1 FROM food_customer_wallet_ledger WHERE customer_id = $1 OR created_by_user_id = $1)');
  // Deleting an owner cascades through restaurants and their customers' wallets.
  if (tables.includes('food_restaurants')) predicates.push('EXISTS (SELECT 1 FROM food_restaurants WHERE owner_user_id = $1 OR business_id IN (SELECT id FROM businesses WHERE user_id = $1))');
  if (tables.includes('money_movement_approvals')) predicates.push('EXISTS (SELECT 1 FROM money_movement_approvals WHERE requested_by = $1)');
  if (tables.includes('restaurant_payouts')) predicates.push('EXISTS (SELECT 1 FROM restaurant_payouts WHERE requested_by = $1)');
  const { rows } = await client.query(`SELECT ${predicates.join(' OR ')} AS has_credit_records`, [String(userId)]);
  return rows[0]?.has_credit_records === true;
}

async function anonymizeCreditCustomer(client, userId, { hasNotificationOutbox = false } = {}) {
  if (hasNotificationOutbox) {
    await client.query(
      `UPDATE oxsteed_credit_notification_outbox
          SET status = 'failed', locked_at = NULL,
              last_error = 'Customer account anonymized', updated_at = NOW()
        WHERE user_id = $1 AND status IN ('pending', 'sending')`,
      [String(userId)],
    );
  }
  await client.query(
    `UPDATE users
        SET first_name = 'Deleted',
            last_name = 'User',
            email = CONCAT('deleted_', id::text, '@oxsteed.removed'),
            phone = NULL,
            phone_number = NULL,
            bio = NULL,
            profile_photo_url = NULL,
            city = NULL,
            state = NULL,
            zip_code = NULL,
            address_line1 = NULL,
            country = 'ZZ',
            country_confirmed = FALSE,
            password_hash = 'DELETED',
            totp_secret = NULL,
            totp_enabled = FALSE,
            backup_codes = NULL,
            is_active = FALSE,
            deletion_scheduled_at = NULL,
            updated_at = NOW()
      WHERE id::text = $1`,
    [String(userId)],
  );
  // Migration 908 confirms any country change. Clear that derived evidence
  // separately, without updating its trigger columns, in the same transaction.
  await client.query(`UPDATE users SET country_confirmed=FALSE,country_confirmed_at=NULL,
    country_confirmation_source=NULL WHERE id::text=$1`, [String(userId)]);
}

async function hardDeleteExpiredAccounts() {
  logger.info('scheduledDeletionJob: starting');
  if (process.env.NODE_ENV !== 'test') await cleanupExpiredSessionData();

  let cursor = null, examined = 0;
  for (;;) {
    const { rows: candidates } = await pool.query(
      `SELECT id, email, first_name, last_name, deletion_scheduled_at, COUNT(*) OVER()::int AS remaining_due
       FROM users
       WHERE deletion_type = 'admin'
         AND deletion_scheduled_at IS NOT NULL
         AND deletion_scheduled_at <= NOW()
         AND deleted_at IS NOT NULL
         AND ($1::timestamptz IS NULL OR (deletion_scheduled_at,id) > ($1::timestamptz,$2::uuid))
       ORDER BY deletion_scheduled_at ASC, id ASC
       LIMIT 50`, [cursor?.deletion_scheduled_at || null, cursor?.id || null]
    );

    if (!candidates.length) {
      if (!examined) logger.info('scheduledDeletionJob: no accounts due for hard deletion');
      break;
    }

    if (!cursor) logger.info('scheduledDeletionJob: accounts due for hard deletion', { totalDue: candidates[0].remaining_due ?? candidates.length });

    for (const user of candidates) {
      await hardDeleteUser(user);
      examined++;
    }
    cursor = candidates.at(-1);
    if (candidates.length < 50) break;
  }
  logger.info('scheduledDeletionJob: complete', { examined });
}

async function cleanupExpiredSessionData() {
  const configuredRetention = Number.parseInt(process.env.NOTIFICATION_RETENTION_DAYS || '180', 10);
  const notificationRetentionDays = Number.isFinite(configuredRetention)
    ? Math.min(730, Math.max(30, configuredRetention))
    : 180;
  // P3-11-F16: one-time auth material (OTP/phone/email challenges) must not
  // accumulate forever. Challenges are single-use secrets; after the
  // retention window expires they are neither audit evidence nor usable.
  const configuredOtpRetention = Number.parseInt(process.env.OTP_CHALLENGE_RETENTION_DAYS || '30', 10);
  const otpChallengeRetentionDays = Number.isFinite(configuredOtpRetention)
    ? Math.min(365, Math.max(7, configuredOtpRetention))
    : 30;
  // Retention windows applied below (documented per P3-11-F16):
  //   sessions                      - by expires_at (token lifetime)
  //   privacy_export_verifications  - 15 min challenge TTL; consumed rows 1 day
  //   restaurant_app_devices        - by pairing_code_expires_at
  //   restaurant_app_devices_tokens - by device_token_expires_at
  //   pending_registrations         - by expires_at
  //   password_reset_attempts       - 30 days
  //   notifications                 - NOTIFICATION_RETENTION_DAYS (default 180, read rows only; unread kept 365)
  //   admin_phone_verification_challenges - OTP_CHALLENGE_RETENTION_DAYS (default 30, past expiry or verified)
  //   guest_profile_chat_verifications    - OTP_CHALLENGE_RETENTION_DAYS (default 30, past expiry or consumed)
  //   webhook_event_receipts/watermarks   - 365 days
  const cleanups = [
    // Keep both lifecycle flags in the cleanup predicate so the sweeper
    // remains compatible with the session-read contract and never treats a
    // malformed row with neither flag as an ordinary live session.
    ['sessions', `DELETE FROM sessions
       WHERE expires_at IS NOT NULL AND expires_at <= NOW()
         AND (is_valid IS NOT NULL OR is_revoked IS NOT NULL)`],
    ['privacy_export_verifications', `DELETE FROM privacy_export_verifications WHERE expires_at <= NOW() OR (consumed_at IS NOT NULL AND consumed_at < NOW() - INTERVAL '1 day')`],
    ['restaurant_app_devices', `DELETE FROM restaurant_app_devices WHERE pairing_code IS NOT NULL AND pairing_code_expires_at IS NOT NULL AND pairing_code_expires_at <= NOW()`],
    ['restaurant_app_devices_tokens', `UPDATE restaurant_app_devices
       SET status = 'revoked', device_token_hash = NULL, updated_at = NOW()
     WHERE status = 'paired' AND device_token_expires_at IS NOT NULL AND device_token_expires_at <= NOW()`],
    ['pending_registrations', `DELETE FROM pending_registrations WHERE expires_at IS NOT NULL AND expires_at <= NOW()`],
    ['password_reset_attempts', `DELETE FROM password_reset_attempts WHERE created_at < NOW() - INTERVAL '30 days'`],
    // Retain unread notifications longer so an infrequent user can still
    // review them; read rows follow the configured bounded retention window.
    ['notifications', `DELETE FROM notifications
       WHERE created_at < NOW() - ($1::int * INTERVAL '1 day')
         AND (is_read = TRUE OR created_at < NOW() - INTERVAL '365 days')`, [notificationRetentionDays]],
    ['admin_phone_verification_challenges', `DELETE FROM admin_phone_verification_challenges
       WHERE expires_at < NOW() - ($1::int * INTERVAL '1 day')
          OR (verified_at IS NOT NULL AND verified_at < NOW() - ($1::int * INTERVAL '1 day'))`,
      [otpChallengeRetentionDays]],
    ['guest_profile_chat_verifications', `DELETE FROM guest_profile_chat_verifications
       WHERE expires_at < NOW() - ($1::int * INTERVAL '1 day')
          OR (consumed_at IS NOT NULL AND consumed_at < NOW() - ($1::int * INTERVAL '1 day'))`,
      [otpChallengeRetentionDays]],
    ['webhook_event_receipts', `DELETE FROM webhook_event_receipts
       WHERE last_seen_at < NOW() - INTERVAL '365 days'
         AND status IN ('processed', 'failed')`],
    ['webhook_event_watermarks', `DELETE FROM webhook_event_watermarks
       WHERE updated_at < NOW() - INTERVAL '365 days'`],
  ];
  for (const [name, sql, params] of cleanups) {
    try {
      const result = await pool.query(sql, params);
      if (result.rowCount) logger.info('scheduledDeletionJob: expired session data cleaned', { table: name, count: result.rowCount });
    } catch (error) {
      logger.warn('scheduledDeletionJob: optional session cleanup skipped', { table: name, error: error.message });
    }
  }
}

async function hardDeleteUser(user, { throwOnError = false } = {}) {
  const userId = user.id;
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await client.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [userId]);
    const blockers = await require('../services/accountDeletionGuard').findFinancialBlockers(userId, client);
    if (blockers.length) {
      const error = new Error('Stored value or pending money requires resolution before deletion');
      error.code = 'account_financial_review';
      error.statusCode = 409;
      throw error;
    }
    await require('../services/privacyActivityData').erase(client,userId);
    if(process.env.GROWTH_SUBJECT_PEPPER)await require('../growth/rights').erase(client,userId);

    const q = (sql, params) => client.query(sql, params);

    const creditRetentionTables = await findCreditRetentionTables();
    if (await hasCreditRecords(client, userId, creditRetentionTables)) {
      await anonymizeCreditCustomer(client, userId, {
        hasNotificationOutbox: creditRetentionTables.includes('oxsteed_credit_notification_outbox'),
      });
      await client.query('COMMIT');
      logger.info('scheduledDeletionJob: retained OxSteed Credit records and anonymized user', {
        userId,
        scheduledAt: user.deletion_scheduled_at,
      });
      return;
    }

    const del = async (table, condition) => {
      if (!(await tableExists(table))) return;
      await q(`DELETE FROM ${table} WHERE ${condition}`, [String(userId)]);
    };

    const nullify = async (table, column) => {
      if (!(await tableExists(table))) return;
      await q(`UPDATE ${table} SET ${column} = NULL WHERE ${column}::text = $1`, [String(userId)]);
    };

    // Null out audit/admin references (preserve audit trail, remove user link).
    // P3-11-F03: admin_audit_log.admin_id (migration 055) and
    // admin_user_action_log.admin_id / target_user_id (migration 116) are
    // NOT NULL, so SET NULL can never succeed there: the 23502 violation
    // rolls the whole deletion back and the user is retained forever.
    // Those three columns are reassigned to the permanent sentinel system
    // user (migration 812) instead, which satisfies both the NOT NULL
    // constraint and the users(id) foreign keys. Every other reference
    // stays a plain nullify.
    const reassignToSentinel = async (table, column) => {
      if (!(await tableExists(table))) return;
      await q(
        `UPDATE ${table} SET ${column} = $2 WHERE ${column}::text = $1`,
        [String(userId), AUDIT_SENTINEL_USER_ID]
      );
    };

    await reassignToSentinel('admin_audit_log', 'admin_id');
    await reassignToSentinel('admin_user_action_log', 'admin_id');
    await reassignToSentinel('admin_user_action_log', 'target_user_id');
    await reassignToSentinel('business_events', 'created_by');
    await reassignToSentinel('support_ai_reply_drafts', 'requested_by');
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
    if (throwOnError) throw err;
    // RESTRICT-guarded audit children (migration 624) fail closed here:
    // deleting the user would wipe audit evidence, so the user is retained
    // for a manual archive-then-delete instead of losing history.
    if (err && err.code === '23503') {
      logger.error('scheduledDeletionJob: user retained for audit evidence (archive-then-delete required)', {
        userId,
        email: user.email,
        error: err.message,
      });
      // Complete the privacy request without deleting immutable evidence. The
      // account is anonymized and disabled while retained audit rows remain.
      try {
        await client.query('BEGIN');
        await anonymizeCreditCustomer(client, userId);
        await client.query('COMMIT');
        await require('../services/incidentStore').recordIncident({ type: 'account_erasure_retained', severity: 'high',
          message: 'Account retained because a restricted reference requires operator review',
          dedupeKey: `account-erasure-retained:${userId}`, details: { userId, code: 'restricted_reference' } });
        logger.info('scheduledDeletionJob: anonymized user while retaining audit evidence', { userId });
      } catch (anonymizeErr) {
        await client.query('ROLLBACK');
        logger.error('scheduledDeletionJob: audit-retained anonymization failed', { userId, error: anonymizeErr.message });
      }
    } else {
      logger.error('scheduledDeletionJob: hard-delete failed', {
        userId,
        email: user.email,
        error: err.message,
        stack: err.stack,
      });
    }
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

module.exports = { startScheduledDeletionJob, hardDeleteExpiredAccounts, cleanupExpiredSessionData, hardDeleteUser };
