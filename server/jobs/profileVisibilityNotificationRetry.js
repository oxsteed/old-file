// server/jobs/profileVisibilityNotificationRetry.js
// Workstream B: retry owner notifications that failed or are stuck pending.
//
// Polls every 5 minutes for rows with status pending/failed, attempts < 5,
// and created_at older than attempts^2 minutes (exponential backoff).
// Rows are claimed with FOR UPDATE SKIP LOCKED so multiple workers do not
// double-send; the underlying notificationService.sendNotification is
// itself idempotent on delivery_key, so an at-most-once claim still cannot
// produce a duplicate in-app notification.

'use strict';

const pool = require('../db');
const logger = require('../utils/logger');
const notificationService = require('../services/notificationService');

const CRON_EXPRESSION = '*/5 * * * *'; // every 5 minutes
const MAX_ATTEMPTS = 5;

function backoffMinutes(attempts) {
  return Math.max(0, attempts * attempts);
}

function buildCopy(profileType, isVisible) {
  if (isVisible) {
    return {
      title: 'Your profile is visible again',
      body: `OxSteed has restored public visibility for your ${profileType} profile. No action is needed.`,
    };
  }
  return {
    title: 'Your profile was hidden by OxSteed',
    body: `OxSteed has hidden your ${profileType} profile from public listings. If you have questions, contact support.`,
  };
}

async function processNotificationRetries() {
  logger.info('Profile visibility notification retry job started');
  let sent = 0;
  let failed = 0;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT *
         FROM profile_visibility_owner_notifications
        WHERE status IN ('pending', 'failed')
          AND attempts < $1
          AND created_at <= NOW() - (attempts * attempts || ' minutes')::interval
        ORDER BY created_at ASC
        LIMIT 100
        FOR UPDATE SKIP LOCKED`,
      [MAX_ATTEMPTS]
    );
    for (const row of rows) {
      const copy = buildCopy(row.profile_type, row.action === 'restored');
      try {
        const result = await notificationService.sendNotification({
          userId: row.recipient_user_id,
          type: 'profile_visibility_changed',
          title: copy.title,
          body: copy.body,
          data: {
            profile_type: row.profile_type,
            profile_id: row.profile_id,
            is_visible: row.action === 'restored',
          },
          idempotencyKey: row.delivery_key,
        });
        if (result && result.success) {
          await client.query(
            `UPDATE profile_visibility_owner_notifications
                SET status = 'sent', attempts = attempts + 1, sent_at = NOW()
              WHERE id = $1`,
            [row.id]
          );
          sent += 1;
        } else {
          await client.query(
            `UPDATE profile_visibility_owner_notifications
                SET status = 'failed', attempts = attempts + 1,
                    last_error = $2
              WHERE id = $1`,
            [row.id, String((result && (result.error || result.reason)) || 'send_failed').slice(0, 2000)]
          );
          failed += 1;
        }
      } catch (err) {
        await client.query(
          `UPDATE profile_visibility_owner_notifications
              SET status = 'failed', attempts = attempts + 1, last_error = $2
            WHERE id = $1`,
          [row.id, String(err.message).slice(0, 2000)]
        );
        failed += 1;
      }
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    logger.error('Profile visibility notification retry job failed', { error: err.message });
    throw err;
  } finally {
    client.release();
  }

  logger.info('Profile visibility notification retry job completed', { sent, failed });
  return { sent, failed };
}

function startProfileVisibilityNotificationRetryJob() {
  const cron = require('node-cron');
  cron.schedule(CRON_EXPRESSION, async () => {
    try {
      await processNotificationRetries();
    } catch (err) {
      logger.error('Profile visibility notification retry cron error', { error: err.message });
    }
  });
  logger.info('Profile visibility notification retry job scheduled', { cron: CRON_EXPRESSION });
}

module.exports = {
  startProfileVisibilityNotificationRetryJob,
  processNotificationRetries,
  cronExpression: CRON_EXPRESSION,
  backoffMinutes,
};
