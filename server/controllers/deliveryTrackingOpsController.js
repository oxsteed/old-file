'use strict';

/**
 * server/controllers/deliveryTrackingOpsController.js
 *
 * Operations tracking API for the full delivery tracking integration
 * (docs/oxsteed-delivery-full-tracking-integration-plan.md).
 *
 * All handlers are mounted behind requireAuth + requireOperationsWorkspace:
 * exact coordinates and raw tracking data are operations-only. Customer-safe
 * (approximate) projections belong in a separate API layer.
 *
 * Every handler maps service `{ code, status }` errors to HTTP responses via
 * sendError(). This controller never mutates delivery_jobs status, pricing,
 * or payments; tracking records are evidence only.
 */

const pool = require('../db');
const logger = require('../utils/logger');
const { withTransaction } = require('../utils/transaction');
const trackingService = require('../services/deliveryTrackingService');
const geofenceService = require('../services/deliveryGeofenceService');
const etaService = require('../services/deliveryEtaService');
const telematicsService = require('../services/telematicsConnectionService');

const REVIEWABLE_POINT_STATES = ['pending', 'suspicious'];
const REVIEW_QUEUE_STATES = ['suspicious', 'rejected'];
const REVIEW_DECISIONS = ['valid', 'rejected'];
const MAX_PAGE_LIMIT = 100;

// Service error codes that do not carry an HTTP status of their own.
const CODE_TO_STATUS = {
  TELEMATICS_CONNECTION_NOT_FOUND: 404,
  TELEMATICS_CONNECTION_STATE: 409,
  PROVIDER_NOT_CONFIGURED: 503,
};

function opsError(code, message, status = 400) {
  const err = new Error(message);
  err.code = code;
  err.status = status;
  return err;
}

function httpStatusFor(err) {
  if (err && Number.isInteger(err.status) && err.status >= 400 && err.status < 600) {
    return err.status;
  }
  if (err && CODE_TO_STATUS[err.code]) {
    return CODE_TO_STATUS[err.code];
  }
  // telematicsConnectionService.connect() -> getAdapter() throws a plain
  // Error for unknown provider names.
  if (err && typeof err.message === 'string' && /^Unknown telematics provider/.test(err.message)) {
    return 400;
  }
  // deliveryEtaService throws plain Errors; "... not found" maps to 404.
  if (err && typeof err.message === 'string' && /not found/i.test(err.message)) {
    return 404;
  }
  return 500;
}

function sendError(res, err, context) {
  const status = httpStatusFor(err);
  const code = (err && err.code) || 'internal_error';
  const log = { ...context, code, status };
  if (status >= 500) {
    logger.error('Delivery tracking ops request failed', { ...log, error: err && err.message });
  } else {
    logger.warn('Delivery tracking ops request rejected', log);
  }
  return res.status(status).json({
    error: status >= 500 ? 'Internal server error' : (err && err.message) || 'Request failed',
    code,
  });
}

function parsePagination(query) {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(MAX_PAGE_LIMIT, Math.max(1, parseInt(query.limit, 10) || 25));
  return { page, limit, offset: (page - 1) * limit };
}

// Mirrors telematicsConnectionService's internal toRow(): the table stores
// only references (webhook_secret_ref / credential_ref), never secret values,
// so these rows are safe to return to operations users.
function toConnectionRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    provider: row.provider,
    vehicleId: row.vehicle_id,
    status: row.status,
    cursor: row.cursor,
    webhookSubscriptionId: row.webhook_subscription_id,
    webhookSecretRef: row.webhook_secret_ref,
    credentialRef: row.credential_ref,
    lastSyncAt: row.last_sync_at,
    lastError: row.last_error,
    errorCount: row.error_count,
    syncState: row.sync_state,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const POINT_COLUMNS = `id, assignment_id, delivery_job_id, source, latitude, longitude,
  accuracy_meters, speed_mps, heading_degrees, recorded_at, received_at, sequence,
  validation_state, validation_notes`;

/**
 * GET /delivery/internal/jobs/:id/tracking/exact
 * Full operational tracking state for a delivery: assignment, device,
 * consent, latest exact points (200, newest first), ETA history, geofences +
 * observations, scan history, points awaiting review, and tracking events.
 */
async function getExactTracking(req, res) {
  const deliveryJobId = req.params.id;
  try {
    const job = (await pool.query(
      'SELECT id, reference, status FROM delivery_jobs WHERE id = $1',
      [deliveryJobId]
    )).rows[0];
    if (!job) {
      throw opsError('tracking_delivery_not_found', 'Delivery job not found', 404);
    }

    const [
      assignmentStatus,
      points,
      etaHistory,
      geofences,
      observations,
      scans,
      reviewPoints,
      events,
    ] = await Promise.all([
      trackingService.getAssignmentStatus(deliveryJobId),
      pool.query(
        `SELECT ${POINT_COLUMNS} FROM delivery_location_points
          WHERE delivery_job_id = $1
          ORDER BY recorded_at DESC, id DESC
          LIMIT 200`,
        [deliveryJobId]
      ),
      pool.query(
        `SELECT id, eta_at, source, confidence, basis, created_at
           FROM delivery_eta_snapshots
          WHERE delivery_job_id = $1
          ORDER BY created_at DESC, id DESC
          LIMIT 100`,
        [deliveryJobId]
      ),
      pool.query(
        `SELECT id, kind, center_lat, center_lng, radius_meters, active, created_at
           FROM delivery_geofences
          WHERE delivery_job_id = $1
          ORDER BY kind`,
        [deliveryJobId]
      ),
      geofenceService.getObservations(deliveryJobId),
      pool.query(
        `SELECT id, scan_type, scanned_by_user_id, code_value, code_format, scanned_at, created_at
           FROM delivery_scan_events
          WHERE delivery_job_id = $1
          ORDER BY scanned_at DESC, id DESC`,
        [deliveryJobId]
      ),
      pool.query(
        `SELECT ${POINT_COLUMNS} FROM delivery_location_points
          WHERE delivery_job_id = $1 AND validation_state = ANY($2)
          ORDER BY recorded_at DESC, id DESC
          LIMIT 100`,
        [deliveryJobId, REVIEWABLE_POINT_STATES]
      ),
      pool.query(
        `SELECT id, assignment_id, event_type, event_version, actor_user_id,
                provider, provider_event_id, payload, created_at
           FROM delivery_tracking_events
          WHERE delivery_job_id = $1
          ORDER BY created_at DESC, id DESC
          LIMIT 100`,
        [deliveryJobId]
      ),
    ]);

    return res.status(200).json({
      success: true,
      tracking: {
        job,
        assignment: assignmentStatus ? assignmentStatus.assignment : null,
        device: assignmentStatus ? assignmentStatus.device : null,
        consent: assignmentStatus ? assignmentStatus.consent : null,
        lastLocationAt: assignmentStatus ? assignmentStatus.lastLocationAt : null,
        points: points.rows,
        etaHistory: etaHistory.rows,
        geofences: geofences.rows,
        geofenceObservations: observations,
        scans: scans.rows,
        pointsAwaitingReview: reviewPoints.rows,
        events: events.rows,
      },
    });
  } catch (err) {
    return sendError(res, err, { handler: 'getExactTracking', deliveryJobId });
  }
}

/**
 * GET /delivery/internal/tracking/review-queue?state=suspicious|rejected
 * Paginated location points flagged for operations review across deliveries,
 * joined to the delivery job reference and status.
 */
async function getReviewQueue(req, res) {
  try {
    const state = String(req.query.state || 'suspicious');
    if (!REVIEW_QUEUE_STATES.includes(state)) {
      throw opsError(
        'tracking_review_state_invalid',
        `state must be one of: ${REVIEW_QUEUE_STATES.join(', ')}`
      );
    }
    const { page, limit, offset } = parsePagination(req.query);

    const [{ rows: countRows }, { rows }] = await Promise.all([
      pool.query(
        `SELECT COUNT(*)::int AS total FROM delivery_location_points
          WHERE validation_state = $1`,
        [state]
      ),
      pool.query(
        `SELECT p.id, p.assignment_id, p.delivery_job_id, p.source, p.latitude, p.longitude,
                p.accuracy_meters, p.speed_mps, p.heading_degrees, p.recorded_at, p.received_at,
                p.sequence, p.validation_state, p.validation_notes,
                j.reference AS job_reference, j.status AS job_status
           FROM delivery_location_points p
           JOIN delivery_jobs j ON j.id = p.delivery_job_id
          WHERE p.validation_state = $1
          ORDER BY p.recorded_at DESC, p.id DESC
          LIMIT $2 OFFSET $3`,
        [state, limit, offset]
      ),
    ]);

    const total = countRows[0] ? countRows[0].total : 0;
    return res.status(200).json({
      success: true,
      points: rows,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (err) {
    return sendError(res, err, { handler: 'getReviewQueue' });
  }
}

/**
 * PATCH /delivery/internal/tracking/points/:pointId
 * Operations review decision on a quarantined point: accept it as valid or
 * confirm it as rejected. Writes a tracking_exception audit event in the same
 * transaction. Already-reviewed points are not re-decided (409).
 */
async function reviewPoint(req, res) {
  const pointId = req.params.pointId;
  try {
    const decision = req.body && req.body.validationState;
    const notes = req.body && req.body.notes != null ? String(req.body.notes).slice(0, 2000) : null;
    if (!REVIEW_DECISIONS.includes(decision)) {
      throw opsError(
        'tracking_review_decision_invalid',
        `validationState must be one of: ${REVIEW_DECISIONS.join(', ')}`
      );
    }
    const reviewerId = req.user && req.user.id ? req.user.id : null;

    const point = await withTransaction(pool, async (client) => {
      const { rows: existing } = await client.query(
        'SELECT id, delivery_job_id, assignment_id, validation_state FROM delivery_location_points WHERE id = $1',
        [pointId]
      );
      const current = existing[0];
      if (!current) {
        throw opsError('tracking_point_not_found', 'Tracking point not found', 404);
      }
      if (!REVIEWABLE_POINT_STATES.includes(current.validation_state)) {
        throw opsError(
          'tracking_point_already_reviewed',
          `Point was already reviewed (${current.validation_state})`,
          409
        );
      }
      const { rows: updated } = await client.query(
        `UPDATE delivery_location_points
            SET validation_state = $1, validation_notes = $2
          WHERE id = $3
          RETURNING ${POINT_COLUMNS}`,
        [decision, notes, pointId]
      );
      await client.query(
        `INSERT INTO delivery_tracking_events
           (delivery_job_id, assignment_id, event_type, actor_user_id, payload)
         VALUES ($1, $2, 'tracking_exception', $3, $4)`,
        [
          current.delivery_job_id,
          current.assignment_id,
          reviewerId,
          JSON.stringify({ point_id: Number(pointId), decision, notes, reviewed_by: reviewerId }),
        ]
      );
      logger.info('Tracking point reviewed', {
        pointId, decision, reviewerId, deliveryJobId: current.delivery_job_id,
      });
      return updated[0];
    }, 'review_tracking_point');

    return res.status(200).json({ success: true, point });
  } catch (err) {
    return sendError(res, err, { handler: 'reviewPoint', pointId });
  }
}

/**
 * POST /delivery/internal/telematics/connections
 * Register (or re-register) a telematics provider connection for a vehicle.
 * Only references are stored; secrets live in the secure configuration store.
 */
async function createTelematicsConnection(req, res) {
  try {
    const { provider, vehicleId = null, credentialRef = null, webhookSecretRef = null } = req.body || {};
    if (!provider) {
      throw opsError('telematics_provider_required', 'provider is required');
    }
    const connection = await telematicsService.connect({
      provider,
      vehicleId,
      credentialRef,
      webhookSecretRef,
    });
    logger.info('Telematics connection registered', {
      connectionId: connection.id, provider, vehicleId,
      actorId: req.user && req.user.id,
    });
    return res.status(201).json({ success: true, connection });
  } catch (err) {
    return sendError(res, err, { handler: 'createTelematicsConnection' });
  }
}

/**
 * GET /delivery/internal/telematics/connections
 * List provider connections, newest first. Rows carry only secret references.
 */
async function listTelematicsConnections(req, res) {
  try {
    const { rows } = await pool.query(
      `SELECT id, provider, vehicle_id, status, cursor, webhook_subscription_id,
              webhook_secret_ref, credential_ref, last_sync_at, last_error,
              error_count, sync_state, created_at, updated_at
         FROM delivery_telematics_connections
        ORDER BY updated_at DESC`
    );
    return res.status(200).json({ success: true, connections: rows.map(toConnectionRow) });
  } catch (err) {
    return sendError(res, err, { handler: 'listTelematicsConnections' });
  }
}

async function changeConnectionStatus(req, res, action, serviceFn) {
  try {
    const connection = await serviceFn(req.params.id);
    logger.info(`Telematics connection ${action}`, {
      connectionId: connection.id, provider: connection.provider,
      actorId: req.user && req.user.id,
    });
    return res.status(200).json({ success: true, connection });
  } catch (err) {
    return sendError(res, err, { handler: `${action}TelematicsConnection`, connectionId: req.params.id });
  }
}

/** POST /delivery/internal/telematics/connections/:id/pause */
function pauseTelematicsConnection(req, res) {
  return changeConnectionStatus(req, res, 'pause', telematicsService.pause);
}

/** POST /delivery/internal/telematics/connections/:id/resume */
function resumeTelematicsConnection(req, res) {
  return changeConnectionStatus(req, res, 'resume', telematicsService.resume);
}

/** POST /delivery/internal/telematics/connections/:id/revoke */
function revokeTelematicsConnection(req, res) {
  return changeConnectionStatus(req, res, 'revoke', telematicsService.revoke);
}

/**
 * POST /delivery/internal/telematics/connections/:id/reconcile {cursor}
 * Manually set the provider feed cursor after replaying missed updates.
 */
async function reconcileTelematicsConnection(req, res) {
  try {
    const cursor = req.body && req.body.cursor;
    if (cursor === undefined || cursor === null || String(cursor).trim() === '') {
      throw opsError('telematics_cursor_required', 'cursor is required');
    }
    const connection = await telematicsService.updateCursor(req.params.id, String(cursor));
    logger.info('Telematics connection cursor reconciled', {
      connectionId: connection.id, provider: connection.provider,
      actorId: req.user && req.user.id,
    });
    return res.status(200).json({ success: true, connection });
  } catch (err) {
    return sendError(res, err, { handler: 'reconcileTelematicsConnection', connectionId: req.params.id });
  }
}

/**
 * POST /delivery/internal/tracking/eta/:id/refresh
 * Force an ETA recomputation for a delivery (bypasses the 1/minute throttle).
 * Advisory only: never touches delivery_jobs, pricing, or payments.
 */
async function refreshEta(req, res) {
  const deliveryJobId = req.params.id;
  try {
    const snapshot = await etaService.refreshEta(deliveryJobId, { force: true });
    logger.info('ETA refresh forced', {
      deliveryJobId, snapshotId: snapshot && snapshot.id,
      actorId: req.user && req.user.id,
    });
    return res.status(200).json({ success: true, eta: snapshot });
  } catch (err) {
    return sendError(res, err, { handler: 'refreshEta', deliveryJobId });
  }
}

/**
 * GET /delivery/internal/jobs/:id/tracking/geofences
 * Geofence definitions plus arrival/departure observations for a delivery.
 */
async function getGeofences(req, res) {
  const deliveryJobId = req.params.id;
  try {
    const [{ rows: geofences }, observations] = await Promise.all([
      pool.query(
        `SELECT id, kind, center_lat, center_lng, radius_meters, active, created_at
           FROM delivery_geofences
          WHERE delivery_job_id = $1
          ORDER BY kind`,
        [deliveryJobId]
      ),
      geofenceService.getObservations(deliveryJobId),
    ]);
    return res.status(200).json({ success: true, geofences, observations });
  } catch (err) {
    return sendError(res, err, { handler: 'getGeofences', deliveryJobId });
  }
}

/**
 * GET /delivery/internal/jobs/:id/tracking/eta-history
 * ETA snapshots for a delivery, newest first.
 */
async function getEtaHistory(req, res) {
  const deliveryJobId = req.params.id;
  try {
    const { rows } = await pool.query(
      `SELECT id, eta_at, source, confidence, basis, created_at
         FROM delivery_eta_snapshots
        WHERE delivery_job_id = $1
        ORDER BY created_at DESC, id DESC
        LIMIT 100`,
      [deliveryJobId]
    );
    return res.status(200).json({ success: true, snapshots: rows });
  } catch (err) {
    return sendError(res, err, { handler: 'getEtaHistory', deliveryJobId });
  }
}

module.exports = {
  getExactTracking,
  getReviewQueue,
  reviewPoint,
  createTelematicsConnection,
  listTelematicsConnections,
  pauseTelematicsConnection,
  resumeTelematicsConnection,
  revokeTelematicsConnection,
  reconcileTelematicsConnection,
  refreshEta,
  getGeofences,
  getEtaHistory,
};
