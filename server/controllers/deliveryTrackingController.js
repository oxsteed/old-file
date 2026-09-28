'use strict';

/**
 * Driver-facing delivery tracking API.
 *
 * Thin HTTP layer over the tracking services:
 *   - server/services/deliveryTrackingService.js  (consent, sessions, locations, scans)
 *   - server/services/deliveryGeofenceService.js  (pickup/destination geofences)
 *   - server/services/deliveryEtaService.js       (ETA snapshots)
 *
 * Tracking is evidence only: these endpoints never mutate the delivery state
 * machine, pricing, or payments. Authorization rule for every handler: the
 * caller must be the job's assigned driver (delivery_jobs.helper_user_id for
 * marketplace fulfillment, or internal_driver_user_id for internal
 * fulfillment) or an operations user (admin / super_admin). Customers may
 * submit nothing here.
 */

const pool = require('../db');
const logger = require('../utils/logger');
const trackingService = require('../services/deliveryTrackingService');
const geofenceService = require('../services/deliveryGeofenceService');
const etaService = require('../services/deliveryEtaService');

const OPS_ROLES = new Set(['admin', 'super_admin']);
const DEVICE_KINDS = new Set(['driver_phone', 'vehicle_tracker']);
const MAX_BATCH_POINTS = 500;

function trackingError(code, message, status = 400) {
  const err = new Error(message);
  err.code = code;
  err.status = status;
  return err;
}

function sameId(a, b) {
  return a != null && b != null && String(a) === String(b);
}

function isOps(user) {
  return OPS_ROLES.has(user?.role);
}

function isAssignedDriver(job, user) {
  return [job.helper_user_id, job.internal_driver_user_id].some((id) => sameId(id, user?.id));
}

async function loadJob(jobId) {
  const { rows } = await pool.query(
    `SELECT id, helper_user_id, internal_driver_user_id, customer_user_id, status
       FROM delivery_jobs
      WHERE id = $1`,
    [jobId]
  );
  const job = rows[0];
  if (!job) {
    throw trackingError('tracking_delivery_not_found', 'Delivery job not found', 404);
  }
  return job;
}

/**
 * The caller must be the job's assigned driver or an operations user.
 * Customers (and unrelated users) are rejected: they may not submit or read
 * driver tracking data through these endpoints.
 */
function assertDriverAccess(req, job) {
  if (isAssignedDriver(job, req.user) || isOps(req.user)) {
    return;
  }
  throw trackingError('tracking_forbidden', 'Only the assigned driver or operations may access tracking', 403);
}

/** Consent is personal: only the assigned driver may grant it. */
function requireAssignedDriver(req, job) {
  if (isAssignedDriver(job, req.user)) {
    return;
  }
  throw trackingError('tracking_forbidden', 'Only the assigned driver may manage tracking consent', 403);
}

/** Resolve the driver the tracking records belong to (ops may act for the driver). */
function resolveDriverUserId(req, job) {
  if (isOps(req.user)) {
    const driverId = job.helper_user_id || job.internal_driver_user_id;
    if (!driverId) {
      throw trackingError('tracking_no_driver_assigned', 'Delivery has no assigned driver', 409);
    }
    return driverId;
  }
  return req.user.id;
}

async function requireAssignment(jobId, { requireActive = false } = {}) {
  const { assignment } = await trackingService.getAssignmentStatus(jobId);
  if (!assignment) {
    throw trackingError('tracking_assignment_not_found', 'No tracking session for this delivery', 404);
  }
  if (requireActive && assignment.status !== 'active') {
    throw trackingError('tracking_not_active', `Tracking session is ${assignment.status}`, 409);
  }
  return assignment;
}

function assertAssignmentDriver(req, job, assignment) {
  if (isOps(req.user)) {
    return;
  }
  if (!sameId(assignment.driver_user_id, req.user.id) || !isAssignedDriver(job, req.user)) {
    throw trackingError('tracking_forbidden', 'Only the assigned driver or operations may access tracking', 403);
  }
}

function sendServiceError(res, err) {
  const status = Number.isInteger(err?.status) ? err.status : 500;
  const code = err?.code || 'tracking_error';
  if (status >= 500) {
    logger.error('Delivery tracking API failure', { code, message: err?.message });
  }
  res.status(status).json({
    error: code,
    message: status >= 500 ? 'Tracking request failed' : (err?.message || 'Tracking request failed'),
  });
}

function latestPoint(points) {
  const valid = points
    .map((p) => ({
      latitude: Number(p?.latitude),
      longitude: Number(p?.longitude),
      recordedAt: p?.recordedAt,
      recordedMs: p?.recordedAt instanceof Date
        ? p.recordedAt.getTime()
        : new Date(p?.recordedAt).getTime(),
    }))
    .filter((p) => Number.isFinite(p.latitude) && Number.isFinite(p.longitude)
      && Number.isFinite(p.recordedMs));
  valid.sort((a, b) => b.recordedMs - a.recordedMs);
  return valid[0] || null;
}

function summarizeEta(snapshot) {
  if (!snapshot) {
    return null;
  }
  return {
    stale: Boolean(snapshot.stale),
    etaAt: snapshot.etaAt || (snapshot.snapshot && snapshot.snapshot.eta_at) || null,
    source: snapshot.source || (snapshot.snapshot && snapshot.snapshot.source) || null,
    confidence: snapshot.confidence || (snapshot.snapshot && snapshot.snapshot.confidence) || null,
    lastPointAt: snapshot.lastPointAt || null,
  };
}

async function grantConsent(req, res) {
  try {
    const job = await loadJob(req.params.id);
    requireAssignedDriver(req, job);
    const { deviceId, consentVersion = 'v1' } = req.body || {};
    if (deviceId == null) {
      throw trackingError('tracking_consent_invalid', 'deviceId is required');
    }
    const consent = await trackingService.grantConsent({
      deliveryJobId: job.id,
      driverUserId: req.user.id,
      deviceId,
      consentVersion: String(consentVersion),
    });
    res.status(201).json({ consent });
  } catch (err) {
    sendServiceError(res, err);
  }
}

async function revokeConsent(req, res) {
  try {
    const job = await loadJob(req.params.id);
    assertDriverAccess(req, job);
    const result = await trackingService.revokeConsent({
      deliveryJobId: job.id,
      driverUserId: resolveDriverUserId(req, job),
      reason: req.body?.reason || null,
    });
    res.json(result);
  } catch (err) {
    sendServiceError(res, err);
  }
}

async function startTracking(req, res) {
  try {
    const job = await loadJob(req.params.id);
    assertDriverAccess(req, job);
    const { deviceId, sourcePolicy = 'driver_gps', vehicleId = null } = req.body || {};
    if (deviceId == null) {
      throw trackingError('tracking_start_invalid', 'deviceId is required');
    }
    try {
      await geofenceService.ensureGeofences(job.id);
    } catch (err) {
      logger.warn('Could not ensure delivery geofences', { deliveryJobId: job.id, message: err?.message });
      throw trackingError('tracking_geofence_unavailable', 'Delivery coordinates are required before tracking can start', 422);
    }
    const assignment = await trackingService.startTracking({
      deliveryJobId: job.id,
      deviceId,
      driverUserId: resolveDriverUserId(req, job),
      vehicleId,
      sourcePolicy,
    });
    res.status(201).json({ assignment });
  } catch (err) {
    sendServiceError(res, err);
  }
}

async function pauseTracking(req, res) {
  try {
    const job = await loadJob(req.params.id);
    assertDriverAccess(req, job);
    const assignment = await requireAssignment(job.id, { requireActive: true });
    assertAssignmentDriver(req, job, assignment);
    const updated = await trackingService.pauseTracking(assignment.id, req.user.id);
    res.json({ assignment: updated });
  } catch (err) {
    sendServiceError(res, err);
  }
}

async function resumeTracking(req, res) {
  try {
    const job = await loadJob(req.params.id);
    assertDriverAccess(req, job);
    const assignment = await requireAssignment(job.id);
    assertAssignmentDriver(req, job, assignment);
    if (assignment.status !== 'paused') {
      throw trackingError('tracking_not_paused', `Tracking session is ${assignment.status}`, 409);
    }
    const updated = await trackingService.resumeTracking(assignment.id, req.user.id);
    res.json({ assignment: updated });
  } catch (err) {
    sendServiceError(res, err);
  }
}

async function stopTracking(req, res) {
  try {
    const job = await loadJob(req.params.id);
    assertDriverAccess(req, job);
    const assignment = await requireAssignment(job.id);
    assertAssignmentDriver(req, job, assignment);
    if (!['active', 'paused'].includes(assignment.status)) {
      throw trackingError('tracking_not_active', `Tracking session is ${assignment.status}`, 409);
    }
    const updated = await trackingService.stopTracking(assignment.id, {
      reason: req.body?.reason || 'manual',
      actorUserId: req.user.id,
    });
    res.json({ assignment: updated });
  } catch (err) {
    sendServiceError(res, err);
  }
}

async function ingestLocations(req, res) {
  try {
    const job = await loadJob(req.params.id);
    assertDriverAccess(req, job);
    const points = req.body?.points;
    if (!Array.isArray(points) || points.length === 0) {
      throw trackingError('tracking_points_invalid', 'points must be a non-empty array');
    }
    if (points.length > MAX_BATCH_POINTS) {
      throw trackingError('tracking_points_too_many', `points batch exceeds ${MAX_BATCH_POINTS}`);
    }
    const assignment = await requireAssignment(job.id, { requireActive: true });
    assertAssignmentDriver(req, job, assignment);

    const summary = await trackingService.ingestLocationBatch({
      assignmentId: assignment.id,
      points,
      actorUserId: req.user.id,
    });

    // Evaluate the latest usable point against pickup/destination geofences.
    let geofence = null;
    const latest = latestPoint(points);
    if (latest) {
      geofence = await geofenceService.evaluatePoint({
        deliveryJobId: job.id,
        latitude: latest.latitude,
        longitude: latest.longitude,
        recordedAt: latest.recordedAt,
      });
    }

    // Trigger a throttled ETA refresh; a throttled response is an expected
    // outcome, not a failure. A hard failure must not fail the ingest.
    let eta;
    try {
      eta = await etaService.refreshEta(job.id);
    } catch (err) {
      logger.warn('ETA refresh failed after location ingest', {
        deliveryJobId: job.id,
        message: err?.message,
      });
      eta = { error: err?.code || 'eta_refresh_failed' };
    }
    let etaSnapshot = null;
    try {
      etaSnapshot = summarizeEta(await etaService.getCurrentEta(job.id));
    } catch (err) {
      logger.warn('Could not read ETA snapshot after ingest', {
        deliveryJobId: job.id,
        message: err?.message,
      });
    }

    res.json({ summary, geofence, eta, etaSnapshot });
  } catch (err) {
    sendServiceError(res, err);
  }
}

async function recordScan(req, res) {
  try {
    const job = await loadJob(req.params.id);
    assertDriverAccess(req, job);
    const { scanType, codeValue, codeFormat = null, idempotencyKey = null } = req.body || {};
    const scan = await trackingService.recordScan({
      deliveryJobId: job.id,
      scanType,
      scannedByUserId: req.user.id,
      codeValue,
      codeFormat,
      idempotencyKey,
    });
    res.status(scan.duplicate ? 200 : 201).json({ scan });
  } catch (err) {
    sendServiceError(res, err);
  }
}

async function listScans(req, res) {
  try {
    const job = await loadJob(req.params.id);
    assertDriverAccess(req, job);
    const { rows } = await pool.query(
      `SELECT id, delivery_job_id, scan_type, code_value, code_format,
              scanned_by_user_id, scanned_at
         FROM delivery_scan_events
        WHERE delivery_job_id = $1
        ORDER BY scanned_at DESC, id DESC
        LIMIT 100`,
      [job.id]
    );
    res.json({ scans: rows });
  } catch (err) {
    sendServiceError(res, err);
  }
}

async function getStatus(req, res) {
  try {
    const job = await loadJob(req.params.id);
    assertDriverAccess(req, job);
    const status = await trackingService.getAssignmentStatus(job.id);
    res.json(status);
  } catch (err) {
    sendServiceError(res, err);
  }
}

async function registerDevice(req, res) {
  try {
    const { kind, deviceLabel = null, platform = null, appVersion = null, vehicleId = null } = req.body || {};
    if (!DEVICE_KINDS.has(kind)) {
      throw trackingError('tracking_device_kind_invalid', 'kind must be driver_phone or vehicle_tracker');
    }
    let driverUserId = null;
    let vehicleIdValue = null;
    if (kind === 'driver_phone') {
      driverUserId = req.user.id;
    } else {
      // Vehicle telematics trackers are fleet assets; only ops may register them.
      if (!isOps(req.user)) {
        throw trackingError('tracking_forbidden', 'Only operations may register vehicle trackers', 403);
      }
      if (vehicleId == null) {
        throw trackingError('tracking_vehicle_required', 'vehicleId is required for vehicle_tracker devices');
      }
      vehicleIdValue = vehicleId;
    }
    const { rows } = await pool.query(
      `INSERT INTO delivery_tracking_devices
         (kind, driver_user_id, vehicle_id, device_label, platform, app_version, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'active')
       RETURNING *`,
      [kind, driverUserId, vehicleIdValue, deviceLabel, platform, appVersion]
    );
    res.status(201).json({ device: rows[0] });
  } catch (err) {
    sendServiceError(res, err);
  }
}

async function listDevices(req, res) {
  try {
    const { rows } = isOps(req.user)
      ? await pool.query(
        `SELECT id, kind, driver_user_id, vehicle_id, device_label, platform,
                app_version, status, last_seen_at, created_at
           FROM delivery_tracking_devices
          ORDER BY created_at DESC
          LIMIT 200`
      )
      : await pool.query(
        `SELECT id, kind, driver_user_id, vehicle_id, device_label, platform,
                app_version, status, last_seen_at, created_at
           FROM delivery_tracking_devices
          WHERE driver_user_id = $1
          ORDER BY created_at DESC
          LIMIT 200`,
        [req.user.id]
      );
    res.json({ devices: rows });
  } catch (err) {
    sendServiceError(res, err);
  }
}

module.exports = {
  assertDriverAccess,
  grantConsent,
  revokeConsent,
  startTracking,
  pauseTracking,
  resumeTracking,
  stopTracking,
  ingestLocations,
  recordScan,
  listScans,
  getStatus,
  registerDevice,
  listDevices,
};
