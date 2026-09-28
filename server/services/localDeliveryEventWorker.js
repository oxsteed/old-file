'use strict';

const pool = require('../db');
const logger = require('../utils/logger');
const { sendNotification } = require('./notificationService');
const { broadcastToUser } = require('./socketService');
const runtimeState = require('./runtimeState');
const { DELIVERY_NOTIFICATION_EVENTS } = require('../utils/localDeliveryNotifications');

const LEASE_MS = 60000;
const RETRY_BASE_MS = 5000;
const RETRY_MAX_MS = 3600000;
const PUBLIC_STATUSES = new Set(['posted', 'assigned', 'picked_up', 'in_transit', 'delivered', 'cancelled', 'failed', 'returned']);

// New audit/dispatch events must never become public merely because a producer
// queued them by mistake.
function getPublicDeliveryEventType(eventType) {
  if (eventType === 'delivery_coordinated') return 'delivery_assigned';
  return DELIVERY_NOTIFICATION_EVENTS.includes(eventType) ? eventType : null;
}

function buildPublicDeliveryEvent(row) {
  const eventType = getPublicDeliveryEventType(row.event_type);
  if (!eventType || row.customer_visible === false || row.payload?.customerVisible === false || row.payload?.customer_visible === false) return null;
  const event = {
    eventId: String(row.event_id),
    eventVersion: row.event_version,
    jobId: String(row.delivery_job_id),
    reference: row.reference,
    eventType,
    updatedAt: row.event_created_at,
  };
  if (PUBLIC_STATUSES.has(row.status)) event.status = row.status;
  // Never spread stored audit payloads, driver identity or dispatch source.
  if (eventType === 'delivery_eta_updated' || eventType === 'delivery_approaching') {
    const eta = row.payload?.etaAt;
    const time = typeof eta === 'string' ? Date.parse(eta) : NaN;
    event.etaAvailable = row.payload?.etaAvailable !== false && Number.isFinite(time);
    event.etaAt = event.etaAvailable ? new Date(time).toISOString() : null;
  }
  return event;
}

async function claimEvent() {
  // updated_at is the lease clock while processing and retry clock on failure.
  // attempts fences stale owners. Existing abandoned claims are recoverable
  // without requiring new schema columns.
  const { rows } = await pool.query(
    `WITH candidate AS (
       SELECT event_id, consumer FROM delivery_event_deliveries
        WHERE consumer IN ('notifications', 'realtime') AND (
          status = 'pending'
          OR (status = 'processing' AND updated_at <= NOW() - ($1 * INTERVAL '1 millisecond'))
          OR (status = 'failed' AND updated_at <= NOW() - (
            LEAST($3::double precision, $2::double precision * POWER(2, LEAST(GREATEST(attempts - 1, 0), 20))) * INTERVAL '1 millisecond'))
        )
        ORDER BY updated_at, event_id, consumer
        FOR UPDATE SKIP LOCKED
        LIMIT 1
     ), claimed AS (
       UPDATE delivery_event_deliveries ded
          SET status = 'processing', attempts = ded.attempts + 1, updated_at = NOW()
         FROM candidate c
        WHERE ded.event_id = c.event_id AND ded.consumer = c.consumer
        RETURNING ded.event_id, ded.consumer, ded.attempts
     )
     SELECT c.*, de.delivery_job_id, de.event_type, de.event_version, de.actor_user_id,
            de.payload, de.customer_visible, de.created_at AS event_created_at, dj.reference, dj.status,
            dj.customer_user_id, dj.helper_user_id, dj.internal_driver_user_id
       FROM claimed c JOIN delivery_events de ON de.id = c.event_id
       JOIN delivery_jobs dj ON dj.id = de.delivery_job_id`,
    [LEASE_MS, RETRY_BASE_MS, RETRY_MAX_MS],
  );
  return rows[0];
}

async function renewLease(row) {
  const { rowCount } = await pool.query(
    `UPDATE delivery_event_deliveries SET updated_at = NOW()
      WHERE event_id = $1 AND consumer = $2 AND attempts = $3 AND status = 'processing'
        AND updated_at > NOW() - ($4 * INTERVAL '1 millisecond')`,
    [row.event_id, row.consumer, row.attempts, LEASE_MS],
  );
  if (!rowCount) throw new Error('delivery_event_lease_lost');
}

async function finishEvent(row, status, errorCode = null) {
  const { rowCount } = await pool.query(
    `UPDATE delivery_event_deliveries
        SET status = $4::varchar, last_error = $5, updated_at = NOW(),
            delivered_at = CASE WHEN $4::varchar = 'delivered' THEN NOW() ELSE NULL END
      WHERE event_id = $1 AND consumer = $2 AND attempts = $3 AND status = 'processing'
        AND updated_at > NOW() - ($6 * INTERVAL '1 millisecond')`,
    [row.event_id, row.consumer, row.attempts, status, errorCode, LEASE_MS],
  );
  return rowCount > 0;
}

async function deliverEvent(row) {
  const event = buildPublicDeliveryEvent(row);
  if (!event) return; // Retire legacy private rows without public fan-out.
  if (row.consumer === 'realtime' && !runtimeState.snapshot().realtimeReady) {
    throw new Error('delivery_realtime_unavailable');
  }
  const recipients = new Set([row.customer_user_id, row.helper_user_id, row.internal_driver_user_id]
    .filter(Boolean).map(String));
  // The actor's other devices need invalidation, but not a push for their own
  // action. Stable eventId lets clients deduplicate at-least-once replay.
  if (row.consumer === 'notifications') recipients.delete(String(row.actor_user_id));
  for (const userId of recipients) {
    await renewLease(row);
    if (row.consumer === 'realtime') {
      await broadcastToUser(userId, 'delivery:updated', event);
    } else {
      const result = await sendNotification({
        userId,
        type: 'delivery:' + event.eventType,
        // notificationService translates for the recipient. English body copy
        // here would be appended to the localized translation.
        body: row.reference ? '(' + row.reference + ')' : '',
        data: { deliveryJobId: event.jobId, eventId: event.eventId, eventType: event.eventType },
        action_url: '/delivery/jobs/' + event.jobId,
        idempotencyKey: 'delivery-event:' + row.event_id + ':' + userId,
      });
      if (result?.success !== true) throw new Error('delivery_notification_failed');
    }
  }
}

async function processDeliveryEvents(limit = 25, { shouldStop = () => false } = {}) {
  let scanned = 0;
  let delivered = 0;
  let failed = 0;
  const batchSize = Math.max(0, Math.min(100, Math.floor(Number(limit) || 0)));
  while (scanned < batchSize && !shouldStop()) {
    // Claim one at a time: a slow recipient must not expire an entire batch.
    const row = await claimEvent();
    if (!row) break;
    scanned += 1;
    let leaseError = null;
    let renewal = null;
    const timer = setInterval(() => {
      if (renewal) return;
      renewal = renewLease(row).catch((error) => { leaseError = error; })
        .finally(() => { renewal = null; });
    }, LEASE_MS / 3);
    timer.unref?.();
    try {
      await deliverEvent(row);
      if (leaseError) throw leaseError;
      if (await finishEvent(row, 'delivered')) delivered += 1;
    } catch (error) {
      // Transport errors may contain private payloads; persist a bounded code.
      if (await finishEvent(row, 'failed', 'delivery_consumer_failed')) failed += 1;
      logger.warn('Local delivery event consumer failed', { eventId: row.event_id, consumer: row.consumer });
    } finally {
      clearInterval(timer);
      if (renewal) await renewal;
    }
  }
  return { scanned, delivered, failed };
}

function startLocalDeliveryEventWorker({ pollMs = 1500, log = logger } = {}) {
  let stopped = false;
  let inFlight = null;
  const tick = () => {
    if (stopped || inFlight) return;
    inFlight = processDeliveryEvents(25, { shouldStop: () => stopped })
      .catch(() => log.warn('Local delivery event worker poll failed'))
      .finally(() => { inFlight = null; });
  };
  const timer = setInterval(tick, pollMs);
  timer.unref?.();
  return {
    stop() {
      stopped = true;
      clearInterval(timer);
      return inFlight || Promise.resolve();
    },
  };
}

module.exports = { processDeliveryEvents, startLocalDeliveryEventWorker, getPublicDeliveryEventType, buildPublicDeliveryEvent };
