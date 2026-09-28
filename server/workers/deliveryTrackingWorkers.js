'use strict';

/**
 * server/workers/deliveryTrackingWorkers.js
 *
 * Background workers for the full delivery tracking integration
 * (docs/oxsteed-delivery-full-tracking-integration-plan.md, migration 576).
 *
 * Each export is an async job processor taking `{ limit }` and returning a
 * summary object. Every processor is idempotent: re-running with no new data
 * produces no duplicate tracking events, notifications, or state changes.
 *
 * Hard rules (inherited from the tracking services):
 *  - Tracking workers NEVER mutate delivery_jobs status, pricing, or payments.
 *  - Suspicious location points are quarantined for operations review; they
 *    never change delivery state.
 *  - Customer notifications never carry exact coordinates.
 *
 * Scheduling lives in server/workerMain.js (setInterval-based, alongside the
 * translation worker), following the repo's pattern for non-payment workers.
 */

const pool = require('../db');
const logger = require('../utils/logger');
const { withTransaction } = require('../utils/transaction');
const { _validatePoint } = require('../services/deliveryTrackingService');
const { refreshEta } = require('../services/deliveryEtaService');
const { evaluatePoint } = require('../services/deliveryGeofenceService');
const { expireCompletedLinks } = require('../services/deliveryTrackingLinkService');
const { getAdapter } = require('../services/telematics/adapterRegistry');
const {
  updateCursor,
  recordSyncError,
  recordSyncSuccess,
} = require('../services/telematicsConnectionService');
const { sendNotification } = require('../services/notificationService');

// ── Tunables ────────────────────────────────────────────────────────────────
const PENDING_POINT_GRACE_SECONDS = 30; // let late-arriving points settle before normalizing
const STALE_POINT_MINUTES = 15;         // no valid point for this long => stale
const STALE_CURSOR_MINUTES = 30;        // no provider sync for this long => stale cursor
const MAX_WEBHOOK_ERRORS = 10;         // stop retrying a connection past this many errors
const WEBHOOK_RETRY_BACKOFF_MINUTES = 10; // minimum gap between provider retry attempts
const REVOKED_LINK_PRUNE_DAYS = 30;    // delete revoked+expired links older than this
const DEFAULT_LIMIT = 100;

function safeLimit(limit, max) {
  const n = Math.floor(Number(limit));
  if (!Number.isSafeInteger(n) || n <= 0) return Math.min(DEFAULT_LIMIT, max);
  return Math.min(n, max);
}

async function insertTrackingEvent(queryable, {
  deliveryJobId, assignmentId = null, eventType, provider = null, payload = {},
}) {
  await queryable.query(
    `INSERT INTO delivery_tracking_events
       (delivery_job_id, assignment_id, event_type, provider, payload)
     VALUES ($1, $2, $3, $4, $5::jsonb)`,
    [deliveryJobId, assignmentId, eventType, provider, JSON.stringify(payload)]
  );
}

function isoOrNull(value) {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/**
 * Idempotent stale marker: inserts a tracking_stale event only when no such
 * event exists for the current silence window (i.e. none created at/after the
 * last valid point, or the assignment start when there is no point yet).
 * Returns true when a new marker was written.
 */
async function markAssignmentStale({ assignmentId, deliveryJobId, reason }) {
  return withTransaction(pool, async (client) => {
    const { rows: anchorRows } = await client.query(
      `SELECT a.started_at,
              (SELECT MAX(p.recorded_at)
                 FROM delivery_location_points p
                WHERE p.assignment_id = a.id
                  AND p.validation_state = 'valid') AS last_point_at
         FROM delivery_tracking_assignments a
        WHERE a.id = $1`,
      [assignmentId]
    );
    const anchorRow = anchorRows[0];
    if (!anchorRow) return false;
    const anchor = anchorRow.last_point_at || anchorRow.started_at || new Date(0).toISOString();

    const { rows: existing } = await client.query(
      `SELECT 1
         FROM delivery_tracking_events
        WHERE delivery_job_id = $1
          AND assignment_id = $2
          AND event_type = 'tracking_stale'
          AND created_at >= $3
        LIMIT 1`,
      [deliveryJobId, assignmentId, anchor]
    );
    if (existing.length > 0) return false; // already marked for this silence window

    const nowMs = Date.now();
    const anchorMs = new Date(anchor).getTime();
    await insertTrackingEvent(client, {
      deliveryJobId,
      assignmentId,
      eventType: 'tracking_stale',
      payload: {
        reason,
        last_point_at: isoOrNull(anchorRow.last_point_at),
        silent_minutes: Math.max(0, Math.round((nowMs - anchorMs) / 60000)),
      },
    });
    return true;
  }, 'mark_assignment_stale');
}

/**
 * Location normalization.
 *
 * Picks up points left in `pending` validation_state for more than 30s and
 * re-runs the plausibility checks (accuracy, timestamp, jump, speed) using the
 * same rules as the ingest path. Points flip to `valid` or `suspicious`;
 * suspicious points get a tracking_exception review event in the same
 * transaction as the flip, so a crash cannot orphan a quarantine without its
 * review item (or vice versa). Points that would be rejected are quarantined
 * as suspicious instead: evidence is never deleted by this worker.
 */
async function normalizeLocations({ limit = DEFAULT_LIMIT } = {}) {
  const batch = safeLimit(limit, 500);
  const summary = { scanned: 0, normalized: 0, suspicious: 0, reviewEvents: 0 };

  await withTransaction(pool, async (client) => {
    const { rows } = await client.query(
      `SELECT p.id, p.assignment_id, p.delivery_job_id, p.latitude, p.longitude,
              p.accuracy_meters, p.speed_mps, p.recorded_at
         FROM delivery_location_points p
        WHERE p.validation_state = 'pending'
          AND p.received_at <= NOW() - ($1 * INTERVAL '1 second')
        ORDER BY p.received_at ASC, p.id ASC
        LIMIT $2
        FOR UPDATE SKIP LOCKED`,
      [PENDING_POINT_GRACE_SECONDS, batch]
    );
    summary.scanned = rows.length;
    const nowMs = Date.now();

    for (const point of rows) {
      // Seed the plausibility chain with the latest accepted point recorded
      // before this one, mirroring the ingest path's chaining.
      const { rows: prevRows } = await client.query(
        `SELECT latitude, longitude, recorded_at
           FROM delivery_location_points
          WHERE assignment_id = $1
            AND validation_state IN ('valid', 'suspicious')
            AND recorded_at < $2
          ORDER BY recorded_at DESC, id DESC
          LIMIT 1`,
        [point.assignment_id, point.recorded_at]
      );
      const previous = prevRows[0]
        ? {
          latitude: Number(prevRows[0].latitude),
          longitude: Number(prevRows[0].longitude),
          recordedMs: new Date(prevRows[0].recorded_at).getTime(),
        }
        : null;

      const check = _validatePoint(
        {
          latitude: point.latitude,
          longitude: point.longitude,
          recordedAt: point.recorded_at,
          accuracyMeters: point.accuracy_meters,
          speedMps: point.speed_mps,
        },
        previous,
        nowMs
      );

      let state = check.state;
      let notes = check.notes;
      if (state === 'rejected') {
        // Quarantine for ops review instead of deleting stored evidence.
        state = 'suspicious';
        notes = `rejected_on_normalize:${check.notes}`;
      }

      const updated = await client.query(
        `UPDATE delivery_location_points
            SET validation_state = $2, validation_notes = $3
          WHERE id = $1 AND validation_state = 'pending'`,
        [point.id, state, notes]
      );
      if (updated.rowCount !== 1) continue; // lost the race; another worker handled it
      summary.normalized += 1;

      if (state === 'suspicious') {
        summary.suspicious += 1;
        await insertTrackingEvent(client, {
          deliveryJobId: point.delivery_job_id,
          assignmentId: point.assignment_id,
          eventType: 'tracking_exception',
          payload: {
            reason: 'suspicious_location_point',
            point_id: point.id,
            validation_notes: notes,
            recorded_at: isoOrNull(point.recorded_at),
          },
        });
        summary.reviewEvents += 1;
      }
    }
  }, 'normalize_tracking_locations');

  logger.info('Tracking location normalization complete', summary);
  return summary;
}

/**
 * ETA refresh.
 *
 * For deliveries with an active tracking assignment and a valid point in the
 * last 15 minutes, calls refreshEta (which is itself throttled to one
 * snapshot per minute unless the driver moved meaningfully). Assignments
 * silent for 15+ minutes get an idempotent tracking_stale marker so the ETA
 * service's freshness logic and the customer UI agree on staleness.
 */
async function refreshEtas({ limit = DEFAULT_LIMIT } = {}) {
  const batch = safeLimit(limit, 200);
  const summary = { checked: 0, refreshed: 0, throttled: 0, staleMarked: 0 };

  const { rows: fresh } = await pool.query(
    `SELECT DISTINCT a.delivery_job_id
       FROM delivery_tracking_assignments a
       JOIN delivery_location_points p ON p.assignment_id = a.id
      WHERE a.status = 'active'
        AND p.validation_state = 'valid'
        AND p.recorded_at > NOW() - ($1 * INTERVAL '1 minute')
      LIMIT $2`,
    [STALE_POINT_MINUTES, batch]
  );
  for (const row of fresh) {
    summary.checked += 1;
    try {
      const result = await refreshEta(row.delivery_job_id);
      if (result && result.throttled) summary.throttled += 1;
      else summary.refreshed += 1;
    } catch (err) {
      logger.warn('Tracking ETA refresh failed', {
        deliveryJobId: row.delivery_job_id,
        error: err.message,
      });
    }
  }

  const { rows: silent } = await pool.query(
    `SELECT a.id, a.delivery_job_id
       FROM delivery_tracking_assignments a
      WHERE a.status = 'active'
        AND NOT EXISTS (
          SELECT 1
            FROM delivery_location_points p
           WHERE p.assignment_id = a.id
             AND p.validation_state = 'valid'
             AND p.recorded_at > NOW() - ($1 * INTERVAL '1 minute')
        )
      LIMIT $2`,
    [STALE_POINT_MINUTES, batch]
  );
  for (const row of silent) {
    const marked = await markAssignmentStale({
      assignmentId: row.id,
      deliveryJobId: row.delivery_job_id,
      reason: 'eta_refresh_no_point',
    });
    if (marked) summary.staleMarked += 1;
  }

  logger.info('Tracking ETA refresh complete', summary);
  return summary;
}

/**
 * Geofence evaluation.
 *
 * Runs evaluatePoint over recent valid points not yet covered by an
 * observation. evaluatePoint only writes on arrival/departure transitions,
 * so re-evaluating an overlapping window never duplicates observations or
 * events.
 */
async function evaluateGeofences({ limit = DEFAULT_LIMIT } = {}) {
  const batch = safeLimit(limit, 100);
  const summary = { jobs: 0, pointsEvaluated: 0, transitions: 0 };

  const { rows: jobs } = await pool.query(
    `SELECT DISTINCT a.delivery_job_id
       FROM delivery_tracking_assignments a
      WHERE a.status = 'active'
      LIMIT $1`,
    [batch]
  );

  for (const { delivery_job_id: deliveryJobId } of jobs) {
    summary.jobs += 1;
    const { rows: obsRows } = await pool.query(
      `SELECT MAX(observed_at) AS last_observed_at
         FROM delivery_geofence_observations
        WHERE delivery_job_id = $1`,
      [deliveryJobId]
    );
    const lastObservedAt = obsRows[0] && obsRows[0].last_observed_at;

    const { rows: points } = await pool.query(
      `SELECT latitude, longitude, recorded_at
         FROM delivery_location_points
        WHERE delivery_job_id = $1
          AND validation_state = 'valid'
          AND recorded_at > NOW() - INTERVAL '2 hours'
          AND ($2::timestamptz IS NULL OR recorded_at > $2)
        ORDER BY recorded_at ASC, id ASC
        LIMIT 50`,
      [deliveryJobId, lastObservedAt]
    );

    for (const point of points) {
      summary.pointsEvaluated += 1;
      try {
        const transition = await evaluatePoint({
          deliveryJobId,
          latitude: point.latitude,
          longitude: point.longitude,
          recordedAt: point.recorded_at,
        });
        if (transition) summary.transitions += 1;
      } catch (err) {
        logger.warn('Geofence evaluation failed', {
          deliveryJobId,
          error: err.message,
        });
      }
    }
  }

  logger.info('Tracking geofence evaluation complete', summary);
  return summary;
}

/**
 * Provider webhook retries.
 *
 * For telematics connections in 'error' status with fewer than 10 errors,
 * attempts fetchIncrementalUpdates through the provider adapter. The adapters
 * are structured stubs: with no credential reference they throw
 * PROVIDER_NOT_CONFIGURED, in which case the attempt is recorded (last_error
 * + updated_at) without burning the retry budget, and the updated_at guard
 * provides the backoff. Genuine successes advance the cursor via updateCursor
 * and clear the error state via recordSyncSuccess.
 */
async function retryProviderWebhooks({ limit = DEFAULT_LIMIT } = {}) {
  const batch = safeLimit(limit, 50);
  const summary = { scanned: 0, succeeded: 0, notConfigured: 0, failed: 0 };

  const { rows } = await pool.query(
    `SELECT id, provider, vehicle_id, cursor, credential_ref, error_count, updated_at
       FROM delivery_telematics_connections
      WHERE status = 'error'
        AND error_count < $1
        AND updated_at <= NOW() - ($2 * INTERVAL '1 minute')
      ORDER BY updated_at ASC
      LIMIT $3`,
    [MAX_WEBHOOK_ERRORS, WEBHOOK_RETRY_BACKOFF_MINUTES, batch]
  );
  summary.scanned = rows.length;

  for (const conn of rows) {
    let adapter;
    try {
      adapter = getAdapter(conn.provider);
    } catch (err) {
      await recordSyncError(conn.id, err);
      summary.failed += 1;
      continue;
    }

    try {
      const result = await adapter.fetchIncrementalUpdates({
        credentialRef: conn.credential_ref,
        cursor: conn.cursor,
        vehicleExternalId: null,
      });
      await updateCursor(conn.id, result ? result.nextCursor : conn.cursor);
      await recordSyncSuccess(conn.id);
      summary.succeeded += 1;
      logger.info('Telematics provider retry succeeded', {
        connectionId: conn.id,
        provider: conn.provider,
      });
    } catch (err) {
      if (err && err.code === 'PROVIDER_NOT_CONFIGURED') {
        // Structured stub with no credential reference: record the attempt
        // without incrementing error_count; updated_at drives the backoff.
        await pool.query(
          `UPDATE delivery_telematics_connections
              SET last_error = $2, updated_at = NOW()
            WHERE id = $1`,
          [conn.id, String(err.message).slice(0, 2000)]
        );
        summary.notConfigured += 1;
      } else {
        await recordSyncError(conn.id, err);
        summary.failed += 1;
      }
      logger.warn('Telematics provider retry failed', {
        connectionId: conn.id,
        provider: conn.provider,
        error: err && err.message,
      });
    }
  }

  logger.info('Telematics provider retry pass complete', summary);
  return summary;
}

/**
 * Cursor reconciliation.
 *
 * Detects active provider connections with no successful sync in 30 minutes
 * and emits one tracking_exception event per affected active delivery so ops
 * can intervene. The exception is deduplicated per (connection, silence
 * window): no new event while one already covers the current window.
 * Connections with no active delivery assignment are skipped — there is
 * nothing customer-affecting to alert on.
 */
async function reconcileCursors({ limit = DEFAULT_LIMIT } = {}) {
  const batch = safeLimit(limit, 100);
  const summary = { staleConnections: 0, events: 0, skipped: 0 };

  const { rows } = await pool.query(
    `SELECT c.id, c.provider, c.vehicle_id, c.last_sync_at, c.created_at
       FROM delivery_telematics_connections c
      WHERE c.status = 'active'
        AND c.vehicle_id IS NOT NULL
        AND (
          c.last_sync_at <= NOW() - ($1 * INTERVAL '1 minute')
          OR (c.last_sync_at IS NULL AND c.created_at <= NOW() - ($1 * INTERVAL '1 minute'))
        )
      ORDER BY c.last_sync_at ASC NULLS FIRST
      LIMIT $2`,
    [STALE_CURSOR_MINUTES, batch]
  );

  for (const conn of rows) {
    summary.staleConnections += 1;
    const { rows: assignments } = await pool.query(
      `SELECT id, delivery_job_id
         FROM delivery_tracking_assignments
        WHERE vehicle_id = $1 AND status = 'active'`,
      [conn.vehicle_id]
    );
    if (assignments.length === 0) {
      summary.skipped += 1;
      continue;
    }

    const silenceAnchor = conn.last_sync_at || conn.created_at;
    const silentMinutes = Math.max(
      0,
      Math.round((Date.now() - new Date(silenceAnchor).getTime()) / 60000)
    );

    for (const assignment of assignments) {
      const { rows: existing } = await pool.query(
        `SELECT 1
           FROM delivery_tracking_events
          WHERE delivery_job_id = $1
            AND event_type = 'tracking_exception'
            AND payload->>'reason' = 'stale_cursor'
            AND payload->>'connection_id' = $2
            AND created_at >= $3
          LIMIT 1`,
        [assignment.delivery_job_id, String(conn.id), silenceAnchor]
      );
      if (existing.length > 0) continue; // ops already alerted for this window

      await insertTrackingEvent(pool, {
        deliveryJobId: assignment.delivery_job_id,
        assignmentId: assignment.id,
        eventType: 'tracking_exception',
        provider: conn.provider,
        payload: {
          reason: 'stale_cursor',
          connection_id: conn.id,
          provider: conn.provider,
          vehicle_id: conn.vehicle_id,
          last_sync_at: isoOrNull(conn.last_sync_at),
          silent_minutes: silentMinutes,
        },
      });
      summary.events += 1;
      logger.warn('Stale telematics cursor detected', {
        connectionId: conn.id,
        provider: conn.provider,
        deliveryJobId: assignment.delivery_job_id,
      });
    }
  }

  logger.info('Telematics cursor reconciliation complete', summary);
  return summary;
}

/**
 * Stale tracker detection.
 *
 * Active tracking assignments with no valid point in the last 15 minutes get
 * an idempotent tracking_stale marker (shared with the ETA worker) plus a
 * single driver notification. The notification carries no coordinates.
 * Reconnect handling (tracking_reconnected) belongs to the ingest path, which
 * sees the new point first; this worker only handles the stale side.
 */
async function detectStaleTrackers({ limit = DEFAULT_LIMIT } = {}) {
  const batch = safeLimit(limit, 200);
  const summary = { checked: 0, staleMarked: 0, notified: 0 };

  const { rows } = await pool.query(
    `SELECT a.id, a.delivery_job_id, a.driver_user_id, dj.reference
       FROM delivery_tracking_assignments a
       JOIN delivery_jobs dj ON dj.id = a.delivery_job_id
      WHERE a.status = 'active'
        AND NOT EXISTS (
          SELECT 1
            FROM delivery_location_points p
           WHERE p.assignment_id = a.id
             AND p.validation_state = 'valid'
             AND p.recorded_at > NOW() - ($1 * INTERVAL '1 minute')
        )
      LIMIT $2`,
    [STALE_POINT_MINUTES, batch]
  );

  for (const row of rows) {
    summary.checked += 1;
    const marked = await markAssignmentStale({
      assignmentId: row.id,
      deliveryJobId: row.delivery_job_id,
      reason: 'stale_tracker_no_point',
    });
    if (!marked) continue;
    summary.staleMarked += 1;

    if (!row.driver_user_id) continue;
    try {
      const result = await sendNotification({
        userId: row.driver_user_id,
        type: 'delivery:tracking_stale',
        // notificationService translates for the recipient; English body copy
        // here is appended to the localized translation. No coordinates.
        body: row.reference
          ? `Tracking for delivery (${row.reference}) has gone quiet.`
          : 'Delivery tracking has gone quiet.',
        data: {
          deliveryJobId: String(row.delivery_job_id),
          assignmentId: String(row.id),
        },
        action_url: `/delivery/jobs/${row.delivery_job_id}`,
        idempotencyKey: `tracking-stale:${row.id}`,
      });
      if (result && result.success !== false) summary.notified += 1;
    } catch (err) {
      logger.warn('Stale tracker notification failed', {
        assignmentId: row.id,
        error: err.message,
      });
    }
  }

  logger.info('Stale tracker detection complete', summary);
  return summary;
}

/**
 * Tracking-link cleanup.
 *
 * Clamps links on terminal jobs to 24h past job end via expireCompletedLinks,
 * then hard-deletes revoked, fully-expired links revoked more than 30 days
 * ago. Raw tokens are never stored, so deletion is safe.
 */
async function cleanupTrackingLinks({ limit = DEFAULT_LIMIT } = {}) {
  const batch = safeLimit(limit, 500);
  const { expired } = await expireCompletedLinks();
  const { rowCount } = await pool.query(
    `DELETE FROM delivery_tracking_links
      WHERE id IN (
        SELECT id
          FROM delivery_tracking_links
         WHERE revoked_at IS NOT NULL
           AND expires_at <= NOW()
           AND revoked_at <= NOW() - ($1 * INTERVAL '1 day')
         LIMIT $2
      )`,
    [REVOKED_LINK_PRUNE_DAYS, batch]
  );
  const summary = {
    expiredLinks: Number(expired) || 0,
    prunedLinks: rowCount || 0,
  };
  logger.info('Tracking link cleanup complete', summary);
  return summary;
}

/**
 * Raw-location retention enforcement.
 *
 * Deletes raw location points past retention_expires_at (90 days by default)
 * in batches. Summaries and milestones live in delivery_tracking_events,
 * which are retained; only raw points are pruned.
 */
async function enforceRetention({ limit = 5000 } = {}) {
  const total = Math.max(1, Math.min(100000, Math.floor(Number(limit)) || 5000));
  const batchSize = Math.min(total, 1000);
  let deleted = 0;
  let batches = 0;

  for (;;) {
    const { rowCount } = await pool.query(
      `DELETE FROM delivery_location_points
        WHERE id IN (
          SELECT id
            FROM delivery_location_points
           WHERE retention_expires_at <= NOW()
           ORDER BY retention_expires_at ASC
           LIMIT $1
        )`,
      [Math.min(batchSize, total - deleted)]
    );
    const n = rowCount || 0;
    deleted += n;
    batches += 1;
    if (n === 0 || deleted >= total) break;
  }

  const summary = { deleted, batches };
  logger.info('Tracking retention enforcement complete', summary);
  return summary;
}

module.exports = {
  normalizeLocations,
  refreshEtas,
  evaluateGeofences,
  retryProviderWebhooks,
  reconcileCursors,
  detectStaleTrackers,
  cleanupTrackingLinks,
  enforceRetention,
  // exported for tests/scheduling
  PENDING_POINT_GRACE_SECONDS,
  STALE_POINT_MINUTES,
  STALE_CURSOR_MINUTES,
  MAX_WEBHOOK_ERRORS,
  WEBHOOK_RETRY_BACKOFF_MINUTES,
  REVOKED_LINK_PRUNE_DAYS,
};
