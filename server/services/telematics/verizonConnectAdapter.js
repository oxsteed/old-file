'use strict';

/**
 * verizonConnectAdapter.js
 *
 * Telematics adapter for Verizon Connect (Reveal / Fleetmatics Integration
 * Manager).
 *
 * Verizon Connect's per-endpoint request/response schemas live behind their
 * credential-gated developer portal, so this adapter parses defensively
 * across the field names their public API surface uses for vehicle position
 * events: `vehicleId`, `latitude` / `longitude`, `speed`, `heading`,
 * `ignitionOn`, `timestamp` / `occurredAtUtc`, and `eventId`, plus common
 * nested variants (`vehicle: { id }`, `position: { ... }`). Unknown shapes
 * return null rather than throwing.
 *
 * Signature: HMAC-SHA256 over the raw request body with a timing-safe
 * comparison (the contract default), accepting an optional `sha256=` prefix.
 */

const {
  ProviderNotConfiguredError,
  verifyWebhookSignature: defaultVerify,
  finiteNumber,
  isoTimestamp,
  firstString,
} = require('./adapterContract');

const providerName = 'verizon_connect';
const MPH_TO_MPS = 0.44704;

function positionOf(rawEvent) {
  if (!rawEvent || typeof rawEvent !== 'object') return {};
  return rawEvent.position && typeof rawEvent.position === 'object' ? rawEvent.position : rawEvent;
}

function parseVehicleIdentity(rawEvent) {
  if (!rawEvent || typeof rawEvent !== 'object') return null;
  const vehicle = rawEvent.vehicle && typeof rawEvent.vehicle === 'object' ? rawEvent.vehicle : {};
  return firstString(
    rawEvent.vehicleId,
    rawEvent.vehicle_id,
    vehicle.id,
    vehicle.vehicleId,
    rawEvent.deviceId
  );
}

function normalizeLocationPayload(rawEvent) {
  if (!rawEvent || typeof rawEvent !== 'object') return null;
  const position = positionOf(rawEvent);
  const vehicleExternalId = parseVehicleIdentity(rawEvent);
  const latitude = finiteNumber(position.latitude ?? position.lat);
  const longitude = finiteNumber(position.longitude ?? position.lon ?? position.lng);
  if (!vehicleExternalId || latitude === null || longitude === null) return null;
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null;

  const speed = finiteNumber(position.speed);
  const heading = finiteNumber(position.heading ?? position.bearing ?? position.direction);
  const ignition = position.ignitionOn ?? position.ignition ?? rawEvent.ignitionOn;

  return {
    vehicleExternalId,
    latitude,
    longitude,
    accuracyMeters: finiteNumber(position.accuracyMeters ?? position.accuracy),
    // Reveal reports speed in mph; convert to the contract's m/s.
    speedMps: speed === null ? null : speed * MPH_TO_MPS,
    headingDegrees: heading === null ? null : ((heading % 360) + 360) % 360,
    recordedAt:
      isoTimestamp(position.timestamp) ||
      isoTimestamp(position.occurredAtUtc) ||
      isoTimestamp(position.occurred_at) ||
      isoTimestamp(rawEvent.timestamp),
    providerEventId: firstString(rawEvent.eventId, rawEvent.event_id, position.eventId),
    ignitionOn: typeof ignition === 'boolean' ? ignition : null,
    odometerMeters: finiteNumber(position.odometerMeters ?? position.odometer),
  };
}

function normalizeStatusPayload(rawEvent) {
  if (!rawEvent || typeof rawEvent !== 'object') return null;
  const position = positionOf(rawEvent);
  const vehicleExternalId = parseVehicleIdentity(rawEvent);
  if (!vehicleExternalId) return null;

  let ignitionOn = null;
  let stopped = null;
  const ignition = position.ignitionOn ?? position.ignition ?? rawEvent.ignitionOn;
  if (typeof ignition === 'boolean') ignitionOn = ignition;
  if (typeof position.stopped === 'boolean') stopped = position.stopped;
  const eventType = String(rawEvent.eventType || rawEvent.event_type || '').toLowerCase();
  if (eventType.includes('ignition_on') || eventType.includes('engine_on')) ignitionOn = true;
  if (eventType.includes('ignition_off') || eventType.includes('engine_off')) ignitionOn = false;
  if (ignitionOn === null && stopped === null) return null;

  return {
    vehicleExternalId,
    ignitionOn,
    stopped,
    providerEventId: firstString(rawEvent.eventId, rawEvent.event_id),
    recordedAt:
      isoTimestamp(position.timestamp) ||
      isoTimestamp(position.occurredAtUtc) ||
      isoTimestamp(rawEvent.timestamp),
  };
}

function verifyWebhookSignature({ rawBody, signature, secret } = {}) {
  return defaultVerify({ rawBody, signature, secret });
}

/**
 * Structured stub: builds the Verizon Connect vehicle positions request.
 * Performs no network I/O and fabricates no data.
 */
async function fetchIncrementalUpdates({ credentialRef, cursor, vehicleExternalId } = {}) {
  if (!credentialRef) {
    throw new ProviderNotConfiguredError(
      providerName,
      'Verizon Connect credential reference is required.'
    );
  }
  const params = {};
  if (cursor) params.since = cursor;
  if (vehicleExternalId) params.vehicleId = vehicleExternalId;
  const request = {
    method: 'GET',
    url: 'https://<reveal-api-host>/api/vehicles/positions',
    headers: { Authorization: 'Bearer <resolved-from-credentialRef>' },
    params,
    notes: 'Resolve credentialRef to Reveal REST + Integration Manager credentials in the secure config store.',
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
