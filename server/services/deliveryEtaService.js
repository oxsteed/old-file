'use strict';

/**
 * Delivery ETA service.
 *
 * Refreshes ETA snapshots from the most trusted available location and route
 * source. ETA snapshots are ADVISORY ONLY: they never change the quoted price,
 * never create charges or refunds, and never mutate delivery_jobs.
 */

const pool = require('../db');
const geoRouteProvider = require('./geoRouteProviderService');
const logger = require('../utils/logger');

const ETA_THROTTLE_MS = 60 * 1000; // recalculate at most once per minute
const STALE_MS = 15 * 60 * 1000; // snapshot/point older than this is stale
const MOVEMENT_THRESHOLD_METERS = 250; // meaningful movement bypasses throttle
const EARTH_RADIUS_METERS = 6371000;
const METERS_PER_MILE = 1609.344;
const FALLBACK_MPH = 25; // conservative speed used when no route provider answers

function toRadians(degrees) {
  return (degrees * Math.PI) / 180;
}

function haversineMeters(a, b) {
  const dLat = toRadians(b.lat - a.lat);
  const dLng = toRadians(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(toRadians(a.lat)) * Math.cos(toRadians(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(h));
}

function finiteCoordinate(value, min, max) {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= min && number <= max ? number : null;
}

async function recordTrackingEvent({ deliveryJobId, eventType, payload, assignmentId = null }) {
  try {
    await pool.query(
      `INSERT INTO delivery_tracking_events (delivery_job_id, assignment_id, event_type, payload)
       VALUES ($1, $2, $3, $4::jsonb)`,
      [deliveryJobId, assignmentId, eventType, JSON.stringify(payload || {})]
    );
  } catch (error) {
    logger.warn('Failed to record delivery tracking event', {
      deliveryJobId,
      eventType,
      error: error?.message || 'unknown_error',
    });
  }
}

async function loadJob(deliveryJobId) {
  const { rows } = await pool.query(
    `SELECT id, destination_lat, destination_lng, duration_minutes
       FROM delivery_jobs
      WHERE id = $1`,
    [deliveryJobId]
  );
  return rows[0] || null;
}

async function loadActiveAssignment(deliveryJobId) {
  const { rows } = await pool.query(
    `SELECT id, device_id, driver_user_id, vehicle_id, source_policy
       FROM delivery_tracking_assignments
      WHERE delivery_job_id = $1 AND status = 'active'
      LIMIT 1`,
    [deliveryJobId]
  );
  return rows[0] || null;
}

async function loadLatestSnapshot(deliveryJobId) {
  const { rows } = await pool.query(
    `SELECT *
       FROM delivery_eta_snapshots
      WHERE delivery_job_id = $1
      ORDER BY created_at DESC, id DESC
      LIMIT 1`,
    [deliveryJobId]
  );
  return rows[0] || null;
}

// Latest valid point, preferring the active assignment's points and falling
// back to any valid point for the job when no assignment is active.
async function loadLatestValidPoint(deliveryJobId, assignmentId) {
  const { rows } = await pool.query(
    `SELECT latitude, longitude, accuracy_meters, recorded_at, assignment_id, source
       FROM delivery_location_points
      WHERE delivery_job_id = $1
        AND validation_state = 'valid'
        AND ($2::bigint IS NULL OR assignment_id = $2)
      ORDER BY recorded_at DESC, id DESC
      LIMIT 1`,
    [deliveryJobId, assignmentId]
  );
  return rows[0] || null;
}

function confidenceForAccuracy(accuracyMeters) {
  if (!Number.isFinite(accuracyMeters)) return 'medium';
  if (accuracyMeters <= 50) return 'high';
  if (accuracyMeters <= 250) return 'medium';
  return 'low';
}

/**
 * Recompute the ETA for a delivery job.
 *
 * Throttled to at most one snapshot per minute unless `force` is set or the
 * driver moved more than 250m since the last snapshot's basis point. Falls
 * back to the job's stored route estimate when no live point exists. Returns
 * the new snapshot, or { throttled: true, ... } when skipped.
 */
async function refreshEta(deliveryJobId, options = {}) {
  const { force = false } = options || {};
  const now = new Date();

  const job = await loadJob(deliveryJobId);
  if (!job) {
    throw new Error(`delivery job ${deliveryJobId} not found`);
  }

  const destination = {
    lat: finiteCoordinate(job.destination_lat, -90, 90),
    lng: finiteCoordinate(job.destination_lng, -180, 180),
  };
  if (destination.lat === null || destination.lng === null) {
    throw new Error(`delivery job ${deliveryJobId} is missing valid destination coordinates`);
  }

  const snapshot = await loadLatestSnapshot(deliveryJobId);
  const assignment = await loadActiveAssignment(deliveryJobId);
  const point = await loadLatestValidPoint(deliveryJobId, assignment ? assignment.id : null);

  if (!force && snapshot) {
    const ageMs = now.getTime() - new Date(snapshot.created_at).getTime();
    if (ageMs < ETA_THROTTLE_MS) {
      const basis = snapshot.basis || {};
      const basisLat = Number(basis.lastLatitude);
      const basisLng = Number(basis.lastLongitude);
      let movementMeters = null;
      if (point && Number.isFinite(basisLat) && Number.isFinite(basisLng)) {
        movementMeters = haversineMeters(
          { lat: Number(point.latitude), lng: Number(point.longitude) },
          { lat: basisLat, lng: basisLng }
        );
      }
      if (movementMeters === null || movementMeters <= MOVEMENT_THRESHOLD_METERS) {
        return { throttled: true, snapshot, movementMeters };
      }
    }
  }

  let etaAt = null;
  let source = 'route_estimate';
  let confidence = 'medium';
  let provider = null;
  let distanceMiles = null;
  let durationMinutes = null;

  if (point) {
    const current = { lat: Number(point.latitude), lng: Number(point.longitude) };
    let route = null;
    try {
      route = await geoRouteProvider.calculateRoute({
        origin: [current.lng, current.lat],
        destination: [destination.lng, destination.lat],
        travelMode: 'Car',
      });
    } catch (error) {
      logger.warn('ETA route calculation failed; using fallback estimate', {
        deliveryJobId,
        error: error?.message || 'unknown_error',
      });
    }

    if (route && Number(route.durationSeconds) > 0) {
      durationMinutes = Math.max(1, Math.ceil(Number(route.durationSeconds) / 60));
      distanceMiles = Number(route.distanceMeters) > 0 ? Number(route.distanceMeters) / METERS_PER_MILE : null;
      provider = route.provider || 'route_provider';
      source = 'live_tracking';
      confidence = confidenceForAccuracy(Number(point.accuracy_meters));
    } else {
      // No route provider available: conservative haversine fallback, same
      // speed assumption the quoting path uses when routing is unavailable.
      const distanceMeters = haversineMeters(current, destination);
      distanceMiles = distanceMeters / METERS_PER_MILE;
      durationMinutes = Math.max(1, Math.ceil((distanceMiles / FALLBACK_MPH) * 60));
      provider = 'haversine';
      source = 'live_tracking';
      confidence = 'low';
    }
    etaAt = new Date(now.getTime() + durationMinutes * 60000);
  } else {
    const estimateMinutes = Number(job.duration_minutes);
    if (!Number.isFinite(estimateMinutes) || estimateMinutes <= 0) {
      return markEtaUnavailable(deliveryJobId, 'no_location_or_route_estimate');
    }
    durationMinutes = estimateMinutes;
    provider = 'route_estimate';
    source = 'route_estimate';
    confidence = 'medium';
    etaAt = new Date(now.getTime() + durationMinutes * 60000);
  }

  const priorBasis = (snapshot && snapshot.basis) || {};
  const priorLat = Number(priorBasis.lastLatitude);
  const priorLng = Number(priorBasis.lastLongitude);
  const movementMeters = point && Number.isFinite(priorLat) && Number.isFinite(priorLng)
    ? haversineMeters(
      { lat: Number(point.latitude), lng: Number(point.longitude) },
      { lat: priorLat, lng: priorLng }
    )
    : null;

  const basis = {
    distanceMiles,
    durationMinutes,
    lastPointAt: point ? new Date(point.recorded_at).toISOString() : null,
    lastLatitude: point ? Number(point.latitude) : null,
    lastLongitude: point ? Number(point.longitude) : null,
    movementMeters,
    provider,
    pointSource: point ? point.source : null,
    assignmentId: assignment ? assignment.id : null,
  };

  const saved = (await pool.query(
    `INSERT INTO delivery_eta_snapshots (delivery_job_id, eta_at, source, confidence, basis)
     VALUES ($1, $2, $3, $4, $5::jsonb)
     RETURNING *`,
    [deliveryJobId, etaAt.toISOString(), source, confidence, JSON.stringify(basis)]
  )).rows[0];

  await recordTrackingEvent({
    deliveryJobId,
    eventType: 'eta_updated',
    assignmentId: assignment ? assignment.id : null,
    payload: {
      eta_at: etaAt.toISOString(),
      source,
      confidence,
      distance_miles: distanceMiles,
      duration_minutes: durationMinutes,
      snapshot_id: saved.id,
    },
  });

  return saved;
}

/**
 * Current ETA with freshness. Stale when there is no valid point within the
 * last 15 minutes or the newest snapshot is older than 15 minutes; stale
 * results report confidence 'unavailable' without writing to the database.
 */
async function getCurrentEta(deliveryJobId) {
  const nowMs = Date.now();
  const snapshot = await loadLatestSnapshot(deliveryJobId);
  const point = await loadLatestValidPoint(deliveryJobId, null);

  const snapshotAgeMs = snapshot ? nowMs - new Date(snapshot.created_at).getTime() : Infinity;
  const pointAgeMs = point ? nowMs - new Date(point.recorded_at).getTime() : Infinity;

  const stale = !snapshot || snapshotAgeMs > STALE_MS || pointAgeMs > STALE_MS;

  if (stale) {
    return {
      stale: true,
      confidence: 'unavailable',
      snapshot,
      lastPointAt: point ? new Date(point.recorded_at).toISOString() : null,
      snapshotAgeMs: Number.isFinite(snapshotAgeMs) ? snapshotAgeMs : null,
      pointAgeMs: Number.isFinite(pointAgeMs) ? pointAgeMs : null,
    };
  }

  return {
    stale: false,
    snapshot,
    etaAt: snapshot.eta_at,
    source: snapshot.source,
    confidence: snapshot.confidence,
    lastPointAt: point ? new Date(point.recorded_at).toISOString() : null,
  };
}

/**
 * Record that no trustworthy ETA can be produced (bad location data, routing
 * outage, provider failure). Writes a snapshot with eta_at NULL and
 * confidence 'unavailable' so consumers see an explicit state rather than a
 * silently aging estimate.
 */
async function markEtaUnavailable(deliveryJobId, reason) {
  const basis = {
    reason: reason || 'unknown',
    markedAt: new Date().toISOString(),
  };

  const saved = (await pool.query(
    `INSERT INTO delivery_eta_snapshots (delivery_job_id, eta_at, source, confidence, basis)
     VALUES ($1, NULL, 'live_tracking', 'unavailable', $2::jsonb)
     RETURNING *`,
    [deliveryJobId, JSON.stringify(basis)]
  )).rows[0];

  await recordTrackingEvent({
    deliveryJobId,
    eventType: 'eta_updated',
    payload: {
      eta_at: null,
      source: 'live_tracking',
      confidence: 'unavailable',
      reason: basis.reason,
      snapshot_id: saved.id,
    },
  });

  return saved;
}

module.exports = {
  refreshEta,
  getCurrentEta,
  markEtaUnavailable,
  ETA_THROTTLE_MS,
  STALE_MS,
  MOVEMENT_THRESHOLD_METERS,
};
