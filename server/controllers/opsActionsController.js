'use strict';

/**
 * server/controllers/opsActionsController.js
 *
 * Admin operations actions: inspect queue dead-letter jobs, requeue them,
 * and manually retry failed webhook deliveries.
 *
 * All handlers require an admin caller with the `manage_operations` scope
 * (wired in server/routes/opsActions.js).
 */

const pool = require('../db');
const logger = require('../utils/logger');
const { sendError, sendValidationError } = require('../utils/apiError');
const { QUEUES, listDeadLetterJobs, requeueDeadLetterJob } = require('../services/paymentQueue');
const { logAdminAction } = require('../services/auditService');

const KNOWN_QUEUE_KEYS = new Set(Object.values(QUEUES));
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_WEBHOOK_TIMEOUT_MS = 30 * 1000;
const MAX_RESPONSE_BODY_CHARS = 2000;
const MAX_WEBHOOK_ATTEMPTS = 8;
const BACKOFF_CAP_MINUTES = 24 * 60;

function isKnownQueueKey(queueKey) {
  return typeof queueKey === 'string' && KNOWN_QUEUE_KEYS.has(queueKey);
}

/**
 * Perform one HTTP redelivery attempt for a webhook delivery log row.
 *
 * Shared by the admin retry endpoint and the webhook retry worker.
 *
 * On 2xx: marks the delivery completed (completed_at, status, truncated body).
 * On failure: bumps attempt_number, records the error, and schedules the next
 * retry with exponential backoff of 2^attempt minutes, capped at 24 hours.
 *
 * @param {object} deliveryRow - webhook_delivery_log row
 * @param {object} webhookRow  - business_webhooks row (webhook_url, custom_headers, timeout_seconds)
 * @returns {Promise<object>}  the updated delivery row
 */
async function attemptWebhookRedelivery(deliveryRow, webhookRow) {
  const url = webhookRow.webhook_url;
  const customHeaders =
    webhookRow.custom_headers && typeof webhookRow.custom_headers === 'object'
      ? webhookRow.custom_headers
      : {};
  const headers = {
    'Content-Type': 'application/json',
    'X-OxSteed-Event': deliveryRow.event_type,
    ...customHeaders,
  };
  const configuredTimeoutMs = Number(webhookRow.timeout_seconds) * 1000;
  const timeoutMs = Math.min(
    MAX_WEBHOOK_TIMEOUT_MS,
    Math.max(1, Number.isFinite(configuredTimeoutMs) ? configuredTimeoutMs : MAX_WEBHOOK_TIMEOUT_MS)
  );

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let status = null;
  let bodyText = '';
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(deliveryRow.payload),
      signal: controller.signal,
    });
    status = response.status;
    bodyText = (await response.text()).slice(0, MAX_RESPONSE_BODY_CHARS);
  } catch (error) {
    bodyText = String((error && error.message) || 'Redelivery request failed').slice(0, MAX_RESPONSE_BODY_CHARS);
  } finally {
    clearTimeout(timer);
  }

  if (status !== null && status >= 200 && status < 300) {
    const result = await pool.query(
      `UPDATE webhook_delivery_log
          SET completed_at = NOW(),
              http_status_code = $2,
              response_body = $3,
              error_message = NULL,
              next_retry_at = NULL
        WHERE id = $1
        RETURNING *`,
      [deliveryRow.id, status, bodyText]
    );
    logger.info('Webhook delivery redelivery succeeded', {
      deliveryId: deliveryRow.id,
      webhookId: deliveryRow.webhook_id,
      status,
    });
    return result.rows[0];
  }

  const attemptNumber = (Number(deliveryRow.attempt_number) || 0) + 1;
  const errorMessage =
    bodyText || (status === null ? 'Redelivery request failed' : `Webhook endpoint returned HTTP ${status}`);
  const backoffMinutes = Math.min(Math.pow(2, attemptNumber), BACKOFF_CAP_MINUTES);
  const result = await pool.query(
    `UPDATE webhook_delivery_log
        SET attempt_number = $2,
            http_status_code = $3,
            response_body = $4,
            error_message = $5,
            next_retry_at = NOW() + ($6 * INTERVAL '1 second')
      WHERE id = $1
      RETURNING *`,
    [deliveryRow.id, attemptNumber, status, bodyText, errorMessage, backoffMinutes * 60]
  );
  logger.warn('Webhook delivery redelivery failed', {
    deliveryId: deliveryRow.id,
    webhookId: deliveryRow.webhook_id,
    attemptNumber,
    status,
  });
  return result.rows[0];
}

/**
 * GET /api/admin/ops/queues/dead-letter?queue=<key>&limit=<n>
 */
async function listDeadLetter(req, res) {
  const { queue } = req.query || {};
  if (!isKnownQueueKey(queue)) {
    return sendValidationError(res, {
      queue: `Must be one of: ${[...KNOWN_QUEUE_KEYS].join(', ')}`,
    });
  }
  try {
    const jobs = await listDeadLetterJobs(queue, req.query.limit);
    return res.json({ queue, jobs });
  } catch (error) {
    logger.error('List dead-letter jobs failed', { queue, error: error.message });
    return sendError(res, 500, 'Failed to list dead-letter jobs');
  }
}

/**
 * POST /api/admin/ops/queues/dead-letter/:jobId/requeue  { queue }
 */
async function requeueDeadLetter(req, res) {
  const { jobId } = req.params || {};
  const { queue } = req.body || {};
  if (!isKnownQueueKey(queue)) {
    return sendValidationError(res, {
      queue: `Must be one of: ${[...KNOWN_QUEUE_KEYS].join(', ')}`,
    });
  }
  if (!jobId) {
    return sendValidationError(res, { jobId: 'Job id is required' });
  }
  try {
    const recoveredJob = await requeueDeadLetterJob(queue, jobId);
    if (!recoveredJob) {
      return sendError(res, 404, 'Dead-lettered job not found', 'not_found');
    }
    await logAdminAction({
      adminId: req.user.id,
      action: 'ops_dead_letter_requeued',
      targetType: 'queue_job',
      targetId: String(jobId),
      description: `Dead-lettered job requeued from queue ${queue}`,
      req,
    });
    logger.info('Dead-lettered job requeued', { queue, jobId, adminId: req.user.id });
    return res.json({ success: true, job: recoveredJob });
  } catch (error) {
    logger.error('Requeue dead-letter job failed', { queue, jobId, error: error.message });
    return sendError(res, 500, 'Failed to requeue job');
  }
}

/**
 * POST /api/admin/ops/webhooks/:deliveryId/retry
 */
async function retryWebhookDelivery(req, res) {
  const { deliveryId } = req.params || {};
  if (!deliveryId || !UUID_RE.test(deliveryId)) {
    return sendValidationError(res, { deliveryId: 'Must be a valid UUID' });
  }
  try {
    const loaded = await pool.query(
      `SELECT d.*,
              w.webhook_url,
              w.custom_headers,
              w.timeout_seconds,
              w.is_active AS webhook_is_active
         FROM webhook_delivery_log d
         JOIN business_webhooks w ON w.id = d.webhook_id
        WHERE d.id = $1`,
      [deliveryId]
    );
    const row = loaded.rows[0];
    if (!row) {
      return sendError(res, 404, 'Webhook delivery not found', 'not_found');
    }
    if (row.completed_at) {
      return sendError(res, 409, 'Webhook delivery is already completed', 'already_completed');
    }

    const deliveryRow = {
      id: row.id,
      webhook_id: row.webhook_id,
      event_type: row.event_type,
      payload: row.payload,
      attempt_number: row.attempt_number,
    };
    const webhookRow = {
      webhook_url: row.webhook_url,
      custom_headers: row.custom_headers,
      timeout_seconds: row.timeout_seconds,
    };
    const updated = await attemptWebhookRedelivery(deliveryRow, webhookRow);

    await logAdminAction({
      adminId: req.user.id,
      action: 'ops_webhook_delivery_retried',
      targetType: 'webhook_delivery',
      targetId: String(deliveryId),
      description: `Webhook delivery retried (attempt ${updated ? updated.attempt_number : 'unknown'})`,
      req,
    });
    logger.info('Webhook delivery retried by admin', {
      deliveryId,
      adminId: req.user.id,
      completed: Boolean(updated && updated.completed_at),
    });
    return res.json({ success: true, delivery: updated });
  } catch (error) {
    logger.error('Retry webhook delivery failed', { deliveryId, error: error.message });
    return sendError(res, 500, 'Failed to retry webhook delivery');
  }
}

module.exports = {
  MAX_WEBHOOK_ATTEMPTS,
  attemptWebhookRedelivery,
  listDeadLetter,
  requeueDeadLetter,
  retryWebhookDelivery,
};
