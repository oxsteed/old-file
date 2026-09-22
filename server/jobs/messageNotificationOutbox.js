'use strict';

const cron = require('node-cron');
const logger = require('../utils/logger');
const db = require('../db');
const { sendNotification } = require('../services/notificationService');
const { withJobLock } = require('./jobLockingService');

const CRON_EXPRESSION = '55 * * * * *';
const JOB_NAME = 'message-notification-outbox';
const MAX_ATTEMPTS = 8;
const STALE_LOCK_MINUTES = 15;

async function claimMessageNotifications(limit = 100) {
  const boundedLimit = Math.max(1, Math.min(Number(limit) || 100, 500));
  const { rows } = await db.query(
    `WITH candidates AS (
       SELECT id
       FROM message_notification_outbox
       WHERE (status = 'pending' AND next_attempt_at <= NOW())
          OR (status = 'sending' AND locked_at < NOW() - ($2::integer * INTERVAL '1 minute'))
       ORDER BY created_at, id
       FOR UPDATE SKIP LOCKED
       LIMIT $1
     )
     UPDATE message_notification_outbox outbox
        SET status = 'sending', attempts = outbox.attempts + 1,
            locked_at = NOW(), updated_at = NOW()
       FROM candidates
      WHERE outbox.id = candidates.id
      RETURNING outbox.id, outbox.message_id, outbox.conversation_id,
                outbox.recipient_id, outbox.payload, outbox.attempts`,
    [boundedLimit, STALE_LOCK_MINUTES]
  );
  return rows || [];
}

async function finishMessageNotification(id, attempts, result) {
  const succeeded = result?.success !== false;
  const terminal = !succeeded && attempts >= MAX_ATTEMPTS;
  const status = succeeded ? 'sent' : terminal ? 'failed' : 'pending';
  const retryMinutes = Math.min(60, 2 ** Math.max(0, attempts - 1));
  await db.query(
    `UPDATE message_notification_outbox
        SET status = $1,
            sent_at = CASE WHEN $5::boolean THEN NOW() ELSE sent_at END,
            locked_at = NULL,
            last_error = $2,
            next_attempt_at = CASE WHEN $6::boolean THEN NOW() + ($3::integer * INTERVAL '1 minute') ELSE next_attempt_at END,
            updated_at = NOW()
      WHERE id = $4`,
    [
      status,
      succeeded ? null : String(result?.error || 'Message notification delivery failed').slice(0, 2000),
      retryMinutes,
      id,
      succeeded,
      status === 'pending',
    ]
  );
  return status;
}

function normalizePayload(payload) {
  const value = typeof payload === 'string' ? JSON.parse(payload) : (payload || {});
  return {
    conversationId: value.conversationId || null,
    messageId: value.messageId || null,
    senderName: String(value.senderName || 'OxSteed user').slice(0, 255),
    body: String(value.body || 'New message').slice(0, 500),
    actionUrl: typeof value.actionUrl === 'string' && value.actionUrl.startsWith('/')
      ? value.actionUrl.slice(0, 500)
      : null,
  };
}

async function processMessageNotificationOutbox(limit = 100) {
  const rows = await claimMessageNotifications(limit);
  let sent = 0;
  let retried = 0;
  let failed = 0;

  for (const row of rows) {
    try {
      const payload = normalizePayload(row.payload);
      const result = await sendNotification({
        userId: row.recipient_id,
        type: 'new_message',
        title: `New message from ${payload.senderName}`,
        body: payload.body,
        data: {
          conversationId: payload.conversationId || row.conversation_id,
          messageId: payload.messageId || row.message_id,
        },
        action_url: payload.actionUrl || `/messages/${payload.conversationId || row.conversation_id}`,
        idempotencyKey: `message:${row.message_id}:${row.recipient_id}`,
      });
      const status = await finishMessageNotification(row.id, Number(row.attempts || 0), result);
      if (status === 'sent') sent += 1;
      else if (status === 'pending') retried += 1;
      else failed += 1;
    } catch (error) {
      const status = await finishMessageNotification(row.id, Number(row.attempts || 0), {
        success: false,
        error: error.message,
      });
      if (status === 'pending') retried += 1;
      else failed += 1;
    }
  }

  return { claimed: rows.length, sent, retried, failed };
}

async function runMessageNotificationOutbox() {
  let result = { claimed: 0, sent: 0, retried: 0, failed: 0 };
  await withJobLock(JOB_NAME, async () => {
    result = await processMessageNotificationOutbox();
    if (result.claimed) logger.info('Message notification outbox processed', result);
  }, 120, { throwOnLockError: true });
  return result;
}

function startMessageNotificationOutboxJob() {
  cron.schedule(CRON_EXPRESSION, () => {
    runMessageNotificationOutbox().catch((error) => {
      logger.error('Message notification outbox worker failed', { error: error.message });
    });
  });
  logger.info('Message notification outbox job scheduled', { cron: CRON_EXPRESSION });
}

module.exports = {
  CRON_EXPRESSION,
  JOB_NAME,
  MAX_ATTEMPTS,
  claimMessageNotifications,
  finishMessageNotification,
  normalizePayload,
  processMessageNotificationOutbox,
  runMessageNotificationOutbox,
  startMessageNotificationOutboxJob,
};
