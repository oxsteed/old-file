'use strict';

/**
 * Delivery geofence service.
 *
 * Creates pickup/destination geofences from delivery job coordinates and
 * evaluates location points against them. Geofence observations are
 * SUGGESTIONS ONLY: this service never mutates delivery_jobs (no status,
 * pricing, or payment changes) and never marks a delivery delivered.
 */

const pool = require('../db');
const logger = require('../utils/logger');

const DEFAULT_RADIUS_METERS = 150;
const EARTH_RADIUS_METERS = 6371000;

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
    // Tracking events are evidence, not state: a failed event write must not
    // roll back the observation it annotates.
    logger.warn('Failed to record delivery tracking event', {
      deliveryJobId,
      eventType,
      error: error?.message || 'unknown_error',
    });
  }
}

/**
 * Create pickup + destination geofences for a delivery job from its stored
 * origin/destination coordinates. Idempotent: the (delivery_job_id, kind)
 * unique index makes re-runs safe, refreshing the center and reactivating.
 */
async function ensureGeofences(deliveryJobId) {
  const job = (await pool.query(
    `SELECT id, origin_lat, origin_lng, destination_lat, destination_lng
       FROM delivery_jobs
      WHERE id = $1`,
    [deliveryJobId]
  )).rows[0];

  if (!job) {
    throw new Error(`delivery job ${deliveryJobId} not found`);
  }

  const pickupCenter = {
    lat: finiteCoordinate(job.origin_lat, -90, 90),
    lng: finiteCoordinate(job.origin_lng, -180, 180),
  };
  const destinationCenter = {
    lat: finiteCoordinate(job.destination_lat, -90, 90),
    lng: finiteCoordinate(job.destination_lng, -180, 180),
  };
  if (pickupCenter.lat === null || pickupCenter.lng === null
    || destinationCenter.lat === null || destinationCenter.lng === null) {
    throw new Error(`delivery job ${deliveryJobId} is missing valid coordinates`);
  }

  const upsert = `INSERT INTO delivery_geofences
      (delivery_job_id, kind, center_lat, center_lng, radius_meters, active)
    VALUES ($1, $2, $3, $4, $5, TRUE)
    ON CONFLICT (delivery_job_id, kind) DO UPDATE SET
      center_lat = EXCLUDED.center_lat,
      center_lng = EXCLUDED.center_lng,
      active = TRUE
    RETURNING *`;

  const pickup = (await pool.query(upsert, [
    deliveryJobId, 'pickup', pickupCenter.lat, pickupCenter.lng, DEFAULT_RADIUS_METERS,
  ])).rows[0];
  const destination = (await pool.query(upsert, [
    deliveryJobId, 'destination', destinationCenter.lat, destinationCenter.lng, DEFAULT_RADIUS_METERS,
  ])).rows[0];

  return { pickup, destination };
}

async function loadActiveGeofences(deliveryJobId) {
  const { rows } = await pool.query(
    `SELECT id, kind, center_lat, center_lng, radius_meters
       FROM delivery_geofences
      WHERE delivery_job_id = $1 AND active = TRUE`,
    [deliveryJobId]
  );
  return rows;
}

async function loadLastObservation(geofenceId) {
  const { rows } = await pool.query(
    `SELECT observation, observed_at
       FROM delivery_geofence_observations
      WHERE geofence_id = $1
      ORDER BY observed_at DESC, id DESC
      LIMIT 1`,
    [geofenceId]
  );
  return rows[0] || null;
}

// Most recent valid point recorded strictly before the point under
// evaluation, used only to seed prior inside/outside state when no
// observation exists yet.
async function loadPriorValidPoint(deliveryJobId, recordedAtIso) {
  const { rows } = await pool.query(
    `SELECT latitude, longitude
       FROM delivery_location_points
      WHERE delivery_job_id = $1
        AND validation_state = 'valid'
        AND recorded_at < $2
      ORDER BY recorded_at DESC, id DESC
      LIMIT 1`,
    [deliveryJobId, recordedAtIso]
  );
  return rows[0] || null;
}

/**
 * Evaluate one location point against every active geofence for the job.
 *
 * Returns the first transition as { suggestion: 'arrival' | 'departure',
 * geofenceKind } or null when nothing changed. Each transition inserts one
 * arrival/departure observation plus one tracking event; repeated points on
 * the same side of the fence never duplicate an observation.
 */
async function evaluatePoint({ deliveryJobId, latitude, longitude, recordedAt }) {
  const lat = finiteCoordinate(latitude, -90, 90);
  const lng = finiteCoordinate(longitude, -180, 180);
  if (lat === null || lng === null) return null;

  const observedAt = recordedAt ? new Date(recordedAt) : new Date();
  if (Number.isNaN(observedAt.getTime())) return null;
  const observedAtIso = observedAt.toISOString();

  const fences = await loadActiveGeofences(deliveryJobId);
  const point = { lat, lng };

  for (const fence of fences) {
    const center = { lat: Number(fence.center_lat), lng: Number(fence.center_lng) };
    const radius = Number(fence.radius_meters) > 0 ? Number(fence.radius_meters) : DEFAULT_RADIUS_METERS;
    const inside = haversineMeters(point, center) <= radius;

    let priorInside = null;
    const lastObservation = await loadLastObservation(fence.id);
    if (lastObservation) {
      priorInside = lastObservation.observation === 'arrival';
    } else {
      const priorPoint = await loadPriorValidPoint(deliveryJobId, observedAtIso);
      if (priorPoint) {
        priorInside = haversineMeters(
          { lat: Number(priorPoint.latitude), lng: Number(priorPoint.longitude) },
          center
        ) <= radius;
      }
    }

    let transition = null;
    if (priorInside === null) {
      // First sighting: an inside point reads as an arrival; an outside point
      // establishes baseline without recording anything.
      transition = inside ? 'arrival' : null;
    } else if (!priorInside && inside) {
      transition = 'arrival';
    } else if (priorInside && !inside) {
      transition = 'departure';
    }

    if (!transition) continue;

    const observation = (await pool.query(
      `INSERT INTO delivery_geofence_observations
         (geofence_id, delivery_job_id, observation, observed_at)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [fence.id, deliveryJobId, transition, observedAtIso]
    )).rows[0];

    await recordTrackingEvent({
      deliveryJobId,
      eventType: transition === 'arrival' ? 'geofence_arrival' : 'geofence_departure',
      payload: {
        geofence_id: fence.id,
        geofence_kind: fence.kind,
        observation_id: observation.id,
        latitude: lat,
        longitude: lng,
        observed_at: observedAtIso,
      },
    });

    return { suggestion: transition, geofenceKind: fence.kind };
  }

  return null;
}

/**
 * Geofence observations for a job, newest first, annotated with geofence kind.
 */
async function getObservations(deliveryJobId) {
  const { rows } = await pool.query(
    `SELECT o.id, o.geofence_id, o.delivery_job_id, o.observation,
            o.observed_at, o.notified, o.created_at,
            g.kind AS geofence_kind
       FROM delivery_geofence_observations o
       JOIN delivery_geofences g ON g.id = o.geofence_id
      WHERE o.delivery_job_id = $1
      ORDER BY o.observed_at DESC, o.id DESC`,
    [deliveryJobId]
  );
  return rows;
}

module.exports = {
  ensureGeofences,
  evaluatePoint,
  getObservations,
  DEFAULT_RADIUS_METERS,
};
