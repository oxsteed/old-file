'use strict';

/**
 * server/services/deliveryTrackingService.js
 *
 * Ingestion service for the full delivery tracking integration
 * (docs/oxsteed-delivery-full-tracking-integration-plan.md, migration 576).
 *
 * Responsibilities:
 *  - driver tracking consent lifecycle (grant / revoke / lookup)
 *  - tracking assignment lifecycle (start / pause / resume / stop)
 *  - batched driver-GPS location ingestion with validation, idempotency,
 *    and suspicious-point quarantine
 *  - immutable QR/barcode scan events
 *  - operational assignment status reads
 *
 * Hard rules enforced here:
 *  - This service NEVER updates delivery_jobs status, pricing, or payments.
 *    Tracking records are evidence only; the authoritative delivery state
 *    machine (localDeliveryState.js) owns committed milestones.
 *  - Every tracking state change writes a delivery_tracking_events row in the
 *    same transaction as the state change.
 *  - Suspicious points are stored for review and never change delivery state.
 *  - Rejected points are never stored.
 *  - This service returns raw operational data; customer-safe projection
 *    (approximate location, no exact coordinates) happens in the API layer.
 */

const crypto = require('crypto');
const pool = require('../db');
const logger = require('../utils/logger');
const { withTransaction } = require('../utils/transaction');

// Deliveries that are allowed to carry an active tracking session. 'posted' has
// no driver yet; 'delivered'/'cancelled'/'failed' are terminal.
const TRACKABLE_DELIVERY_STATUSES = ['assigned', 'picked_up', 'in_transit'];

// Location validation thresholds (see integration plan: accuracy, timestamp,
// speed, and jump validation).
const MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;      // recordedAt > now + 5min => rejected
const MAX_POINT_AGE_MS = 24 * 60 * 60 * 1000;  // recordedAt older than 24h => rejected
const MAX_ACCURACY_METERS = 2000;              // accuracy > 2000m => suspicious
const MAX_PLAUSIBLE_SPEED_MPS = 80;            // implied speed > 80 m/s => suspicious
const JUMP_DISTANCE_METERS = 50 * 1000;        // > 50km ...
const JUMP_WINDOW_SECONDS = 60;                // ... in < 60s => suspicious

const SCAN_TYPES = ['pickup', 'handoff', 'arrival', 'return', 'exception'];
const STOP_REASONS = ['delivered', 'cancelled', 'returned', 'assignment_removed', 'consent_revoked', 'manual'];
const LOCATION_SOURCES = ['driver_gps', 'geotab', 'samsara', 'motive', 'verizon_connect'];
const OPS_ROLES = ['admin', 'super_admin'];

/**
 * Structured service error. Callers (routes) map `code` to localized messages
 * and `status` to the HTTP response.
 */
function trackingError(code, message, status = 400) {
  const err = new Error(message);
  err.code = code;
  err.status = status;
  return err;
}

function isUniqueViolation(err) {
  return err && err.code === '23505';
}

// M14: a driver_phone device is bound to one driver. Never let driver A start
// tracking (or grant consent) on driver B's phone — that would leak B's live
// GPS to A's delivery. vehicle_tracker fleet assets are exempt: they are bound
// to a vehicle, not a driver, and the delivery assignment authorizes use.
function verifyDeviceForDriver(device, driverUserId) {
  if (!device || device.status !== 'active') {
    throw trackingError('tracking_device_not_active', 'Tracking device is not active', 409);
  }
  if (device.kind === 'driver_phone'
    && String(device.driver_user_id || '') !== String(driverUserId || '')) {
    throw trackingError('tracking_device_not_owned', 'This tracking device belongs to another driver', 403);
  }
  return device;
}

function haversineMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

async function insertTrackingEvent(client, {
  deliveryJobId, assignmentId = null, eventType, actorUserId = null,
  provider = null, providerEventId = null, payload = {},
}) {
  const { rows } = await client.query(
    `INSERT INTO delivery_tracking_events
       (delivery_job_id, assignment_id, event_type, actor_user_id, provider, provider_event_id, payload)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [deliveryJobId, assignmentId, eventType, actorUserId, provider, providerEventId, payload]
  );
  return rows[0];
}

async function getDeliveryJob(client, deliveryJobId) {
  const { rows } = await client.query(
    'SELECT id, status, helper_user_id FROM delivery_jobs WHERE id = $1',
    [deliveryJobId]
  );
  return rows[0] || null;
}

/**
 * Grant (or re-grant) tracking consent for a driver on a delivery.
 * One active consent per (delivery, driver) is enforced by the partial unique
 * index uq_tracking_consent_active; re-granting updates the existing row.
 */
async function grantConsent({ deliveryJobId, driverUserId, deviceId = null, consentVersion = 'v1' }) {
  if (!deliveryJobId || !driverUserId) {
    throw trackingError('tracking_consent_invalid', 'deliveryJobId and driverUserId are required');
  }

  const job = await getDeliveryJob(pool, deliveryJobId);
  if (!job) {
    throw trackingError('tracking_delivery_not_found', 'Delivery job not found', 404);
  }

  // M14: consent must name a device the driver actually owns. Otherwise driver
  // A could consent tracking on driver B's phone.
  if (deviceId) {
    const { rows: deviceRows } = await pool.query(
      'SELECT id, kind, status, driver_user_id FROM delivery_tracking_devices WHERE id = $1',
      [deviceId]
    );
    verifyDeviceForDriver(deviceRows[0], driverUserId);
  }

  const { rows } = await pool.query(
    `INSERT INTO delivery_tracking_consent
       (delivery_job_id, driver_user_id, device_id, consent_version)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (delivery_job_id, driver_user_id) WHERE revoked_at IS NULL
     DO UPDATE SET
       device_id = EXCLUDED.device_id,
       consent_version = EXCLUDED.consent_version,
       updated_at = NOW()
     RETURNING *`,
    [deliveryJobId, driverUserId, deviceId, consentVersion]
  );
  const consent = rows[0];
  logger.info('Tracking consent granted', { deliveryJobId, driverUserId, consentId: consent.id });
  return consent;
}

/**
 * Revoke a driver's tracking consent. Also ends any active tracking assignment
 * on the delivery with ended_reason 'consent_revoked', writing the matching
 * tracking_stopped event in the same transaction.
 */
async function revokeConsent({ deliveryJobId, driverUserId, reason = null }) {
  if (!deliveryJobId || !driverUserId) {
    throw trackingError('tracking_consent_invalid', 'deliveryJobId and driverUserId are required');
  }

  return withTransaction(pool, async (client) => {
    const { rows: consentRows } = await client.query(
      `SELECT * FROM delivery_tracking_consent
        WHERE delivery_job_id = $1 AND driver_user_id = $2 AND revoked_at IS NULL
        FOR UPDATE`,
      [deliveryJobId, driverUserId]
    );
    const consent = consentRows[0];
    if (!consent) {
      throw trackingError('tracking_consent_not_found', 'No active tracking consent for this driver and delivery', 404);
    }

    const { rows: revokedRows } = await client.query(
      `UPDATE delivery_tracking_consent
          SET revoked_at = NOW(), revoke_reason = $2, updated_at = NOW()
        WHERE id = $1 AND revoked_at IS NULL
        RETURNING *`,
      [consent.id, reason]
    );
    const revoked = revokedRows[0] || { ...consent, revoked_at: new Date().toISOString(), revoke_reason: reason };

    // End any active tracking assignment on this delivery.
    const { rows: assignmentRows } = await client.query(
      `SELECT * FROM delivery_tracking_assignments
        WHERE delivery_job_id = $1 AND status = 'active'
        FOR UPDATE`,
      [deliveryJobId]
    );
    const assignment = assignmentRows[0];
    if (assignment) {
      await client.query(
        `UPDATE delivery_tracking_assignments
            SET status = 'revoked', ended_at = NOW(), ended_reason = 'consent_revoked', updated_at = NOW()
          WHERE id = $1`,
        [assignment.id]
      );
      await insertTrackingEvent(client, {
        deliveryJobId,
        assignmentId: assignment.id,
        eventType: 'tracking_stopped',
        actorUserId: driverUserId,
        payload: { reason: 'consent_revoked', consent_id: consent.id },
      });
      logger.info('Tracking assignment ended on consent revocation', {
        deliveryJobId, assignmentId: assignment.id,
      });
    }

    logger.info('Tracking consent revoked', { deliveryJobId, driverUserId, consentId: consent.id });
    return { consent: revoked, endedAssignmentId: assignment ? assignment.id : null };
  }, 'revoke_tracking_consent');
}

/**
 * Return the active consent row for (delivery, driver), or null.
 */
async function getActiveConsent(deliveryJobId, driverUserId) {
  const { rows } = await pool.query(
    `SELECT * FROM delivery_tracking_consent
      WHERE delivery_job_id = $1 AND driver_user_id = $2 AND revoked_at IS NULL`,
    [deliveryJobId, driverUserId]
  );
  return rows[0] || null;
}

/**
 * Start a tracking session: bind a device to a delivery.
 * Guards: delivery exists and is in a trackable status, the driver holds
 * active consent, the device is active, and no other assignment is active
 * for the delivery (the uq_tracking_assignment_active partial unique index
 * is the final arbiter under concurrency).
 */
async function startTracking({ deliveryJobId, deviceId, driverUserId, vehicleId = null, sourcePolicy = 'driver_gps' }) {
  if (!deliveryJobId || !deviceId || !driverUserId) {
    throw trackingError('tracking_start_invalid', 'deliveryJobId, deviceId and driverUserId are required');
  }
  if (!['driver_gps', 'telematics', 'telematics_with_gps_fallback'].includes(sourcePolicy)) {
    throw trackingError('tracking_source_policy_invalid', 'Unknown tracking source policy');
  }

  return withTransaction(pool, async (client) => {
    const job = await getDeliveryJob(client, deliveryJobId);
    if (!job) {
      throw trackingError('tracking_delivery_not_found', 'Delivery job not found', 404);
    }
    if (!TRACKABLE_DELIVERY_STATUSES.includes(String(job.status))) {
      throw trackingError(
        'tracking_invalid_delivery_status',
        `Tracking can only start for deliveries in ${TRACKABLE_DELIVERY_STATUSES.join(', ')}`
      );
    }

    const consent = await getActiveConsent(deliveryJobId, driverUserId);
    if (!consent) {
      throw trackingError('tracking_consent_required', 'Active driver tracking consent is required', 403);
    }

    const { rows: deviceRows } = await client.query(
      'SELECT id, kind, status, driver_user_id FROM delivery_tracking_devices WHERE id = $1',
      [deviceId]
    );
    verifyDeviceForDriver(deviceRows[0], driverUserId);

    let assignment;
    try {
      const { rows } = await client.query(
        `INSERT INTO delivery_tracking_assignments
           (delivery_job_id, device_id, driver_user_id, vehicle_id, source_policy, status)
         VALUES ($1, $2, $3, $4, $5, 'active')
         RETURNING *`,
        [deliveryJobId, deviceId, driverUserId, vehicleId, sourcePolicy]
      );
      assignment = rows[0];
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw trackingError('tracking_assignment_active', 'Delivery already has an active tracking assignment', 409);
      }
      throw err;
    }

    await insertTrackingEvent(client, {
      deliveryJobId,
      assignmentId: assignment.id,
      eventType: 'tracking_started',
      actorUserId: driverUserId,
      payload: { device_id: deviceId, vehicle_id: vehicleId, source_policy: sourcePolicy },
    });

    logger.info('Tracking started', { deliveryJobId, assignmentId: assignment.id, deviceId });
    return assignment;
  }, 'start_tracking');
}

async function loadAssignmentForUpdate(client, assignmentId) {
  const { rows } = await client.query(
    'SELECT * FROM delivery_tracking_assignments WHERE id = $1 FOR UPDATE',
    [assignmentId]
  );
  const assignment = rows[0];
  if (!assignment) {
    throw trackingError('tracking_assignment_not_found', 'Tracking assignment not found', 404);
  }
  return assignment;
}

/**
 * Pause an active tracking session (active -> paused).
 */
async function pauseTracking(assignmentId, actorUserId) {
  return withTransaction(pool, async (client) => {
    const assignment = await loadAssignmentForUpdate(client, assignmentId);
    if (assignment.status !== 'active') {
      throw trackingError('tracking_pause_invalid', `Cannot pause a ${assignment.status} assignment`, 409);
    }
    const { rows } = await client.query(
      `UPDATE delivery_tracking_assignments
          SET status = 'paused', updated_at = NOW()
        WHERE id = $1
        RETURNING *`,
      [assignmentId]
    );
    await insertTrackingEvent(client, {
      deliveryJobId: assignment.delivery_job_id,
      assignmentId,
      eventType: 'tracking_paused',
      actorUserId,
    });
    logger.info('Tracking paused', { assignmentId });
    return rows[0];
  }, 'pause_tracking');
}

/**
 * Resume a paused tracking session (paused -> active).
 */
async function resumeTracking(assignmentId, actorUserId) {
  return withTransaction(pool, async (client) => {
    const assignment = await loadAssignmentForUpdate(client, assignmentId);
    if (assignment.status !== 'paused') {
      throw trackingError('tracking_resume_invalid', `Cannot resume a ${assignment.status} assignment`, 409);
    }
    const { rows } = await client.query(
      `UPDATE delivery_tracking_assignments
          SET status = 'active', updated_at = NOW()
        WHERE id = $1
        RETURNING *`,
      [assignmentId]
    );
    await insertTrackingEvent(client, {
      deliveryJobId: assignment.delivery_job_id,
      assignmentId,
      eventType: 'tracking_resumed',
      actorUserId,
    });
    logger.info('Tracking resumed', { assignmentId });
    return rows[0];
  }, 'resume_tracking');
}

/**
 * Stop a tracking session. 'delivered' maps to status 'completed'; every
 * other reason maps to 'revoked'. Writes a tracking_stopped event.
 */
async function stopTracking(assignmentId, { reason = 'manual', actorUserId = null } = {}) {
  if (!STOP_REASONS.includes(reason)) {
    throw trackingError('tracking_stop_reason_invalid', 'Unknown tracking stop reason');
  }
  return withTransaction(pool, async (client) => {
    const assignment = await loadAssignmentForUpdate(client, assignmentId);
    if (!['active', 'paused'].includes(assignment.status)) {
      throw trackingError('tracking_already_ended', `Assignment already ${assignment.status}`, 409);
    }
    const status = reason === 'delivered' ? 'completed' : 'revoked';
    const { rows } = await client.query(
      `UPDATE delivery_tracking_assignments
          SET status = $2, ended_at = NOW(), ended_reason = $3, updated_at = NOW()
        WHERE id = $1
        RETURNING *`,
      [assignmentId, status, reason]
    );
    await insertTrackingEvent(client, {
      deliveryJobId: assignment.delivery_job_id,
      assignmentId,
      eventType: 'tracking_stopped',
      actorUserId,
      payload: { reason },
    });
    logger.info('Tracking stopped', { assignmentId, reason });
    return rows[0];
  }, 'stop_tracking');
}

/**
 * Validate one raw location point against the last accepted point.
 * Returns { state: 'valid'|'suspicious'|'rejected', notes }.
 * Suspicious points are stored for operations review; rejected points are not.
 */
function validatePoint(raw, previous, nowMs) {
  const latitude = raw.latitude == null ? NaN : Number(raw.latitude);
  const longitude = raw.longitude == null ? NaN : Number(raw.longitude);
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90
    || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    return { state: 'rejected', notes: 'invalid_coordinates' };
  }

  const recordedAt = raw.recordedAt instanceof Date ? raw.recordedAt : new Date(raw.recordedAt);
  if (Number.isNaN(recordedAt.getTime())) {
    return { state: 'rejected', notes: 'invalid_recorded_at' };
  }
  const recordedMs = recordedAt.getTime();
  if (recordedMs - nowMs > MAX_FUTURE_SKEW_MS) {
    return { state: 'rejected', notes: 'future_timestamp' };
  }
  if (nowMs - recordedMs > MAX_POINT_AGE_MS) {
    return { state: 'rejected', notes: 'stale_timestamp' };
  }

  const accuracy = raw.accuracyMeters == null ? null : Number(raw.accuracyMeters);
  if (accuracy !== null) {
    if (!Number.isFinite(accuracy) || accuracy < 0) {
      return { state: 'rejected', notes: 'invalid_accuracy' };
    }
    if (accuracy > MAX_ACCURACY_METERS) {
      return { state: 'suspicious', notes: `low_accuracy:${accuracy}m` };
    }
  }

  if (previous && Number.isFinite(previous.latitude) && Number.isFinite(previous.longitude)) {
    const dtSeconds = (recordedMs - previous.recordedMs) / 1000;
    if (dtSeconds > 0) {
      const distance = haversineMeters(previous.latitude, previous.longitude, latitude, longitude);
      if (dtSeconds < JUMP_WINDOW_SECONDS && distance > JUMP_DISTANCE_METERS) {
        return {
          state: 'suspicious',
          notes: `impossible_jump:${Math.round(distance)}m_in_${Math.round(dtSeconds)}s`,
        };
      }
      const impliedSpeed = distance / dtSeconds;
      if (impliedSpeed > MAX_PLAUSIBLE_SPEED_MPS) {
        return {
          state: 'suspicious',
          notes: `implausible_speed:${impliedSpeed.toFixed(1)}mps`,
        };
      }
    }
    // dtSeconds <= 0 (out-of-order or duplicate timestamp): accepted as a
    // late-arriving audit event without speed validation.
  }

  return { state: 'valid', notes: null };
}

function pointSource(assignment, raw) {
  if (raw.source && LOCATION_SOURCES.includes(raw.source)) return raw.source;
  if (assignment.source_policy === 'driver_gps') return 'driver_gps';
  // Telematics policies: without an explicit provider on the point, record as
  // driver GPS so the source stays within the schema's provider vocabulary.
  return 'driver_gps';
}

function idempotencyKeyFor(deviceId, raw) {
  const seq = raw.sequence;
  if (seq !== null && seq !== undefined && seq !== '') {
    return `${deviceId}:${String(seq)}`;
  }
  const recordedAt = raw.recordedAt instanceof Date ? raw.recordedAt : new Date(raw.recordedAt);
  return `${deviceId}:ts:${recordedAt.toISOString()}`;
}

/**
 * Ingest a batch of location points for an active assignment.
 * - Points are validated in recordedAt order against the last accepted point.
 * - Deduplication via idempotency_key = `${deviceId}:${sequence}` (conflicts
 *   are skipped silently and counted as duplicates).
 * - Valid and suspicious points are inserted; rejected points are counted
 *   but never stored.
 * - A single location_batch event summarizes the batch in the same transaction.
 */
async function ingestLocationBatch({ assignmentId, points = [], actorUserId = null }) {
  if (!assignmentId) {
    throw trackingError('tracking_assignment_required', 'assignmentId is required');
  }

  return withTransaction(pool, async (client) => {
    const { rows: assignmentRows } = await client.query(
      'SELECT * FROM delivery_tracking_assignments WHERE id = $1',
      [assignmentId]
    );
    const assignment = assignmentRows[0];
    if (!assignment) {
      throw trackingError('tracking_assignment_not_found', 'Tracking assignment not found', 404);
    }
    if (assignment.status !== 'active') {
      throw trackingError('tracking_not_active', `Cannot ingest into a ${assignment.status} assignment`, 409);
    }

    const nowMs = Date.now();
    const ordered = [...points].sort((a, b) => {
      const ta = a.recordedAt instanceof Date ? a.recordedAt.getTime() : new Date(a.recordedAt).getTime();
      const tb = b.recordedAt instanceof Date ? b.recordedAt.getTime() : new Date(b.recordedAt).getTime();
      return (Number.isNaN(ta) ? 0 : ta) - (Number.isNaN(tb) ? 0 : tb);
    });

    // Seed the speed/jump chain with the most recent accepted point, if any.
    let previous = null;
    const { rows: lastRows } = await client.query(
      `SELECT latitude, longitude, recorded_at
         FROM delivery_location_points
        WHERE assignment_id = $1 AND validation_state IN ('valid', 'suspicious')
        ORDER BY recorded_at DESC
        LIMIT 1`,
      [assignmentId]
    );
    if (lastRows[0]) {
      previous = {
        latitude: Number(lastRows[0].latitude),
        longitude: Number(lastRows[0].longitude),
        recordedMs: new Date(lastRows[0].recorded_at).getTime(),
      };
    }

    const summary = { accepted: 0, suspicious: 0, rejected: 0, duplicates: 0 };

    for (const raw of ordered) {
      const check = validatePoint(raw, previous, nowMs);
      if (check.state === 'rejected') {
        summary.rejected += 1;
        logger.warn('Tracking point rejected', {
          assignmentId, notes: check.notes,
        });
        continue;
      }

      const recordedAt = raw.recordedAt instanceof Date ? raw.recordedAt : new Date(raw.recordedAt);
      const key = idempotencyKeyFor(assignment.device_id, raw);
      const latitude = Number(raw.latitude);
      const longitude = Number(raw.longitude);

      let inserted;
      try {
        const res = await client.query(
          `INSERT INTO delivery_location_points
             (assignment_id, delivery_job_id, source, latitude, longitude,
              accuracy_meters, speed_mps, heading_degrees, recorded_at, sequence,
              validation_state, validation_notes, idempotency_key)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
           ON CONFLICT (idempotency_key) DO NOTHING`,
          [
            assignmentId,
            assignment.delivery_job_id,
            pointSource(assignment, raw),
            latitude,
            longitude,
            raw.accuracyMeters == null ? null : Number(raw.accuracyMeters),
            raw.speedMps == null ? null : Number(raw.speedMps),
            raw.headingDegrees == null ? null : Number(raw.headingDegrees),
            recordedAt.toISOString(),
            raw.sequence == null || raw.sequence === '' ? null : raw.sequence,
            check.state,
            check.notes,
            key,
          ]
        );
        inserted = res.rowCount === 1;
      } catch (err) {
        if (isUniqueViolation(err)) {
          inserted = false;
        } else {
          throw err;
        }
      }

      if (!inserted) {
        summary.duplicates += 1;
        continue;
      }

      if (check.state === 'suspicious') {
        summary.suspicious += 1;
        logger.warn('Suspicious tracking point quarantined', {
          assignmentId, notes: check.notes,
        });
      } else {
        summary.accepted += 1;
      }
      previous = { latitude, longitude, recordedMs: recordedAt.getTime() };
    }

    if (ordered.length > 0) {
      await insertTrackingEvent(client, {
        deliveryJobId: assignment.delivery_job_id,
        assignmentId,
        eventType: 'location_batch',
        actorUserId,
        payload: { ...summary, point_count: ordered.length },
      });
    }

    logger.info('Location batch ingested', { assignmentId, ...summary });
    return summary;
  }, 'ingest_location_batch');
}

function defaultScanIdempotencyKey({ deliveryJobId, scanType, scannedByUserId, codeValue }) {
  return crypto.createHash('sha256')
    .update([deliveryJobId, scanType, scannedByUserId, codeValue].join('|'))
    .digest('hex');
}

/**
 * Record an immutable QR/barcode scan event.
 * The scanner must be the assigned driver/helper or an ops user
 * (admin / super_admin). Idempotent on idempotency_key: a replayed scan
 * returns the original row without writing a duplicate event.
 * Scans are evidence only; they cannot complete a delivery.
 */
async function recordScan({ deliveryJobId, scanType, scannedByUserId, codeValue, codeFormat = null, idempotencyKey = null }) {
  if (!SCAN_TYPES.includes(scanType)) {
    throw trackingError('tracking_scan_type_invalid', 'Unknown scan type');
  }
  if (!deliveryJobId || !scannedByUserId || !codeValue) {
    throw trackingError('tracking_scan_invalid', 'deliveryJobId, scannedByUserId and codeValue are required');
  }
  const key = idempotencyKey
    || defaultScanIdempotencyKey({ deliveryJobId, scanType, scannedByUserId, codeValue });

  return withTransaction(pool, async (client) => {
    const job = await getDeliveryJob(client, deliveryJobId);
    if (!job) {
      throw trackingError('tracking_delivery_not_found', 'Delivery job not found', 404);
    }

    const { rows: userRows } = await client.query(
      'SELECT id, role FROM users WHERE id = $1',
      [scannedByUserId]
    );
    const scanner = userRows[0];
    const isAssignedDriver = scanner && String(job.helper_user_id) === String(scannedByUserId);
    const isOps = scanner && OPS_ROLES.includes(String(scanner.role));
    if (!isAssignedDriver && !isOps) {
      throw trackingError('tracking_scan_forbidden', 'Only the assigned driver or operations may record scans', 403);
    }

    const { rows: insertedRows, rowCount } = await client.query(
      `INSERT INTO delivery_scan_events
         (delivery_job_id, scan_type, scanned_by_user_id, code_value, code_format, idempotency_key)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (idempotency_key) DO NOTHING
       RETURNING *`,
      [deliveryJobId, scanType, scannedByUserId, codeValue, codeFormat, key]
    );

    let scan = insertedRows[0];
    let duplicate = false;
    if (rowCount === 0) {
      const { rows: existing } = await client.query(
        'SELECT * FROM delivery_scan_events WHERE idempotency_key = $1',
        [key]
      );
      scan = existing[0];
      duplicate = true;
      logger.info('Duplicate scan replayed idempotently', { deliveryJobId, scanType, scanId: scan && scan.id });
    } else {
      await insertTrackingEvent(client, {
        deliveryJobId,
        eventType: 'scan_recorded',
        actorUserId: scannedByUserId,
        payload: { scan_id: scan.id, scan_type: scanType, code_format: codeFormat },
      });
      logger.info('Scan recorded', { deliveryJobId, scanType, scanId: scan.id });
    }

    return { ...scan, duplicate };
  }, 'record_scan');
}

/**
 * Operational status for a delivery's tracking session: the active assignment,
 * its device, and the consent summary, or null when nothing is active.
 * (Raw operational shape; customer-safe projection happens in the API layer.)
 */
async function getAssignmentStatus(deliveryJobId) {
  const { rows: assignmentRows } = await pool.query(
    `SELECT * FROM delivery_tracking_assignments
      WHERE delivery_job_id = $1 AND status IN ('active', 'paused')
      ORDER BY started_at DESC
      LIMIT 1`,
    [deliveryJobId]
  );
  const assignment = assignmentRows[0];
  if (!assignment) return null;

  const { rows: deviceRows } = await pool.query(
    `SELECT id, kind, driver_user_id, vehicle_id, device_label, platform,
            app_version, status, last_seen_at
       FROM delivery_tracking_devices
      WHERE id = $1`,
    [assignment.device_id]
  );

  const { rows: consentRows } = await pool.query(
    `SELECT id, driver_user_id, device_id, consent_version, consented_at
       FROM delivery_tracking_consent
      WHERE delivery_job_id = $1 AND driver_user_id = $2 AND revoked_at IS NULL`,
    [deliveryJobId, assignment.driver_user_id]
  );

  const { rows: pointRows } = await pool.query(
    `SELECT recorded_at, validation_state
       FROM delivery_location_points
      WHERE assignment_id = $1
      ORDER BY recorded_at DESC
      LIMIT 1`,
    [assignment.id]
  );
  const lastPoint = pointRows[0] || null;

  return {
    assignment,
    device: deviceRows[0] || null,
    consent: consentRows[0] || null,
    lastLocationAt: lastPoint ? lastPoint.recorded_at : null,
    lastLocationState: lastPoint ? lastPoint.validation_state : null,
  };
}

module.exports = {
  grantConsent,
  revokeConsent,
  getActiveConsent,
  startTracking,
  pauseTracking,
  resumeTracking,
  stopTracking,
  ingestLocationBatch,
  recordScan,
  getAssignmentStatus,
  // exported for testing
  _validatePoint: validatePoint,
  _haversineMeters: haversineMeters,
  _verifyDeviceForDriver: verifyDeviceForDriver,
};
