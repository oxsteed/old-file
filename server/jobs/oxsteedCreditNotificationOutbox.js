'use strict';

const cron = require('node-cron');
const logger = require('../utils/logger');
const db = require('../db');
const { sendNotification } = require('../services/notificationService');
const { withJobLock } = require('./jobLockingService');
const { recordOxsteedCreditJobFailure } = require('./oxsteedCreditJobFailure');

const CRON_EXPRESSION = '* * * * *';
const JOB_NAME = 'oxsteed-credit-notification-outbox';
const MAX_ATTEMPTS = 8;
const STALE_LOCK_MINUTES = 15;

function formatAmount(amountCents, currencyCode) {
  const amount = (Number(amountCents || 0) / 100).toFixed(2);
  return `${String(currencyCode || 'USD').toUpperCase()} ${amount}`;
}

function buildNotification(payload) {
  const amount = formatAmount(payload.amountCents, payload.currencyCode);
  const transactionType = String(payload.transactionType || 'transaction').replace(/_/g, ' ');
  const direction = payload.direction === 'debit' ? 'spent' : 'received';
  const title = 'OxSteed Credit activity';
  const body = direction === 'spent'
    ? `You spent ${amount} in OxSteed Credit (${transactionType}).`
    : `You received ${amount} in OxSteed Credit (${transactionType}).`;
  return {
    title,
    body,
    data: {
      creditTransactionId: String(payload.transactionId),
      transactionType: payload.transactionType || null,
      direction,
      amountCents: Number(payload.amountCents || 0),
      currencyCode: String(payload.currencyCode || 'USD').toUpperCase(),
      partnerId: payload.partnerId || null,
      referenceType: payload.referenceType || null,
      referenceId: payload.referenceId || null,
    },
    action_url: '/oxsteed-credit',
  };
}

async function claimCreditNotifications(limit = 50) {
  const boundedLimit = Math.max(1, Math.min(Number(limit) || 50, 200));
  const result = await db.query(
    `WITH candidates AS (
       SELECT id
       FROM oxsteed_credit_notification_outbox
       WHERE (status = 'pending' AND next_attempt_at <= NOW())
          OR (status = 'sending' AND locked_at < NOW() - ($2::integer * INTERVAL '1 minute'))
       ORDER BY created_at, id
       FOR UPDATE SKIP LOCKED
       LIMIT $1
     )
     UPDATE oxsteed_credit_notification_outbox outbox
     SET status = 'sending', attempts = outbox.attempts + 1,
         locked_at = NOW(), updated_at = NOW()
     FROM candidates
     WHERE outbox.id = candidates.id
     RETURNING outbox.id, outbox.user_id, outbox.payload, outbox.attempts`,
    [boundedLimit, STALE_LOCK_MINUTES]
  );
  return result.rows || [];
}

async function finishCreditNotification(id, attempts, result) {
  const succeeded = result?.success !== false;
  const terminal = !succeeded && attempts >= MAX_ATTEMPTS;
  const status = succeeded ? 'sent' : terminal ? 'failed' : 'pending';
  const retryMinutes = Math.min(60, 2 ** Math.max(0, attempts - 1));
  await db.query(
    `UPDATE oxsteed_credit_notification_outbox
     SET status = $1,
         sent_at = CASE WHEN $1 = 'sent' THEN NOW() ELSE sent_at END,
         locked_at = NULL,
         last_error = $2,
         next_attempt_at = CASE WHEN $1 = 'pending' THEN NOW() + ($3::integer * INTERVAL '1 minute') ELSE next_attempt_at END,
         updated_at = NOW()
     WHERE id = $4`,
    [status, succeeded ? null : String(result?.error || 'Credit notification delivery failed').slice(0, 2000), retryMinutes, id]
  );
  return status;
}

async function processOxsteedCreditNotificationOutbox(limit = 50) {
  const rows = await claimCreditNotifications(limit);
  let sent = 0;
  let retried = 0;
  let failed = 0;

  for (const row of rows) {
    try {
      const payload = typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload;
      const notification = await sendNotification({
        userId: row.user_id,
        type: 'oxsteed_credit_transaction',
        ...buildNotification(payload),
      });
      const status = await finishCreditNotification(row.id, Number(row.attempts || 0), notification);
      if (status === 'sent') sent += 1;
      else if (status === 'pending') retried += 1;
      else failed += 1;
    } catch (error) {
      const status = await finishCreditNotification(row.id, Number(row.attempts || 0), { success: false, error: error.message });
      if (status === 'pending') retried += 1;
      else failed += 1;
    }
  }

  return { claimed: rows.length, sent, retried, failed };
}

async function runOxsteedCreditNotificationOutbox() {
  let result = { claimed: 0, sent: 0, retried: 0, failed: 0 };
  await withJobLock(JOB_NAME, async () => {
    result = await processOxsteedCreditNotificationOutbox();
    if (result.claimed) logger.info('OxSteed Credit notification outbox processed', result);
  }, 120, { throwOnLockError: true });
  return result;
}

function startOxsteedCreditNotificationOutboxJob() {
  cron.schedule(CRON_EXPRESSION, () => {
    runOxsteedCreditNotificationOutbox().catch((error) => {
      return recordOxsteedCreditJobFailure({
        jobName: JOB_NAME,
        error,
        details: { limit: 50 },
      });
    });
  });
  logger.info('OxSteed Credit notification outbox job scheduled', { cron: CRON_EXPRESSION });
}

module.exports = {
  CRON_EXPRESSION,
  JOB_NAME,
  MAX_ATTEMPTS,
  buildNotification,
  claimCreditNotifications,
  finishCreditNotification,
  processOxsteedCreditNotificationOutbox,
  runOxsteedCreditNotificationOutbox,
  startOxsteedCreditNotificationOutboxJob,
};
