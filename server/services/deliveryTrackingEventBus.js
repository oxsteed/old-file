'use strict';

/**
 * server/services/deliveryTrackingEventBus.js
 *
 * Realtime broadcast layer for delivery tracking events
 * (docs/oxsteed-delivery-full-tracking-integration-plan.md).
 *
 * `publishTrackingEvent()` is the single fan-out point for the eight
 * plan-defined tracking socket events:
 *   location_updated, eta_updated, geofence_arrival, geofence_departure,
 *   scan_recorded, tracking_stale, tracking_reconnected, tracking_exception
 *
 * What it does, in order:
 *   1. Validates the event type.
 *   2. Idempotency: when `idempotencyKey` (or a provider/provider_event_id
 *      pair) is given, an already-published event is skipped entirely —
 *      no row, no broadcast. This absorbs provider retries and mobile
 *      replay without double-notifying.
 *   3. Optionally persists a `delivery_tracking_events` row
 *      (`insertEvent`, default true). Controller hooks pass
 *      `insertEvent: false` because the tracking services already wrote
 *      the event row in the same write path; the bus then only fans out.
 *      Note: the plan's `location_updated` socket event is stored as
 *      `location_batch` to satisfy migration 576's CHECK constraint.
 *   4. Broadcasts a CUSTOMER-SAFE projection to the `delivery_<jobId>`
 *      room (event `tracking:<eventType>`). Participants — the customer,
 *      the assigned driver, and authorized viewers — join this room when
 *      they open the tracking view (see the `delivery:join` handler in
 *      server/realtime/chatNamespace.js).
 *   5. Broadcasts the EXACT payload to the `ops_delivery` room (event
 *      `tracking:ops:<eventType>`). Only admin/super_admin sockets join
 *      that room (on connect, next to the `admins` room).
 *
 * Customer-safe projection rules (allow-listed per event type below):
 *   - Approximate area only: coordinates are rounded to 2 decimals
 *     (~1.1km grid, 500m accuracy radius) — the same privacy grid used by
 *     deliveryTrackingLinkService. The rounding is duplicated here rather
 *     than imported so this module never depends on tracking service
 *     internals.
 *   - ETA + freshness, milestone labels, and timestamps are safe.
 *   - NEVER emitted to customers: exact coordinates, driver identity,
 *     tracker/device IDs, provider names, fulfillment source, private
 *     notes. Callers may pass those in `payload` — the customer projector
 *     strips them; only the ops envelope carries them through.
 *
 * Throttling: driver/telematics location batches are high-frequency.
 * Customer broadcasts for `location_updated` are capped at 1/minute per
 * delivery (in-memory). The ops room receives every batch.
 *
 * CLIENT CONTRACT (socket reconnect):
 * Tracking socket events are point-in-time broadcasts, not state. After
 * any reconnect the client MUST reload authoritative state via
 *   GET /api/delivery/jobs/:id/tracking/customer-state   (customer-safe)
 *   GET /api/delivery/internal/jobs/:id/tracking/exact   (operations)
 * and re-emit `delivery:join` for the job. Never reconstruct position
 * history from cached socket events.
 */

const pool = require('../db');
const logger = require('../utils/logger');
const socketService = require('./socketService');
const { tryAcquireOnce, releaseFence, clearMemoryFences } = require('../utils/processState');

// Plan-defined socket event types. Everything else is rejected.
const TRACKING_SOCKET_EVENTS = new Set([
  'location_updated',
  'eta_updated',
  'geofence_arrival',
  'geofence_departure',
  'scan_recorded',
  'tracking_stale',
  'tracking_reconnected',
  'tracking_exception',
]);

// Socket event -> delivery_tracking_events.event_type. Migration 576 stores
// GPS batches as `location_batch`; every other plan type maps 1:1.
const DB_EVENT_TYPE = {
  location_updated: 'location_batch',
};

// Privacy grid: 2-decimal rounding (~1.1km) + 500m accuracy radius. Mirrors
// deliveryTrackingLinkService (APPROX_DECIMALS/APPROX_RADIUS_METERS).
const APPROX_DECIMALS = 2;
const APPROX_RADIUS_METERS = 500;

// Customer broadcasts for location_updated: at most 1/minute per delivery.
const LOCATION_CUSTOMER_THROTTLE_MS = 60 * 1000;

// V2-P1-06: idempotency and the customer broadcast throttle are
// cross-process concerns, so they are fenced through the shared
// process-state contract (Redis SET NX EX when Redis is configured,
// bounded in-memory fallback for single-process dev/test).
//
// - Publish fence: only the first publisher across ALL processes wins the
//   slot for (deliveryJobId, idempotencyKey) within the 10-minute burst
//   window. The delivery_tracking_events row (findDuplicatePublish) stays
//   the long-term cross-process source of truth.
// - Customer throttle: at most one customer-visible location_updated per
//   delivery per minute across ALL processes (previously each process
//   allowed its own 1/minute).
const IDEMPOTENCY_FENCE_TTL_SECONDS = 10 * 60;
const CUSTOMER_THROTTLE_WINDOW_SECONDS = LOCATION_CUSTOMER_THROTTLE_MS / 1000;

function roundApprox(value) {
  const factor = 10 ** APPROX_DECIMALS;
  return Math.round(Number(value) * factor) / factor;
}

function toIso(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  const ms = date.getTime();
  return Number.isFinite(ms) ? date.toISOString() : null;
}

/**
 * Approximate area for a coordinate pair. Returns null when the coordinates
 * are not finite so callers can drop the customer event instead of leaking.
 */
function approximateAreaFrom(latitude, longitude) {
  const lat = Number(latitude);
  const lng = Number(longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return {
    approxLat: roundApprox(lat),
    approxLng: roundApprox(lng),
    accuracyRadiusMeters: APPROX_RADIUS_METERS,
  };
}

const SCAN_MILESTONE_LABELS = {
  pickup: 'Pickup confirmed',
  handoff: 'Handed off',
  arrival: 'Arrived at destination',
  return: 'Return started',
  exception: 'Issue reported',
};

function geofenceMilestoneLabel(eventType, geofenceKind) {
  const kind = geofenceKind === 'pickup' ? 'pickup' : 'destination';
  if (eventType === 'geofence_arrival') {
    return kind === 'pickup' ? 'Arrived at pickup' : 'Approaching destination';
  }
  return kind === 'pickup' ? 'Departed pickup' : 'Departed destination';
}

/**
 * Build the customer-safe projection for an event. Allow-listed per type:
 * anything not explicitly copied here never reaches the customer room.
 * Returns null when there is nothing safe to broadcast (caller skips the
 * customer emit).
 */
function buildCustomerData(eventType, payload) {
  switch (eventType) {
    case 'location_updated': {
      const latest = payload.latest || payload.location || null;
      const area = latest ? approximateAreaFrom(latest.latitude, latest.longitude) : null;
      if (!area) return null;
      const data = { approximateArea: area };
      const recordedAt = toIso((latest && latest.recordedAt) || payload.recordedAt);
      if (recordedAt) data.recordedAt = recordedAt;
      return data;
    }
    case 'eta_updated': {
      const etaAt = toIso(payload.etaAt);
      const fresh = Boolean(etaAt) && !payload.stale;
      return { eta: { at: fresh ? etaAt : null, freshness: fresh ? 'fresh' : 'stale' } };
    }
    case 'geofence_arrival':
    case 'geofence_departure': {
      const area = approximateAreaFrom(payload.latitude, payload.longitude);
      const data = {
        milestone: geofenceMilestoneLabel(eventType, payload.geofenceKind),
        geofenceKind: payload.geofenceKind || null,
      };
      if (area) data.approximateArea = area;
      const observedAt = toIso(payload.observedAt);
      if (observedAt) data.observedAt = observedAt;
      return data;
    }
    case 'scan_recorded': {
      const data = {
        milestone: SCAN_MILESTONE_LABELS[payload.scanType] || 'Scan recorded',
        scanType: payload.scanType || null,
      };
      const scannedAt = toIso(payload.scannedAt);
      if (scannedAt) data.scannedAt = scannedAt;
      return data;
    }
    case 'tracking_stale': {
      const data = {};
      const lastUpdateAt = toIso(payload.lastUpdateAt);
      if (lastUpdateAt) data.lastUpdateAt = lastUpdateAt;
      return data;
    }
    case 'tracking_reconnected':
    case 'tracking_exception':
      // Signal only; details are ops-only or require a state reload.
      return {};
    default:
      return null;
  }
}

/**
 * Burst fence for provider retries / mobile replay. Returns true when this
 * event was already claimed by a publisher (this process or another) inside
 * the fence window — i.e. a duplicate that must be skipped.
 */
async function seenRecently(deliveryJobId, idempotencyKey) {
  const acquired = await tryAcquireOnce(
    `${deliveryJobId}:${idempotencyKey}`,
    IDEMPOTENCY_FENCE_TTL_SECONDS,
    { namespace: 'tracking-publish' }
  );
  return !acquired;
}

/**
 * Cross-process duplicate check: a row carrying the same idempotency key
 * (stored in the event payload) or the same provider/provider_event_id pair
 * means this event was already published.
 */
async function findDuplicatePublish({ deliveryJobId, idempotencyKey, provider, providerEventId }) {
  if (idempotencyKey) {
    const { rows } = await pool.query(
      `SELECT 1 FROM delivery_tracking_events
        WHERE delivery_job_id = $1
          AND payload->>'idempotency_key' = $2
        LIMIT 1`,
      [deliveryJobId, idempotencyKey]
    );
    if (rows.length) return true;
  }
  if (provider && providerEventId) {
    const { rows } = await pool.query(
      `SELECT 1 FROM delivery_tracking_events
        WHERE provider = $1 AND provider_event_id = $2
        LIMIT 1`,
      [provider, providerEventId]
    );
    if (rows.length) return true;
  }
  return false;
}

/**
 * Customer location_updated broadcasts are capped at 1/minute per delivery
 * across all processes. Returns true when the customer emit must be skipped
 * this time.
 */
async function customerLocationThrottled(deliveryJobId) {
  const allowed = await tryAcquireOnce(
    String(deliveryJobId),
    CUSTOMER_THROTTLE_WINDOW_SECONDS,
    { namespace: 'tracking-customer-throttle' }
  );
  return !allowed;
}

/**
 * Publish a tracking event to realtime rooms.
 *
 * @param {object} args
 * @param {string|number} args.deliveryJobId
 * @param {string} args.eventType one of the eight plan event types
 * @param {object} [args.payload] exact event data (ops room gets it verbatim;
 *   the customer room gets only the safe projection)
 * @param {string} [args.actorUserId]
 * @param {number} [args.assignmentId]
 * @param {boolean} [args.customerVisible=true] false for ops-only events
 *   (e.g. point reviews whose notes are internal)
 * @param {boolean} [args.insertEvent=true] persist a
 *   delivery_tracking_events row. Controller hooks pass false because the
 *   tracking service already wrote the row in the same write path.
 * @param {string} [args.idempotencyKey] skips duplicate publishes
 * @param {string} [args.provider] telematics provider name (ops only)
 * @param {string} [args.providerEventId] (ops only)
 * @returns {Promise<{published: boolean, duplicate?: boolean, eventId?: number}>}
 */
async function publishTrackingEvent({
  deliveryJobId,
  eventType,
  payload = {},
  actorUserId = null,
  assignmentId = null,
  customerVisible = true,
  insertEvent = true,
  idempotencyKey = null,
  provider = null,
  providerEventId = null,
}) {
  if (!deliveryJobId) {
    throw new Error('publishTrackingEvent: deliveryJobId is required');
  }
  if (!TRACKING_SOCKET_EVENTS.has(eventType)) {
    throw new Error(`publishTrackingEvent: unknown tracking event type "${eventType}"`);
  }
  const data = payload && typeof payload === 'object' ? payload : {};

  // Idempotency: skip duplicate publishes before any write or broadcast.
  // The publish fence is claimed here (first publisher wins across
  // processes); the DB row check below is the long-term source of truth.
  const publishFenceKey = idempotencyKey ? `${deliveryJobId}:${idempotencyKey}` : null;
  let publishFenceClaimed = false;
  if (idempotencyKey || (provider && providerEventId)) {
    if (idempotencyKey) {
      publishFenceClaimed = !(await seenRecently(deliveryJobId, idempotencyKey));
      if (!publishFenceClaimed) return { published: false, duplicate: true };
    }
    if (await findDuplicatePublish({ deliveryJobId, idempotencyKey, provider, providerEventId })) {
      return { published: false, duplicate: true };
    }
  }

  let eventId = null;
  let occurredAt = new Date().toISOString();
  if (insertEvent) {
    const dbType = DB_EVENT_TYPE[eventType] || eventType;
    const storedPayload = idempotencyKey
      ? { ...data, idempotency_key: idempotencyKey }
      : data;
    try {
      const { rows } = await pool.query(
        `INSERT INTO delivery_tracking_events
           (delivery_job_id, assignment_id, event_type, actor_user_id,
            provider, provider_event_id, payload)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
         RETURNING id, created_at`,
        [
          deliveryJobId,
          assignmentId,
          dbType,
          actorUserId,
          provider,
          providerEventId,
          JSON.stringify(storedPayload),
        ]
      );
      eventId = rows[0] ? rows[0].id : null;
      if (rows[0] && rows[0].created_at) {
        occurredAt = new Date(rows[0].created_at).toISOString();
      }
    } catch (err) {
      // The row was never written: release the claimed fence so a retry is
      // not mistaken for a duplicate.
      if (publishFenceClaimed && publishFenceKey) {
        await releaseFence(publishFenceKey, { namespace: 'tracking-publish' });
      }
      throw err;
    }
  }

  // Exact operational payload: coordinates, device/tracker IDs, provider,
  // validation state — ops room only.
  const opsPayload = {
    event: `tracking:ops:${eventType}`,
    eventId,
    deliveryJobId,
    occurredAt,
    assignmentId,
    actorUserId,
    provider,
    providerEventId,
    data,
  };
  try {
    socketService.broadcastToOpsDelivery(opsPayload.event, opsPayload);
  } catch (err) {
    logger.warn('Tracking ops broadcast failed', {
      deliveryJobId, eventType, error: err && err.message,
    });
  }

  // Customer-safe projection to delivery participants.
  if (customerVisible) {
    const customerData = buildCustomerData(eventType, data);
    const throttled = eventType === 'location_updated'
      ? await customerLocationThrottled(deliveryJobId)
      : false;
    if (customerData && !throttled) {
      const customerPayload = {
        event: `tracking:${eventType}`,
        eventId,
        deliveryJobId,
        occurredAt,
        data: customerData,
      };
      try {
        socketService.broadcastToRoom(`delivery_${deliveryJobId}`, customerPayload.event, customerPayload);
      } catch (err) {
        logger.warn('Tracking customer broadcast failed', {
          deliveryJobId, eventType, error: err && err.message,
        });
      }
    }
  }

  return { published: true, eventId };
}

// Test/introspection helpers (not part of the public contract).
function _resetCaches() {
  // The idempotency fence and customer throttle now live behind the shared
  // process-state contract; reset its single-process fallback fences.
  clearMemoryFences();
}

module.exports = {
  publishTrackingEvent,
  TRACKING_SOCKET_EVENTS: Array.from(TRACKING_SOCKET_EVENTS),
  LOCATION_CUSTOMER_THROTTLE_MS,
  _resetCaches,
};
