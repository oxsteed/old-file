'use strict';

const cron = require('node-cron');
const logger = require('../utils/logger');
const db = require('../db');
const { sendNotification } = require('../services/notificationService');
const { SUPPORTED_CREDIT_CURRENCY_META } = require('../services/oxsteedCreditService');
const { withFencedJobLock } = require('./jobLockingService');
const { recordOxsteedCreditJobFailure } = require('./oxsteedCreditJobFailure');
const incidentStore = require('../services/incidentStore');
const { recordOxsteedCreditWorkerRun } = require('../services/oxsteedCreditWorkerHeartbeat');
const { NOTIFICATION_BACKLOG_STALE_AFTER_MINUTES } = require('../services/oxsteedCreditWorkerConfig');
const { skipCreditJobWhenRailDisabled } = require('../services/oxsteedCreditService');

// Run every minute, offset from the other maintenance workers to avoid a
// connection-pool burst at the minute boundary.
const CRON_EXPRESSION = '30 * * * * *';
const JOB_NAME = 'oxsteed-credit-notification-outbox';
const MAX_ATTEMPTS = 8;
const STALE_LOCK_MINUTES = NOTIFICATION_BACKLOG_STALE_AFTER_MINUTES;
const DEFAULT_SENT_RETENTION_DAYS = 90;
const MIN_SENT_RETENTION_DAYS = 30;
const MAX_SENT_RETENTION_DAYS = 730;

function formatAmount(amountCents, currencyCode) {
  const currency = String(currencyCode || 'USD').toUpperCase();
  const minorUnits = Number.isInteger(SUPPORTED_CREDIT_CURRENCY_META[currency]?.minorUnits)
    ? SUPPORTED_CREDIT_CURRENCY_META[currency].minorUnits
    : 2;
  const amount = (Number(amountCents || 0) / (10 ** minorUnits));
  return `${currency} ${amount.toLocaleString('en-US', {
    useGrouping: false,
    minimumFractionDigits: minorUnits,
    maximumFractionDigits: minorUnits,
  })}`;
}

function buildNotification(payload) {
  if (payload.eventType === 'card_security') return {
    title: '', body: '', action_url: '/oxsteed-credit/cards',
    data: { cardId: payload.cardId, auditEventId: payload.auditEventId, eventType: 'card_security' },
  };
  const amount = formatAmount(payload.amountCents, payload.currencyCode);
  const eventType = String(payload.eventType || 'transaction_posted');
  const holdMessages = {
    hold_created: {
      title: 'OxSteed Credit reserved',
      body: `A ${amount} OxSteed Credit authorization is active and reserved for a purchase.`,
    },
    hold_captured: {
      title: 'OxSteed Credit payment completed',
      body: `Your ${amount} OxSteed Credit authorization was completed.`,
    },
    hold_released: {
      title: 'OxSteed Credit reservation released',
      body: `Your ${amount} OxSteed Credit authorization was released back to your available balance.`,
    },
    hold_expired: {
      title: 'OxSteed Credit reservation expired',
      body: `Your ${amount} OxSteed Credit authorization expired and was released back to your available balance.`,
    },
  };
  if (holdMessages[eventType]) {
    return {
      ...holdMessages[eventType],
      data: {
        creditHoldId: String(payload.holdId),
        eventType,
        status: payload.status || null,
        amountCents: Number(payload.amountCents || 0),
        currencyCode: String(payload.currencyCode || 'USD').toUpperCase(),
        partnerId: payload.partnerId || null,
        referenceType: payload.referenceType || null,
        referenceId: payload.referenceId || null,
      },
      action_url: '/oxsteed-credit',
    };
  }
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
      RETURNING outbox.id, outbox.user_id, outbox.transaction_id, outbox.hold_id,
                outbox.event_type, outbox.payload, outbox.attempts`,
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
     SET status = $1::varchar(20),
         sent_at = CASE WHEN $5::boolean THEN NOW() ELSE sent_at END,
         locked_at = NULL,
         last_error = $2,
         next_attempt_at = CASE WHEN $6::boolean THEN NOW() + ($3::integer * INTERVAL '1 minute') ELSE next_attempt_at END,
         updated_at = NOW()
     WHERE id = $4`,
    [
      status,
      succeeded ? null : String(result?.error || 'Credit notification delivery failed').slice(0, 2000),
      retryMinutes,
      id,
      succeeded,
      status === 'pending',
    ]
  );
  return status;
}

async function recordTerminalCreditNotificationFailure(row, result) {
  try {
    await incidentStore.recordIncident({
      type: 'oxsteed_credit_notification_delivery_failed',
      severity: 'critical',
      message: 'An OxSteed Credit customer notification reached its retry limit',
      dedupeKey: 'oxsteed-credit-notifications:terminal-failure',
      details: {
        notificationId: row.id,
        userId: row.user_id,
        transactionId: row.transaction_id || null,
        holdId: row.hold_id || null,
        eventType: row.event_type || 'transaction_posted',
        attempts: Number(row.attempts || 0),
        error: String(result?.error || 'Credit notification delivery failed').slice(0, 2000),
      },
    });
  } catch (error) {
    logger.error('OxSteed Credit notification failure incident could not be persisted', {
      notificationId: row.id,
      error: error.message,
    });
  }
}

async function processOxsteedCreditNotificationOutbox(limit = 50, replacementsEnabled = true) {
  if (replacementsEnabled) await require('../services/oxsteedCreditCardRecovery').processReplacementRequests();
  const rows = await claimCreditNotifications(limit);
  let sent = 0;
  let retried = 0;
  let failed = 0;

  for (const row of rows) {
    try {
      const payload = typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload;
      const notification = await sendNotification({
        userId: row.user_id,
        type: payload.eventType === 'card_security' ? 'oxsteed_credit_card_security' : 'oxsteed_credit_transaction',
        idempotencyKey: `credit-outbox:${row.id}`,
        ...buildNotification(payload),
      });
      const status = await finishCreditNotification(row.id, Number(row.attempts || 0), notification);
      if (status === 'sent') sent += 1;
      else if (status === 'pending') retried += 1;
      else {
        failed += 1;
        await recordTerminalCreditNotificationFailure(row, notification);
      }
    } catch (error) {
      const status = await finishCreditNotification(row.id, Number(row.attempts || 0), { success: false, error: error.message });
      if (status === 'pending') retried += 1;
      else {
        failed += 1;
        await recordTerminalCreditNotificationFailure(row, { success: false, error: error.message });
      }
    }
  }

  return { claimed: rows.length, sent, retried, failed };
}

function getSentRetentionDays(value = process.env.OXSTEED_CREDIT_NOTIFICATION_RETENTION_DAYS) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_SENT_RETENTION_DAYS;
  return Math.max(MIN_SENT_RETENTION_DAYS, Math.min(Math.floor(parsed), MAX_SENT_RETENTION_DAYS));
}

async function purgeSentCreditNotifications(limit = 1000, retentionDays = getSentRetentionDays()) {
  const boundedLimit = Math.max(1, Math.min(Number(limit) || 1000, 5000));
  const boundedRetentionDays = getSentRetentionDays(retentionDays);
  const result = await db.query(
    `WITH stale AS (
       SELECT id
       FROM oxsteed_credit_notification_outbox
       WHERE status = 'sent'
         AND sent_at IS NOT NULL
         AND sent_at < NOW() - ($2::integer * INTERVAL '1 day')
       ORDER BY sent_at ASC, id ASC
       FOR UPDATE SKIP LOCKED
       LIMIT $1
     )
     DELETE FROM oxsteed_credit_notification_outbox outbox
     USING stale
     WHERE outbox.id = stale.id
     RETURNING outbox.id`,
    [boundedLimit, boundedRetentionDays],
  );
  return result.rows?.length || 0;
}

async function purgeExpiredCardChallenges(limit = 1000) {
  // Ephemeral authentication material is not audit evidence. Preserve audit
  // events and replay receipts; remove only grants expired for 30 days.
  const result = await db.query(`WITH stale AS (
    SELECT id FROM oxsteed_credit_card_security_challenges
    WHERE expires_at < NOW() - INTERVAL '30 days'
    ORDER BY expires_at, id FOR UPDATE SKIP LOCKED LIMIT $1
  ) DELETE FROM oxsteed_credit_card_security_challenges challenge
    USING stale WHERE challenge.id = stale.id RETURNING challenge.id`,
  [Math.max(1, Math.min(Number(limit) || 1000, 5000))]);
  return result.rows?.length || 0;
}

async function runOxsteedCreditNotificationOutbox() {
  // Pausing the financial rail must not silence security notifications.
  // Only replacement issuance pauses; committed notices still drain.
  const railDisabled = await skipCreditJobWhenRailDisabled(JOB_NAME);
  let result = { claimed: 0, sent: 0, retried: 0, failed: 0, purged: 0, challengesPurged: 0 };
  let lockAcquired = false;
  try {
    await withFencedJobLock(JOB_NAME, async (fence) => {
      fence.assertActive(); // E03: abort the run if the job lease was lost
      lockAcquired = true;
      const processed = await processOxsteedCreditNotificationOutbox(50, !railDisabled);
      const purged = await purgeSentCreditNotifications();
      const challengesPurged = await purgeExpiredCardChallenges();
      result = { ...processed, purged, challengesPurged };
      if (result.claimed || result.purged) logger.info('OxSteed Credit notification outbox processed', result);
    }, 120, { throwOnLockError: true });
    if (lockAcquired) await recordOxsteedCreditWorkerRun({ jobName: JOB_NAME, result });
  } catch (error) {
    if (lockAcquired) await recordOxsteedCreditWorkerRun({ jobName: JOB_NAME, error });
    throw error;
  }
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
  DEFAULT_SENT_RETENTION_DAYS,
  MIN_SENT_RETENTION_DAYS,
  MAX_SENT_RETENTION_DAYS,
  buildNotification,
  claimCreditNotifications,
  finishCreditNotification,
  recordTerminalCreditNotificationFailure,
  processOxsteedCreditNotificationOutbox,
  getSentRetentionDays,
  purgeSentCreditNotifications,
  purgeExpiredCardChallenges,
  runOxsteedCreditNotificationOutbox,
  startOxsteedCreditNotificationOutboxJob,
};
