'use strict';

/**
 * geotabAdapter.js
 *
 * Telematics adapter for Geotab (MyGeotab).
 *
 * Geotab is feed-based: there is no classic signed push webhook. Incremental
 * updates come from the MyGeotab JSON-RPC `GetFeed` method (typeName
 * `DeviceStatusInfo` for live positions, `LogRecord` for raw GPS logs), using
 * the `fromVersion` / `toVersion` cursor pair. The `cursor` stored on
 * `delivery_telematics_connections` is the last seen `toVersion`.
 *
 * Webhook signature: Geotab does not sign feed payloads. When a shared token
 * is configured for an auxiliary push endpoint, this adapter accepts either
 * an exact token match (timing-safe) or falls back to the contract's
 * HMAC-SHA256 default. Feed responses are authenticated by the MyGeotab
 * session credentials, not by signatures.
 *
 * MyGeotab DeviceStatusInfo fields used (publicly documented):
 *   device.id, dateTime, latitude, longitude, speed (km/h), bearing,
 *   isDriving, isDeviceCommunicating, version
 * LogRecord fallback fields: device.id, dateTime, latitude, longitude, speed.
 */

const {
  ProviderNotConfiguredError,
  verifyWebhookSignature: defaultVerify,
  timingSafeStringEqual,
  finiteNumber,
  isoTimestamp,
  firstString,
} = require('./adapterContract');

const providerName = 'geotab';
const KMH_TO_MPS = 1 / 3.6;
const INITIAL_FEED_VERSION = '0000000000000000';

function parseVehicleIdentity(rawEvent) {
  if (!rawEvent || typeof rawEvent !== 'object') return null;
  const device = rawEvent.device || {};
  return firstString(device.id, rawEvent.deviceId, rawEvent.device_id, device.serialNumber);
}

function normalizeLocationPayload(rawEvent) {
  if (!rawEvent || typeof rawEvent !== 'object') return null;
  const vehicleExternalId = parseVehicleIdentity(rawEvent);
  const latitude = finiteNumber(rawEvent.latitude);
  const longitude = finiteNumber(rawEvent.longitude);
  if (!vehicleExternalId || latitude === null || longitude === null) return null;
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null;

  const speedKmh = finiteNumber(rawEvent.speed);
  const bearing = finiteNumber(rawEvent.bearing);
  const ignitionOn = typeof rawEvent.isDriving === 'boolean' ? rawEvent.isDriving : null;

  return {
    vehicleExternalId,
    latitude,
    longitude,
    accuracyMeters: null,
    speedMps: speedKmh === null ? null : speedKmh * KMH_TO_MPS,
    headingDegrees: bearing === null ? null : ((bearing % 360) + 360) % 360,
    recordedAt: isoTimestamp(rawEvent.dateTime) || isoTimestamp(rawEvent.recorded_at),
    providerEventId: firstString(rawEvent.id, rawEvent.version && `${vehicleExternalId}:${rawEvent.version}`),
    ignitionOn,
    odometerMeters: finiteNumber(rawEvent.odometer),
  };
}

function normalizeStatusPayload(rawEvent) {
  if (!rawEvent || typeof rawEvent !== 'object') return null;
  const vehicleExternalId = parseVehicleIdentity(rawEvent);
  if (!vehicleExternalId) return null;

  let ignitionOn = null;
  let stopped = null;
  // StatusData-style ignition events carry a diagnostic code; DeviceStatusInfo
  // carries isDriving, from which stopped can be inferred.
  if (typeof rawEvent.isDriving === 'boolean') {
    stopped = !rawEvent.isDriving;
    ignitionOn = rawEvent.isDriving;
  }
  if (typeof rawEvent.ignitionOn === 'boolean') ignitionOn = rawEvent.ignitionOn;
  const diagnostic = String(rawEvent.diagnostic || rawEvent.diagnosticId || '').toLowerCase();
  if (diagnostic.includes('ignition')) {
    ignitionOn = rawEvent.data === 1 || rawEvent.data === true || rawEvent.value === 1;
  }
  if (ignitionOn === null && stopped === null) return null;

  return {
    vehicleExternalId,
    ignitionOn,
    stopped,
    providerEventId: firstString(rawEvent.id),
    recordedAt: isoTimestamp(rawEvent.dateTime) || isoTimestamp(rawEvent.recorded_at),
  };
}

function verifyWebhookSignature({ rawBody, signature, secret } = {}) {
  // Geotab feeds are not signed. For auxiliary push endpoints protected by a
  // shared token, accept a timing-safe token match first, then the HMAC default.
  if (signature && secret && timingSafeStringEqual(String(signature).trim(), String(secret))) {
    return true;
  }
  return defaultVerify({ rawBody, signature, secret });
}

/**
 * Structured stub: builds the MyGeotab GetFeed JSON-RPC request for
 * DeviceStatusInfo deltas. Performs no network I/O and fabricates no data.
 */
async function fetchIncrementalUpdates({ credentialRef, cursor, vehicleExternalId } = {}) {
  if (!credentialRef) {
    throw new ProviderNotConfiguredError(providerName, 'Geotab credential reference is required.');
  }
  const fromVersion = cursor || INITIAL_FEED_VERSION;
  const params = {
    typeName: 'DeviceStatusInfo',
    fromVersion,
    resultsLimit: 5000,
  };
  if (vehicleExternalId) {
    params.search = { deviceSearch: { id: vehicleExternalId } };
  }
  const request = {
    method: 'POST',
    url: 'https://<mygeotab-server>/apiv1',
    headers: { 'Content-Type': 'application/json' },
    // The real call needs resolved session credentials; only the reference is
    // stored on the connection row. The worker resolves it from secure config.
    body: {
      method: 'GetFeed',
      params: { ...params, credentials: { ref: credentialRef } },
    },
    notes: 'Response carries result.data[] (DeviceStatusInfo) and result.toVersion; persist toVersion as the next cursor.',
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
