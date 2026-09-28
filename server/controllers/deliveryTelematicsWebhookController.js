'use strict';

/**
 * server/controllers/deliveryTelematicsWebhookController.js
 *
 * Public telematics provider webhook receiver
 * (POST /delivery/webhooks/telematics/:provider).
 *
 * This endpoint is PUBLIC (no session auth): the provider's webhook signature
 * IS the authentication. A webhook can never grant user access.
 *
 * Processing pipeline:
 *   1. Resolve the adapter via getAdapter(provider); unknown provider -> 404.
 *   2. Load active connection(s) for the provider; none configured -> 404.
 *   3. Verify the signature with adapter.verifyWebhookSignature() using the
 *      secret resolved from connection.webhook_secret_ref. Failure -> 401,
 *      logged, no further processing.
 *   4. Normalize the payload via the adapter (location and/or status).
 *   5. Match the provider vehicle identity to a delivery_vehicles row, then
 *      find the active tracking assignment for the delivery using that
 *      vehicle. Unknown vehicle / no active assignment -> 200 with an
 *      `ignored` reason (avoids provider retry storms for un-actionable
 *      events).
 *   6. Insert the provider_receipt tracking event idempotently via the
 *      (provider, provider_event_id) unique index, then insert the location
 *      point with source=<provider>. Replays -> 200 { duplicate: true }.
 *   7. Advance the connection cursor (provider_event_id) and last_sync_at.
 *
 * Security:
 * - Webhook secrets are NEVER stored in the database. `webhook_secret_ref`
 *   holds the NAME of an environment variable (convention:
 *   TELEMATICS_<PROVIDER>_WEBHOOK_SECRET, e.g. TELEMATICS_SAMSARA_WEBHOOK_SECRET)
 *   resolved via process.env at verification time, following the repo's
 *   existing webhook-secret pattern (cf. STRIPE_WEBHOOK_SECRET in
 *   middleware/webhookAuth.js). Secrets are never logged, never persisted,
 *   and never appear in responses.
 * - Raw body: providers sign the exact bytes they send. req.body is a Buffer
 *   because this route is mounted in server/index.js BEFORE express.json()
 *   with express.raw({ type: 'application/json' }) — the same pattern the
 *   Stripe and verification webhooks use. rawBodyBytes() prefers that Buffer
 *   for signature verification and falls back to the canonical JSON
 *   serialization when the controller is mounted behind a JSON parser
 *   (e.g. in tests).
 * - Tracking writes here are evidence only: this controller never touches
 *   delivery_jobs status, pricing, or payments.
 */

const pool = require('../db');
const logger = require('../utils/logger');
const { withTransaction } = require('../utils/transaction');
const { getAdapter } = require('../services/telematics/adapterRegistry');
const telematicsService = require('../services/telematicsConnectionService');
const trackingEventBus = require('../services/deliveryTrackingEventBus');

// Provider vehicle identities are recorded on the OxSteed vehicle record at
// delivery_vehicles.equipment -> 'telematics' -> '<provider>' so a fleet-level
// connection (vehicle_id NULL) can route events to the right vehicle.
const VEHICLE_IDENTITY_JSON_PATH = "equipment -> 'telematics' ->> $1";

const SIGNATURE_HEADERS = [
  'x-telematics-signature',
  'x-signature',
  'x-hub-signature-256',
  'x-samsara-signature',
];
const TIMESTAMP_HEADERS = [
  'x-signature-timestamp',
  'x-timestamp',
  'x-samsara-timestamp',
];

function webhookError(code, message, status) {
  const err = new Error(message);
  err.code = code;
  err.status = status;
  return err;
}

function firstHeader(req, names) {
  const headers = req.headers || {};
  for (const name of names) {
    const value = headers[name];
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      return String(value);
    }
  }
  return null;
}

// Exact bytes the provider signed. Buffer when express.raw() preserved the
// body; otherwise the canonical JSON serialization of the parsed object.
function rawBodyBytes(req) {
  if (Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === 'string') return Buffer.from(req.body, 'utf8');
  return Buffer.from(JSON.stringify(req.body == null ? {} : req.body), 'utf8');
}

function parsedEvent(req) {
  if (Buffer.isBuffer(req.body)) {
    try {
      return JSON.parse(req.body.toString('utf8'));
    } catch (err) {
      return null;
    }
  }
  return req.body && typeof req.body === 'object' ? req.body : null;
}

// Resolves the webhook secret for a connection WITHOUT ever logging or
// returning the value. `webhook_secret_ref` is the environment variable name.
function resolveWebhookSecret(connection) {
  const ref = connection && connection.webhook_secret_ref;
  if (!ref || typeof ref !== 'string') return null;
  return process.env[ref] || null;
}

async function loadActiveConnections(provider) {
  const { rows } = await pool.query(
    `SELECT * FROM delivery_telematics_connections
      WHERE provider = $1 AND status = 'active'
      ORDER BY updated_at DESC`,
    [provider]
  );
  return rows;
}

async function findVehicleId(provider, vehicleExternalId) {
  const { rows } = await pool.query(
    `SELECT id FROM delivery_vehicles
      WHERE ${VEHICLE_IDENTITY_JSON_PATH} = $2
      LIMIT 1`,
    [provider, vehicleExternalId]
  );
  return rows[0] ? rows[0].id : null;
}

async function findActiveAssignment(vehicleId) {
  const { rows } = await pool.query(
    `SELECT id, delivery_job_id, vehicle_id, device_id, driver_user_id, source_policy
       FROM delivery_tracking_assignments
      WHERE vehicle_id = $1 AND status = 'active'
      ORDER BY started_at DESC
      LIMIT 1`,
    [vehicleId]
  );
  return rows[0] || null;
}

function okIgnored(res, reason, detail) {
  return res.status(200).json({ success: true, ignored: reason, ...(detail || {}) });
}

/**
 * POST /delivery/webhooks/telematics/:provider
 */
async function receiveWebhook(req, res) {
  const provider = req.params.provider;

  let adapter;
  try {
    adapter = getAdapter(provider);
  } catch (err) {
    return res.status(404).json({ error: 'Unknown telematics provider', code: 'telematics_unknown_provider' });
  }

  try {
    const connections = await loadActiveConnections(provider);
    if (connections.length === 0) {
      logger.warn('Telematics webhook for provider with no active connection', { provider });
      return res.status(404).json({
        error: 'No active telematics connection for provider',
        code: 'telematics_connection_not_found',
      });
    }

    const rawEvent = parsedEvent(req);
    if (!rawEvent) {
      throw webhookError('telematics_invalid_payload', 'Webhook payload is not valid JSON', 400);
    }

    const rawBody = rawBodyBytes(req);
    const signature = firstHeader(req, SIGNATURE_HEADERS);
    const timestamp = firstHeader(req, TIMESTAMP_HEADERS);

    // Verify against every active connection's secret; the first match wins.
    // Connections without a resolvable secret can never verify — skip them.
    let connection = null;
    for (const candidate of connections) {
      const secret = resolveWebhookSecret(candidate);
      if (!secret) {
        logger.warn('Telematics webhook secret not configured for connection', {
          provider,
          connectionId: candidate.id,
          webhookSecretRef: candidate.webhook_secret_ref || null,
        });
        continue;
      }
      let verified = false;
      try {
        verified = adapter.verifyWebhookSignature({ rawBody, signature, secret, timestamp });
      } catch (err) {
        verified = false;
      }
      if (verified) {
        connection = candidate;
        break;
      }
    }

    if (!connection) {
      logger.warn('Telematics webhook signature verification failed', {
        provider,
        ip: req.ip,
        // Truncated on purpose: never log a full presented signature.
        signaturePrefix: signature ? `${String(signature).slice(0, 12)}...` : null,
      });
      return res.status(401).json({
        error: 'Invalid webhook signature',
        code: 'telematics_bad_signature',
      });
    }

    // Normalize via the adapter. Unknown/unparseable event types must never
    // crash the receiver: null payloads are acknowledged and ignored.
    let locationPoint = null;
    let statusPoint = null;
    try {
      locationPoint = adapter.normalizeLocationPayload(rawEvent);
      statusPoint = adapter.normalizeStatusPayload(rawEvent);
    } catch (err) {
      logger.warn('Telematics payload normalization failed', {
        provider, connectionId: connection.id, error: err.message,
      });
    }
    if (!locationPoint && !statusPoint) {
      logger.info('Telematics webhook carried no location or status signal', {
        provider, connectionId: connection.id,
      });
      return okIgnored(res, 'unrecognized_payload');
    }

    const providerEventId = (locationPoint && locationPoint.providerEventId)
      || (statusPoint && statusPoint.providerEventId)
      || null;

    // Match the provider vehicle identity to an OxSteed vehicle record. A
    // per-vehicle connection already names the vehicle; a fleet-level
    // connection (vehicle_id NULL) resolves it from the event.
    let vehicleId = connection.vehicle_id || null;
    if (!vehicleId) {
      const vehicleExternalId = adapter.parseVehicleIdentity(rawEvent);
      if (!vehicleExternalId) {
        logger.info('Telematics webhook without determinable vehicle identity', {
          provider, connectionId: connection.id,
        });
        return okIgnored(res, 'unknown_vehicle');
      }
      vehicleId = await findVehicleId(provider, vehicleExternalId);
      if (!vehicleId) {
        logger.info('Telematics webhook for unknown vehicle', {
          provider, connectionId: connection.id, vehicleExternalId,
        });
        return okIgnored(res, 'unknown_vehicle');
      }
    }

    const assignment = await findActiveAssignment(vehicleId);
    if (!assignment) {
      logger.info('Telematics webhook with no active tracking assignment', {
        provider, connectionId: connection.id, vehicleId,
      });
      return okIgnored(res, 'no_active_assignment', { vehicleId });
    }
    const deliveryJobId = assignment.delivery_job_id;

    // Persist the provider_receipt event idempotently on the
    // (provider, provider_event_id) unique index, then store the location
    // point with source=<provider>. The whole write is one transaction so a
    // replay can never double-record a point.
    const outcome = await withTransaction(pool, async (client) => {
      let receiptId = null;
      if (providerEventId) {
        const receipt = await client.query(
          `INSERT INTO delivery_tracking_events
             (delivery_job_id, assignment_id, event_type, provider, provider_event_id, payload)
           VALUES ($1, $2, 'provider_receipt', $3, $4, $5)
           ON CONFLICT (provider, provider_event_id)
             WHERE provider IS NOT NULL AND provider_event_id IS NOT NULL
           DO NOTHING
           RETURNING id`,
          [
            deliveryJobId,
            assignment.id,
            provider,
            providerEventId,
            JSON.stringify({
              vehicle_external_id: adapter.parseVehicleIdentity(rawEvent),
              location: locationPoint,
              status: statusPoint,
            }),
          ]
        );
        if (receipt.rowCount === 0) {
          return { duplicate: true };
        }
        receiptId = receipt.rows[0].id;
      } else {
        const receipt = await client.query(
          `INSERT INTO delivery_tracking_events
             (delivery_job_id, assignment_id, event_type, provider, provider_event_id, payload)
           VALUES ($1, $2, 'provider_receipt', $3, NULL, $4)
           RETURNING id`,
          [
            deliveryJobId,
            assignment.id,
            provider,
            JSON.stringify({
              vehicle_external_id: adapter.parseVehicleIdentity(rawEvent),
              location: locationPoint,
              status: statusPoint,
            }),
          ]
        );
        receiptId = receipt.rows[0].id;
      }

      let pointId = null;
      if (locationPoint) {
        const inserted = await client.query(
          `INSERT INTO delivery_location_points
             (assignment_id, delivery_job_id, source, latitude, longitude,
              accuracy_meters, speed_mps, heading_degrees, recorded_at,
              validation_state, idempotency_key)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'valid', $10)
           ON CONFLICT (idempotency_key) DO NOTHING
           RETURNING id`,
          [
            assignment.id,
            deliveryJobId,
            provider,
            locationPoint.latitude,
            locationPoint.longitude,
            locationPoint.accuracyMeters,
            locationPoint.speedMps,
            locationPoint.headingDegrees,
            locationPoint.recordedAt,
            providerEventId ? `telematics:${provider}:${providerEventId}` : null,
          ]
        );
        pointId = inserted.rows[0] ? inserted.rows[0].id : null;
      }

      return { duplicate: false, receiptId, pointId };
    }, 'telematics_webhook_ingest');

    if (outcome.duplicate) {
      return res.status(200).json({ success: true, duplicate: true });
    }

    // Advance the provider cursor and freshness marker. A failure here must
    // not fail the webhook: the point and receipt are already persisted.
    try {
      if (providerEventId) {
        await telematicsService.updateCursor(connection.id, providerEventId);
      } else {
        await telematicsService.recordSyncSuccess(connection.id);
      }
    } catch (err) {
      logger.warn('Telematics connection cursor update failed after webhook ingest', {
        provider, connectionId: connection.id, error: err.message,
      });
    }

    logger.info('Telematics webhook ingested', {
      provider,
      connectionId: connection.id,
      deliveryJobId,
      assignmentId: assignment.id,
      receiptId: outcome.receiptId,
      pointId: outcome.pointId,
      providerEventId,
    });

    // Realtime fan-out. The provider_receipt row was written in the
    // transaction above (insertEvent: false); the bus only broadcasts. The
    // idempotency key guards the broadcast path against provider retries
    // that slip past the ON CONFLICT dedupe. A broadcast failure must never
    // fail the webhook (the provider would retry the whole delivery).
    if (locationPoint) {
      try {
        await trackingEventBus.publishTrackingEvent({
          deliveryJobId,
          eventType: 'location_updated',
          payload: {
            latest: {
              latitude: locationPoint.latitude,
              longitude: locationPoint.longitude,
              recordedAt: locationPoint.recordedAt,
            },
            source: provider,
            provider,
            providerEventId,
            accuracyMeters: locationPoint.accuracyMeters ?? null,
          },
          provider,
          providerEventId,
          idempotencyKey: providerEventId ? `telematics:${provider}:${providerEventId}` : null,
          insertEvent: false,
        });
      } catch (err) {
        logger.warn('Telematics tracking broadcast failed', {
          provider, deliveryJobId, error: err.message,
        });
      }
    }

    return res.status(200).json({
      success: true,
      duplicate: false,
      receiptId: outcome.receiptId,
      pointId: outcome.pointId,
      locationRecorded: outcome.pointId !== null,
    });
  } catch (err) {
    const status = Number.isInteger(err.status) ? err.status : 500;
    logger.error('Telematics webhook processing failed', {
      provider, status, error: err.message,
    });
    return res.status(status).json({
      error: status >= 500 ? 'Internal server error' : err.message,
      code: err.code || 'internal_error',
    });
  }
}

module.exports = {
  receiveWebhook,
};
