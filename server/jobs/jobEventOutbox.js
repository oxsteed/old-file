'use strict';

/**
 * Delivers job_event_outbox rows: bidder reconfirmation notices, saved-search
 * alerts, realtime/cache invalidation, and change-order money notices.
 *
 * Scale properties:
 *  - claims rows with FOR UPDATE SKIP LOCKED under a fenced job lock, so one
 *    worker process delivers each row and stale leases are reclaimed;
 *  - fans out to bidders in keyset-paginated chunks;
 *  - caps job-edit notices per helper per hour (JOB_EDIT_NOTIFY_MAX_PER_HOUR);
 *  - idempotency keys make retried deliveries safe.
 */

const cron = require('node-cron');
const crypto = require('crypto');
const logger = require('../utils/logger');
const db = require('../db');
const metrics = require('../services/metricsService');
const { sendNotification } = require('../services/notificationService');
const templates = require('../services/notificationTemplates');
const { EVENT_TYPES } = require('../services/jobEventOutbox');
const { withFencedJobLock } = require('./jobLockingService');

const CRON_EXPRESSION = '*/15 * * * * *';
const JOB_NAME = 'job-event-outbox';
const MAX_ATTEMPTS = 8;
const STALE_LOCK_MINUTES = 10;
const FANOUT_CHUNK = 500;
const SENT_RETENTION_DAYS = Number(process.env.JOB_EVENT_OUTBOX_RETENTION_DAYS || 14);
const MAX_NOTICES_PER_HOUR = Number(process.env.JOB_EDIT_NOTIFY_MAX_PER_HOUR || 6);

async function claimJobEvents(limit = 100) {
  const boundedLimit = Math.max(1, Math.min(Number(limit) || 100, 500));
  const leaseToken = crypto.randomUUID();
  const { rows } = await db.query(
    `WITH candidates AS (
       SELECT id FROM job_event_outbox
        WHERE (status = 'pending' AND next_attempt_at <= NOW())
           OR (status = 'sending' AND locked_at < NOW() - ($2::integer * INTERVAL '1 minute'))
        ORDER BY next_attempt_at, id
        FOR UPDATE SKIP LOCKED
        LIMIT $1
     )
     UPDATE job_event_outbox o
        SET status = 'sending', attempts = o.attempts + 1, locked_at = NOW(),
            lease_token = $3, updated_at = NOW()
       FROM candidates
      WHERE o.id = candidates.id
     RETURNING o.id, o.job_id, o.event_type, o.payload, o.attempts, o.lease_token`,
    [boundedLimit, STALE_LOCK_MINUTES, leaseToken]
  );
  return rows || [];
}

async function finishJobEvent(row, error = null) {
  const attempts = Number(row.attempts || 0);
  const failed = Boolean(error);
  const status = !failed ? 'sent' : attempts >= MAX_ATTEMPTS ? 'failed' : 'pending';
  const retryMinutes = Math.min(60, 2 ** Math.max(0, attempts - 1));
  const result = await db.query(
    `UPDATE job_event_outbox
        SET status = $1::text,
            sent_at = CASE WHEN $1::text = 'sent' THEN NOW() ELSE sent_at END,
            locked_at = NULL, lease_token = NULL,
            last_error = $2,
            next_attempt_at = CASE WHEN $1::text = 'pending' THEN NOW() + ($3::integer * INTERVAL '1 minute') ELSE next_attempt_at END,
            updated_at = NOW()
      WHERE id = $4 AND status = 'sending' AND lease_token = $5`,
    [status, failed ? String(error.message || error).slice(0, 2000) : null, retryMinutes, row.id, row.lease_token]
  );
  return result.rowCount === 1 ? status : 'stale';
}

function parsePayload(payload) {
  if (!payload) return {};
  if (typeof payload === 'string') {
    try { return JSON.parse(payload); } catch { return {}; }
  }
  return payload;
}

async function loadJob(jobId) {
  const { rows } = await db.query(
    `SELECT id, client_id, assigned_helper_id, title, description, category_name, status, revision, version,
            location_city, location_state, budget_min_cents, budget_max_cents, deleted_at
       FROM jobs WHERE id = $1`,
    [jobId]
  );
  return rows[0] || null;
}

/** Helpers already notified about this job's edits too often this hour are skipped. */
async function filterRateLimited(helperIds) {
  if (!helperIds.length || MAX_NOTICES_PER_HOUR <= 0) return helperIds;
  const { rows } = await db.query(
    `SELECT user_id, COUNT(*)::int AS n
       FROM notifications
      WHERE user_id = ANY($1::uuid[])
        AND type = 'job_updated_reconfirm'
        AND created_at >= NOW() - INTERVAL '1 hour'
      GROUP BY user_id`,
    [helperIds]
  ).catch(() => ({ rows: [] }));
  const over = new Set(rows.filter((r) => r.n >= MAX_NOTICES_PER_HOUR).map((r) => String(r.user_id)));
  return helperIds.filter((id) => !over.has(String(id)));
}

async function notifyBiddersOfMaterialChange(job, payload) {
  let cursor = null;
  let notified = 0;
  let throttled = 0;
  for (;;) {
    const { rows } = await db.query(
      `SELECT b.id, b.helper_id
         FROM bids b
        WHERE b.job_id = $1 AND b.status = 'pending' AND b.needs_reconfirm = TRUE
          AND ($2::uuid IS NULL OR b.id > $2::uuid)
        ORDER BY b.id
        LIMIT $3`,
      [job.id, cursor, FANOUT_CHUNK]
    );
    if (!rows.length) break;
    cursor = rows[rows.length - 1].id;
    const allowed = new Set(await filterRateLimited(rows.map((r) => r.helper_id)));
    for (const bid of rows) {
      if (!allowed.has(bid.helper_id)) { throttled += 1; continue; }
      const result = await sendNotification({
        userId: bid.helper_id,
        type: 'job_updated_reconfirm',
        title: 'A job you bid on changed',
        body: `"${String(job.title || '').slice(0, 120)}" was updated. Review the changes and reconfirm your bid.`,
        data: {
          job_id: job.id,
          bid_id: bid.id,
          revision: job.revision,
          changed_fields: Array.isArray(payload.changed_fields) ? payload.changed_fields.slice(0, 30) : [],
        },
        action_url: `/jobs/${job.id}`,
        idempotencyKey: `job-revision:${job.id}:${job.revision}:${bid.helper_id}`,
      });
      if (result?.success === false) throw new Error(result.error || 'notification failed');
      notified += 1;
    }
    if (rows.length < FANOUT_CHUNK) break;
  }
  metrics.incrementCounter('job_edit.bidder_notices', notified);
  if (throttled) metrics.incrementCounter('job_edit.bidder_notices_throttled', throttled);
  return { notified, throttled };
}

function savedSearchShape(job) {
  return {
    id: job.id,
    client_id: job.client_id,
    title: job.title,
    description: job.description,
    category: job.category_name,
    city: job.location_city,
    state: job.location_state,
    budget_cents: job.budget_max_cents ?? job.budget_min_cents ?? 0,
  };
}

async function alertSavedSearches(job) {
  let notifyMatchingSavedSearches;
  try { ({ notifyMatchingSavedSearches } = require('../routes/savedSearches')); } catch { return; }
  if (typeof notifyMatchingSavedSearches === 'function') await notifyMatchingSavedSearches(savedSearchShape(job));
}

async function broadcastInvalidation(job, payload) {
  const message = { jobId: job.id, version: job.version, revision: job.revision, changed_fields: payload.changed_fields || [] };
  try {
    const redis = require('../utils/redis');
    if (redis) await redis.publish('oxsteed:job-events', JSON.stringify({ type: EVENT_TYPES.UPDATED, ...message }));
  } catch (err) {
    logger.warn('job_event_outbox.redis_publish_failed', { jobId: job.id, error: err.message });
  }
  try {
    const socket = require('../services/socketService');
    socket.broadcastToUser?.(job.client_id, 'job:updated', message);
    const { rows } = await db.query(
      `SELECT DISTINCT helper_id FROM bids WHERE job_id = $1 AND status IN ('pending', 'accepted') LIMIT 5000`,
      [job.id]
    );
    for (const r of rows) socket.broadcastToUser?.(r.helper_id, 'job:updated', message);
  } catch (err) {
    logger.warn('job_event_outbox.socket_broadcast_failed', { jobId: job.id, error: err.message });
  }
}

async function notifyChangeOrderApplied(job, payload) {
  const recipients = [payload.customer_id, payload.helper_id].filter(Boolean);
  for (const userId of recipients) {
    const result = await sendNotification({
      userId,
      type: 'job_change_order_applied',
      title: 'Change order applied',
      body: payload.payment_action === 'reauthorization_required' || payload.credit_action === 'credit_reauthorization_required'
        ? 'The approved change order raised the job price. The customer needs to authorize the new amount before the job can be completed.'
        : 'The approved change order updated the job price.',
      data: { job_id: job.id, change_order_id: payload.change_order_id, payment_action: payload.payment_action || null, credit_action: payload.credit_action || null },
      action_url: `/jobs/${job.id}`,
      idempotencyKey: `job-change-order:${payload.change_order_id}:${userId}`,
    });
    if (result?.success === false) throw new Error(result.error || 'notification failed');
  }
}

async function localized(key, userId, params) {
  const recipient = await templates.loadRecipient(db, userId);
  return templates.render(key, recipient, params);
}

async function notifyPaymentReauthorization(job, eventType, payload) {
  if (eventType === EVENT_TYPES.PAYMENT_REAUTHORIZED) {
    for (const userId of [payload.customer_id || job.client_id, payload.helper_id || job.assigned_helper_id].filter(Boolean)) {
      const copy = await localized('payment_reauthorized', userId);
      const result = await sendNotification({
        userId,
        type: 'job_payment_reauthorized',
        title: copy.title,
        body: copy.body,
        data: { job_id: job.id, attempt_id: payload.attempt_id },
        action_url: `/jobs/${job.id}`,
        idempotencyKey: `job-payment-reauthorized:${payload.attempt_id}:${userId}`,
      });
      if (result?.success === false) throw new Error(result.error || 'notification failed');
    }
    return;
  }
  const expired = payload.reason === 'expired';
  const copy = await localized(expired ? 'payment_reauth_expired' : 'payment_reauth_declined', job.client_id);
  const result = await sendNotification({
    userId: job.client_id,
    type: 'job_payment_reauth_failed',
    title: copy.title,
    body: copy.body,
    data: { job_id: job.id, attempt_id: payload.attempt_id, reason: payload.reason || null },
    action_url: `/jobs/${job.id}`,
    idempotencyKey: `job-payment-reauth-failed:${payload.attempt_id}:${payload.reason}:${payload.failure_code || ''}`,
  });
  if (result?.success === false) throw new Error(result.error || 'notification failed');
}

/** Payment-layer notifications (localized; see services/notificationTemplates). */
async function notifyPaymentLayerEvent(job, eventType, payload) {
  const sends = [];
  if (eventType === EVENT_TYPES.PAYMENT_HOLD_EXPIRING) {
    sends.push({ userId: job.client_id, key: 'payment_hold_expiring', type: 'job_payment_hold_expiring', idem: `job-hold-expiring:${job.id}:${payload.payment_id}:${payload.expires_at}` });
  } else if (eventType === EVENT_TYPES.PAYMENT_CHARGED_NOW) {
    sends.push({ userId: job.client_id, key: 'payment_charged_now', type: 'job_payment_charged_now', idem: `job-charged-now:${payload.payment_id}`, params: { amount_minor: payload.amount_minor, currency: payload.currency } });
  } else if (eventType === EVENT_TYPES.RAIL_SWITCH_REQUESTED) {
    sends.push({ userId: payload.counterparty_id, key: 'rail_switch_requested', type: 'job_rail_switch_requested', idem: `job-rail-switch:${payload.request_id}:requested`, params: { rail: payload.to_rail } });
  } else if (eventType === EVENT_TYPES.RAIL_SWITCH_RESOLVED) {
    const key = payload.status === 'accepted' ? 'rail_switched' : 'rail_switch_declined';
    for (const userId of [job.client_id, job.assigned_helper_id].filter(Boolean)) {
      sends.push({ userId, key, type: 'job_rail_switch_resolved', idem: `job-rail-switch:${payload.request_id}:${payload.status}:${userId}`, params: { rail: payload.to_rail } });
    }
  }
  for (const send of sends) {
    if (!send.userId) continue;
    const copy = await localized(send.key, send.userId, send.params || {});
    const result = await sendNotification({
      userId: send.userId,
      type: send.type,
      title: copy.title,
      body: copy.body,
      data: { job_id: job.id, ...payload },
      action_url: `/jobs/${job.id}`,
      idempotencyKey: send.idem,
    });
    if (result?.success === false) throw new Error(result.error || 'notification failed');
  }
}

async function handleEvent(row) {
  const payload = parsePayload(row.payload);
  const job = await loadJob(row.job_id);
  if (!job || job.deleted_at) return;
  switch (row.event_type) {
    case EVENT_TYPES.UPDATED:
      await broadcastInvalidation(job, payload);
      return;
    case EVENT_TYPES.MATERIAL_CHANGE:
      await notifyBiddersOfMaterialChange(job, payload);
      if (['published', 'matched'].includes(job.status)) await alertSavedSearches(job);
      return;
    case EVENT_TYPES.PUBLISHED:
      if (['published', 'matched'].includes(job.status)) await alertSavedSearches(job);
      return;
    case EVENT_TYPES.CHANGE_ORDER_APPLIED:
      await notifyChangeOrderApplied(job, payload);
      return;
    case EVENT_TYPES.PAYMENT_REAUTHORIZED:
    case EVENT_TYPES.PAYMENT_REAUTH_FAILED:
      await notifyPaymentReauthorization(job, row.event_type, payload);
      return;
    case EVENT_TYPES.PAYMENT_HOLD_EXPIRING:
    case EVENT_TYPES.PAYMENT_CHARGED_NOW:
    case EVENT_TYPES.RAIL_SWITCH_REQUESTED:
    case EVENT_TYPES.RAIL_SWITCH_RESOLVED:
      await notifyPaymentLayerEvent(job, row.event_type, payload);
      return;
    default:
      logger.warn('job_event_outbox.unknown_event', { id: row.id, eventType: row.event_type });
  }
}

async function processJobEventOutbox(limit = 100) {
  const rows = await claimJobEvents(limit);
  const summary = { claimed: rows.length, sent: 0, retried: 0, failed: 0 };
  for (const row of rows) {
    const started = Date.now();
    let error = null;
    try {
      await handleEvent(row);
    } catch (err) {
      error = err;
      logger.warn('job_event_outbox.delivery_failed', { id: row.id, eventType: row.event_type, error: err.message });
    }
    const status = await finishJobEvent(row, error);
    metrics.recordHistogram('job_event_outbox.delivery_ms', Date.now() - started, { event: row.event_type });
    if (status === 'sent') summary.sent += 1;
    else if (status === 'pending') summary.retried += 1;
    else if (status === 'failed') summary.failed += 1;
  }
  if (summary.failed) metrics.incrementCounter('job_event_outbox.failed', summary.failed);
  return summary;
}

async function pruneJobEventOutbox() {
  const { rowCount } = await db.query(
    `DELETE FROM job_event_outbox
      WHERE id IN (
        SELECT id FROM job_event_outbox
         WHERE status IN ('sent', 'failed')
           AND COALESCE(sent_at, updated_at) < NOW() - ($1::integer * INTERVAL '1 day')
         LIMIT 5000)`,
    [SENT_RETENTION_DAYS]
  );
  return rowCount || 0;
}

async function runJobEventOutbox() {
  let result = { claimed: 0, sent: 0, retried: 0, failed: 0 };
  await withFencedJobLock(JOB_NAME, async (fence) => {
    fence.assertActive();
    result = await processJobEventOutbox();
    if (result.claimed) logger.info('Job event outbox processed', result);
    const { rows } = await db.query(
      `SELECT COUNT(*)::int AS n FROM job_event_outbox WHERE status = 'pending' AND next_attempt_at <= NOW()`
    );
    metrics.setGauge('job_event_outbox.due_backlog', rows[0]?.n || 0);
  }, 120, { throwOnLockError: true });
  return result;
}

function startJobEventOutboxJob() {
  cron.schedule(CRON_EXPRESSION, () => {
    runJobEventOutbox().catch((error) => {
      logger.error('Job event outbox worker failed', { error: error.message });
    });
  });
  // Expire unconfirmed change-order re-authorizations and release their holds.
  cron.schedule('*/10 * * * *', () => {
    withFencedJobLock('job-payment-reauth-expiry', async () => {
      const n = await require('../services/jobPaymentReauthorizationService').expireStaleReauthorizations();
      if (n) logger.info('Job payment re-authorizations expired', { count: n });
    }, 120).catch((error) => logger.error('Job payment re-authorization expiry failed', { error: error.message }));
  });
  cron.schedule('17 3 * * *', () => {
    pruneJobEventOutbox().catch((error) => logger.error('Job event outbox prune failed', { error: error.message }));
  });
  logger.info('Job event outbox job scheduled', { cron: CRON_EXPRESSION });
}

module.exports = {
  CRON_EXPRESSION,
  JOB_NAME,
  MAX_ATTEMPTS,
  claimJobEvents,
  finishJobEvent,
  handleEvent,
  processJobEventOutbox,
  pruneJobEventOutbox,
  runJobEventOutbox,
  startJobEventOutboxJob,
  savedSearchShape,
};
