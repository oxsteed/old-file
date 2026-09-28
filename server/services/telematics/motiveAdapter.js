'use strict';

/**
 * motiveAdapter.js
 *
 * Telematics adapter for Motive (formerly KeepTruckin).
 *
 * Webhook v2 payload (publicly documented at
 * developer-docs.gomotive.com, "Webhooks v2"): location events arrive as
 *   {
 *     "action": "vehicle_location_updated",
 *     "trigger": "updated",
 *     "id": "5d3d5cf6-501f-4566-ad07-a80c05c743a7",
 *     "vehicle_id": 123,
 *     "vehicle_number": "sample",
 *     "located_at": "2017-01-01T12:00:00Z",
 *     "lat": 34.123,
 *     "lon": -84.123,
 *     "bearing": 90.0,
 *     "engine_hours": 123.56,
 *     "speed": 123.5
 *   }
 *
 * Signature: Motive lets you configure a shared secret per webhook. This
 * adapter verifies the default contract scheme, HMAC-SHA256 over the raw
 * body, with a timing-safe comparison (accepting an optional `sha256=`
 * prefix), which matches the `X-Motive-Signature` convention.
 *
 * Note on units: Motive's webhook docs do not state the unit of `speed`.
 * It is treated as miles per hour (US fleet convention) when converting to
 * the contract's meters-per-second. Revisit if Motive documents otherwise.
 */

const {
  ProviderNotConfiguredError,
  verifyWebhookSignature: defaultVerify,
  finiteNumber,
  isoTimestamp,
  firstString,
} = require('./adapterContract');

const providerName = 'motive';
const MPH_TO_MPS = 0.44704;

function parseVehicleIdentity(rawEvent) {
  if (!rawEvent || typeof rawEvent !== 'object') return null;
  return firstString(
    rawEvent.vehicle_id,
    rawEvent.vehicleId,
    rawEvent.vehicle_number,
    rawEvent.vehicleNumber
  );
}

function normalizeLocationPayload(rawEvent) {
  if (!rawEvent || typeof rawEvent !== 'object') return null;
  const vehicleExternalId = parseVehicleIdentity(rawEvent);
  const latitude = finiteNumber(rawEvent.lat ?? rawEvent.latitude);
  const longitude = finiteNumber(rawEvent.lon ?? rawEvent.lng ?? rawEvent.longitude);
  if (!vehicleExternalId || latitude === null || longitude === null) return null;
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null;

  const speed = finiteNumber(rawEvent.speed);
  const bearing = finiteNumber(rawEvent.bearing ?? rawEvent.heading);

  return {
    vehicleExternalId,
    latitude,
    longitude,
    accuracyMeters: finiteNumber(rawEvent.accuracy_meters ?? rawEvent.accuracyMeters),
    speedMps: speed === null ? null : speed * MPH_TO_MPS,
    headingDegrees: bearing === null ? null : ((bearing % 360) + 360) % 360,
    recordedAt: isoTimestamp(rawEvent.located_at ?? rawEvent.locatedAt),
    providerEventId: firstString(rawEvent.id, rawEvent.event_id),
    ignitionOn: typeof rawEvent.ignition_on === 'boolean' ? rawEvent.ignition_on : null,
    odometerMeters: finiteNumber(rawEvent.odometer_meters ?? rawEvent.odometerMeters),
  };
}

function normalizeStatusPayload(rawEvent) {
  if (!rawEvent || typeof rawEvent !== 'object') return null;
  const vehicleExternalId = parseVehicleIdentity(rawEvent);
  if (!vehicleExternalId) return null;

  let ignitionOn = null;
  let stopped = null;
  const action = String(rawEvent.action || '').toLowerCase();
  if (action.includes('ignition_on') || action.includes('engine_on')) ignitionOn = true;
  if (action.includes('ignition_off') || action.includes('engine_off')) ignitionOn = false;
  if (typeof rawEvent.ignition_on === 'boolean') ignitionOn = rawEvent.ignition_on;
  if (typeof rawEvent.stopped === 'boolean') stopped = rawEvent.stopped;
  if (action === 'vehicle_location_updated' && ignitionOn === null && stopped === null) {
    // Pure location pings carry no status signal.
    return null;
  }
  if (ignitionOn === null && stopped === null) return null;

  return {
    vehicleExternalId,
    ignitionOn,
    stopped,
    providerEventId: firstString(rawEvent.id, rawEvent.event_id),
    recordedAt: isoTimestamp(rawEvent.located_at ?? rawEvent.locatedAt),
  };
}

function verifyWebhookSignature({ rawBody, signature, secret } = {}) {
  return defaultVerify({ rawBody, signature, secret });
}

/**
 * Structured stub: builds the Motive vehicle-locations request.
 * Performs no network I/O and fabricates no data.
 */
async function fetchIncrementalUpdates({ credentialRef, cursor, vehicleExternalId } = {}) {
  if (!credentialRef) {
    throw new ProviderNotConfiguredError(providerName, 'Motive API key reference is required.');
  }
  const params = {};
  if (cursor) params.start_time = cursor;
  if (vehicleExternalId) params.vehicle_id = vehicleExternalId;
  const request = {
    method: 'GET',
    url: 'https://api.gomotive.com/v1/vehicle_locations',
    headers: { 'x-api-key': '<resolved-from-credentialRef>' },
    params,
    notes: 'Resolve credentialRef to the Motive API key in the secure config store; cursor is an ISO-8601 start_time.',
  };
  return { points: [], nextCursor: cursor || null, request, executed: false };
}

module.exports = {
  providerName,
  verifyWebhookSignature,
  normalizeLocationPayload,
  normalizeStatusPayload,
  fetchIncrementalUpdates,
  parseVehicleIdentity,
};
