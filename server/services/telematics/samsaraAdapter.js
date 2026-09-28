'use strict';

/**
 * samsaraAdapter.js
 *
 * Telematics adapter for Samsara.
 *
 * Webhook payload (publicly documented at developers.samsara.com, "What are
 * Webhooks?"): the body carries `eventId`, `eventMs`, `eventType`
 * ('Alert' | 'Ping') and an `event` object (e.g. `alertConditionId`,
 * `device: { id, name, serial, vin }`, `orgId`, `startMs`). Event
 * Subscription v2 payloads (`eventType: 'VehicleLocationUpdate'` with
 * `data.vehicle` / `data.gps`) are also parsed defensively.
 *
 * Signature (documented "Webhook Signatures"): headers
 * `X-Samsara-Timestamp` (unix seconds) and `X-Samsara-Signature`
 * (`v1=<hex>`). The hex digest is HMAC-SHA256 over the message
 * `v1:<timestamp>:<body>` using the webhook's secret key, which is
 * Base64-encoded and must be decoded before use. Comparison is timing-safe.
 *
 * Incremental updates use the REST stats endpoint
 * `GET https://api.samsara.com/fleet/vehicles/locations` (documented), which
 * returns `data[]` with `gps: { latitude, longitude, time, headingDegrees,
 * speedMilesPerHour }`. The cursor is echoed back unchanged; Samsara
 * pagination for this endpoint is time/ID based rather than cursor based.
 */

const crypto = require('crypto');
const {
  ProviderNotConfiguredError,
  timingSafeStringEqual,
  finiteNumber,
  isoTimestamp,
  firstString,
} = require('./adapterContract');

const providerName = 'samsara';
const MPH_TO_MPS = 0.44704;

function parseVehicleIdentity(rawEvent) {
  if (!rawEvent || typeof rawEvent !== 'object') return null;
  const event = rawEvent.event || {};
  const data = rawEvent.data || {};
  const vehicle = data.vehicle || {};
  const device = event.device || {};
  return firstString(
    vehicle.id,
    event.vehicleId,
    device.id,
    device.serial,
    device.vin,
    rawEvent.vehicleId
  );
}

function providerEventId(rawEvent) {
  if (!rawEvent || typeof rawEvent !== 'object') return null;
  return firstString(rawEvent.eventId, rawEvent.id, rawEvent.data && rawEvent.data.id);
}

function gpsOf(rawEvent) {
  const data = (rawEvent && rawEvent.data) || {};
  return data.gps || data.location || {};
}

function normalizeLocationPayload(rawEvent) {
  if (!rawEvent || typeof rawEvent !== 'object') return null;
  // v1 Alert webhooks carry no coordinates; only v2 subscription payloads do.
  const gps = gpsOf(rawEvent);
  const vehicleExternalId = parseVehicleIdentity(rawEvent);
  const latitude = finiteNumber(gps.latitude);
  const longitude = finiteNumber(gps.longitude);
  if (!vehicleExternalId || latitude === null || longitude === null) return null;
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null;

  const speedMph = finiteNumber(gps.speedMilesPerHour ?? gps.speed);
  const heading = finiteNumber(gps.headingDegrees ?? gps.heading);
  const data = rawEvent.data || {};

  return {
    vehicleExternalId,
    latitude,
    longitude,
    accuracyMeters: finiteNumber(gps.accuracyMeters),
    speedMps: speedMph === null ? null : speedMph * MPH_TO_MPS,
    headingDegrees: heading === null ? null : ((heading % 360) + 360) % 360,
    recordedAt: isoTimestamp(gps.timeMs ?? gps.time) || isoTimestamp(rawEvent.eventMs),
    providerEventId: providerEventId(rawEvent),
    ignitionOn: typeof data.ignitionOn === 'boolean' ? data.ignitionOn : null,
    odometerMeters: finiteNumber(data.odometerMeters),
  };
}

function normalizeStatusPayload(rawEvent) {
  if (!rawEvent || typeof rawEvent !== 'object') return null;
  const vehicleExternalId = parseVehicleIdentity(rawEvent);
  if (!vehicleExternalId) return null;
  const event = rawEvent.event || {};
  const data = rawEvent.data || {};

  let ignitionOn = null;
  let stopped = null;
  const conditionId = String(event.alertConditionId || '').toLowerCase();
  if (conditionId.includes('engineon') || conditionId.includes('ignitionon')) ignitionOn = true;
  if (conditionId.includes('engineoff') || conditionId.includes('ignitionoff')) ignitionOn = false;
  if (typeof data.ignitionOn === 'boolean') ignitionOn = data.ignitionOn;
  if (typeof data.stopped === 'boolean') stopped = data.stopped;
  if (ignitionOn === null && stopped === null) return null;

  return {
    vehicleExternalId,
    ignitionOn,
    stopped,
    providerEventId: providerEventId(rawEvent),
    recordedAt: isoTimestamp(event.startMs) || isoTimestamp(rawEvent.eventMs),
  };
}

/**
 * Samsara webhook signature verification.
 * Accepts an optional `timestamp` (the X-Samsara-Timestamp header value).
 * Fails closed on any missing/invalid input.
 */
function verifyWebhookSignature({ rawBody, signature, secret, timestamp } = {}) {
  if (!rawBody || !signature || !secret || !timestamp) return false;
  const presented = String(signature).trim().replace(/^v1=/i, '');
  let key;
  try {
    key = Buffer.from(String(secret), 'base64');
    if (!key.length) return false;
  } catch (err) {
    return false;
  }
  const body = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : String(rawBody);
  const message = `v1:${String(timestamp).trim()}:${body}`;
  let expected;
  try {
    expected = crypto.createHmac('sha256', key).update(message, 'utf8').digest('hex');
  } catch (err) {
    return false;
  }
  return timingSafeStringEqual(presented.toLowerCase(), expected.toLowerCase());
}

/**
 * Structured stub: builds the Samsara fleet vehicle locations request.
 * Performs no network I/O and fabricates no data.
 */
async function fetchIncrementalUpdates({ credentialRef, cursor, vehicleExternalId } = {}) {
  if (!credentialRef) {
    throw new ProviderNotConfiguredError(providerName, 'Samsara API token reference is required.');
  }
  const params = { types: 'gps' };
  if (vehicleExternalId) params.vehicleIds = vehicleExternalId;
  const request = {
    method: 'GET',
    url: 'https://api.samsara.com/fleet/vehicles/locations',
    headers: { Authorization: 'Bearer <resolved-from-credentialRef>' },
    params,
    notes: 'Resolve credentialRef to the Samsara API token in the secure config store; never log the token.',
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
