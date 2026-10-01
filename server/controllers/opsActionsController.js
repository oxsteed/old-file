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
const { assertPublicWebhookTarget } = require('../utils/webhookUrlSafety');
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
  let safetyBlockReason = null;
  try {
    // SSRF guard (delivery time): re-resolve the target on every attempt so
    // DNS rebinding between registration and delivery cannot redirect the
    // POST at internal infrastructure. A failed check records the attempt
    // as failed without performing any fetch (fail closed).
    const safety = await assertPublicWebhookTarget(url);
    if (!safety.ok) {
      safetyBlockReason = safety.reason;
      logger.warn('Webhook redelivery blocked: target failed safety check', {
        deliveryId: deliveryRow.id,
        webhookId: deliveryRow.webhook_id,
        reason: safety.reason,
        ip: safety.ip,
      });
    } else {
      // DNS-change detection only: log it, do not break legit CDN rotations.
      // The public-IP check above is the enforcement.
      const pinned = webhookRow.pinned_ip ? String(webhookRow.pinned_ip) : null;
      if (pinned && !safety.ips.includes(pinned)) {
        logger.warn('Webhook target IP changed since registration', {
          deliveryId: deliveryRow.id,
          webhookId: deliveryRow.webhook_id,
          pinnedIp: pinned,
          resolvedIps: safety.ips,
        });
      }
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(deliveryRow.payload),
        signal: controller.signal,
        // Never follow redirects automatically: a 3xx to an internal URL
        // would bypass the safety check above. 3xx responses are recorded
        // as failed attempts by the status check below.
        redirect: 'manual',
      });
      status = response.status;
      bodyText = (await response.text()).slice(0, MAX_RESPONSE_BODY_CHARS);
    }
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
  const errorMessage = safetyBlockReason
    ? `Webhook target blocked by safety check: ${safetyBlockReason}`
    : (bodyText || (status === null ? 'Redelivery request failed' : `Webhook endpoint returned HTTP ${status}`));
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
 * Requeue one dead-lettered job by id. When no queue is supplied, every known
 * queue's dead-letter list is searched.
 * Shared by the admin ops endpoint and the connector API.
 *
 * @param {object} args
 * @param {string} args.jobId dead-lettered job id
 * @param {string} [args.queue] queue key; must be known when supplied
 * @param {string} args.actorId acting admin id for audit
 * @param {object} [args.req] express req for audit metadata
 * @param {string} [args.auditSource] 'admin' (default) or 'connector'
 * @returns {Promise<{queue: string, job: object}>}
 * @throws coded error (400 invalid_queue, 404 not_found)
 */
async function requeueDeadLetterById({ jobId, queue, actorId, req = null, auditSource = 'admin' }) {
  if (!jobId) {
    throw codedError(400, 'invalid_job_id', 'Job id is required');
  }
  if (queue !== undefined && queue !== null && queue !== '' && !isKnownQueueKey(queue)) {
    throw codedError(400, 'invalid_queue', `Queue must be one of: ${[...KNOWN_QUEUE_KEYS].join(', ')}`);
  }

  let recoveredJob = null;
  let foundQueue = null;
  if (queue) {
    recoveredJob = await requeueDeadLetterJob(queue, jobId);
    foundQueue = queue;
  } else {
    for (const queueKey of KNOWN_QUEUE_KEYS) {
      // eslint-disable-next-line no-await-in-loop
      const candidate = await requeueDeadLetterJob(queueKey, jobId);
      if (candidate) {
        recoveredJob = candidate;
        foundQueue = queueKey;
        break;
      }
    }
  }
  if (!recoveredJob) {
    throw codedError(404, 'not_found', 'Dead-lettered job not found');
  }

  const audit = markConnectorAudit({
    description: `Dead-lettered job requeued from queue ${foundQueue}`,
    after: { status: recoveredJob.status, queue: foundQueue },
  }, auditSource);
  await logAdminAction({
    adminId: actorId,
    action: 'ops_dead_letter_requeued',
    targetType: 'queue_job',
    targetId: String(jobId),
    description: audit.description,
    after: audit.after,
    req,
  });
  logger.info('Dead-lettered job requeued', { queue: foundQueue, jobId, adminId: actorId, source: auditSource });
  return { queue: foundQueue, job: recoveredJob };
}

/**
 * POST /api/admin/ops/queues/dead-letter/:jobId/requeue  { queue }
 */
async function requeueDeadLetter(req, res) {
  const { jobId } = req.params || {};
  const { queue } = req.body || {};
  try {
    const { job } = await requeueDeadLetterById({
      jobId,
      queue,
      actorId: req.user.id,
      req,
    });
    return res.json({ success: true, job });
  } catch (error) {
    if (sendCodedError(res, error)) return;
    logger.error('Requeue dead-letter job failed', { queue, jobId, error: error.message });
    return sendError(res, 500, 'Failed to requeue job');
  }
}

function codedError(statusCode, code, message) {
  const err = new Error(message);
  err.statusCode = statusCode;
  err.code = code;
  return err;
}

function markConnectorAudit({ description, after }, auditSource) {
  if (auditSource !== 'connector') return { description, after };
  return {
    description: `[connector] ${description}`,
    after: { ...(after || {}), source: 'connector' },
  };
}

/**
 * Retry one webhook delivery by id: load the delivery + webhook rows,
 * perform a single redelivery attempt, and audit it.
 * Shared by the admin ops endpoint and the connector API.
 *
 * @param {object} args
 * @param {string} args.deliveryId webhook_delivery_log id (UUID)
 * @param {string} args.actorId acting admin id for audit
 * @param {object} [args.req] express req for audit metadata
 * @param {string} [args.auditSource] 'admin' (default) or 'connector'
 * @returns {Promise<object>} the updated delivery row
 * @throws coded error (400 invalid_delivery_id, 404 not_found, 409 already_completed)
 */
async function retryWebhookDeliveryById({ deliveryId, actorId, req = null, auditSource = 'admin' }) {
  if (!deliveryId || !UUID_RE.test(deliveryId)) {
    throw codedError(400, 'invalid_delivery_id', 'deliveryId must be a valid UUID');
  }
  const loaded = await pool.query(
    `SELECT d.*,
            w.webhook_url,
            w.custom_headers,
            w.timeout_seconds,
            w.pinned_ip,
            w.is_active AS webhook_is_active
       FROM webhook_delivery_log d
       JOIN business_webhooks w ON w.id = d.webhook_id
      WHERE d.id = $1`,
    [deliveryId]
  );
  const row = loaded.rows[0];
  if (!row) {
    throw codedError(404, 'not_found', 'Webhook delivery not found');
  }
  if (row.completed_at) {
    throw codedError(409, 'already_completed', 'Webhook delivery is already completed');
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
    pinned_ip: row.pinned_ip,
  };
  const updated = await attemptWebhookRedelivery(deliveryRow, webhookRow);

  const audit = markConnectorAudit({
    description: `Webhook delivery retried (attempt ${updated ? updated.attempt_number : 'unknown'})`,
    after: updated ? { status: updated.status, attempt_number: updated.attempt_number } : null,
  }, auditSource);
  await logAdminAction({
    adminId: actorId,
    action: 'ops_webhook_delivery_retried',
    targetType: 'webhook_delivery',
    targetId: String(deliveryId),
    description: audit.description,
    after: audit.after,
    req,
  });
  logger.info('Webhook delivery retried by admin', {
    deliveryId,
    adminId: actorId,
    completed: Boolean(updated && updated.completed_at),
    source: auditSource,
  });
  return updated;
}

/**
 * Map a coded service error to the ops HTTP contract.
 * Returns true when the error was handled.
 */
function sendCodedError(res, error) {
  if (!error || !Number.isInteger(error.statusCode)) return false;
  if (error.statusCode === 400 && error.code === 'invalid_delivery_id') {
    sendValidationError(res, { deliveryId: 'Must be a valid UUID' });
  } else {
    sendError(res, error.statusCode, error.message, error.code);
  }
  return true;
}

/**
 * POST /api/admin/ops/webhooks/:deliveryId/retry
 */
async function retryWebhookDelivery(req, res) {
  const { deliveryId } = req.params || {};
  try {
    const updated = await retryWebhookDeliveryById({
      deliveryId,
      actorId: req.user.id,
      req,
    });
    return res.json({ success: true, delivery: updated });
  } catch (error) {
    if (sendCodedError(res, error)) return;
    logger.error('Retry webhook delivery failed', { deliveryId, error: error.message });
    return sendError(res, 500, 'Failed to retry webhook delivery');
  }
}

module.exports = {
  MAX_WEBHOOK_ATTEMPTS,
  attemptWebhookRedelivery,
  retryWebhookDeliveryById,
  requeueDeadLetterById,
  listDeadLetter,
  requeueDeadLetter,
  retryWebhookDelivery,
};
