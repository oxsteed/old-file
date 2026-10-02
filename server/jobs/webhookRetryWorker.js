'use strict';

/**
 * server/jobs/webhookRetryWorker.js
 *
 * Periodic retry of pending business webhook deliveries. Picks up due rows
 * from webhook_delivery_log and re-attempts them via the shared
 * attemptWebhookRedelivery helper. Deliveries that exhaust the retry budget
 * (attempt_number >= MAX_WEBHOOK_ATTEMPTS) are marked permanently failed and
 * surfaced as an incident for operations.
 */

const cron = require('node-cron');
const pool = require('../db');
const logger = require('../utils/logger');
const { withFencedJobLock } = require('./jobLockingService');
const { attemptWebhookRedelivery, MAX_WEBHOOK_ATTEMPTS } = require('../controllers/opsActionsController');

const CRON_EXPRESSION = '*/2 * * * *';
const CRON_TIMEZONE = 'UTC';
const JOB_NAME = 'webhook-retry';
const BATCH_SIZE = 50;

async function runWebhookRetryWorker({ limit = BATCH_SIZE } = {}) {
  const boundedLimit = Math.min(BATCH_SIZE, Math.max(1, Number(limit) || BATCH_SIZE));
  const result = { locked: false, inspected: 0, delivered: 0, failed: 0, exhausted: 0 };

  await withFencedJobLock(JOB_NAME, async (fence) => {
    fence.assertActive(); // E03: abort the run if the job lease was lost
    result.locked = true;
    const due = await fence.db.query(
      `SELECT d.*
         FROM webhook_delivery_log d
        WHERE d.completed_at IS NULL
          AND d.next_retry_at <= NOW()
          AND d.attempt_number < $1
        ORDER BY d.next_retry_at ASC
        LIMIT $2`,
      [MAX_WEBHOOK_ATTEMPTS, boundedLimit]
    );
    result.inspected = due.rows.length;

    for (const delivery of due.rows) {
      const webhookResult = await fence.db.query(
        `SELECT id, webhook_url, custom_headers, timeout_seconds, is_active, pinned_ip
           FROM business_webhooks
          WHERE id = $1`,
        [delivery.webhook_id]
      );
      const webhook = webhookResult.rows[0];
      if (!webhook) {
        logger.warn('Webhook retry skipped: parent webhook row missing', {
          deliveryId: delivery.id,
          webhookId: delivery.webhook_id,
        });
        continue;
      }

      let updated = null;
      try {
        updated = await attemptWebhookRedelivery(delivery, webhook);
      } catch (error) {
        result.failed += 1;
        logger.error('Webhook retry attempt errored', {
          deliveryId: delivery.id,
          error: error.message,
        });
        continue;
      }

      if (updated && updated.completed_at) {
        result.delivered += 1;
        continue;
      }

      result.failed += 1;
      if (updated && Number(updated.attempt_number) >= MAX_WEBHOOK_ATTEMPTS) {
        await fence.db.query(
          `UPDATE webhook_delivery_log
              SET error_message = 'retry budget exhausted',
                  next_retry_at = NULL
            WHERE id = $1`,
          [delivery.id]
        );
        result.exhausted += 1;
        await require('../services/incidentStore').recordIncident({
          type: 'webhook_delivery_failed',
          severity: 'warning',
          message: `Webhook delivery ${delivery.id} exhausted its retry budget after ${MAX_WEBHOOK_ATTEMPTS} attempts`,
          details: { deliveryId: delivery.id },
        });
        logger.warn('Webhook delivery retry budget exhausted', { deliveryId: delivery.id });
      }
    }
  });

  return result;
}

function startWebhookRetryJob() {
  cron.schedule(CRON_EXPRESSION, () => {
    runWebhookRetryWorker().catch((error) => {
      logger.error('Webhook retry worker failed', { error: error.message });
    });
  }, { timezone: CRON_TIMEZONE });
  logger.info('Webhook retry job scheduled', {
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
  runWebhookRetryWorker,
  startWebhookRetryJob,
};
