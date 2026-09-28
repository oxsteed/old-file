'use strict';

/**
 * adapterContract.js
 *
 * Provider-neutral contract for vehicle telematics adapters.
 *
 * Every telematics adapter (Geotab, Samsara, Motive, Verizon Connect, and any
 * future provider) MUST expose the shape documented below so the tracking
 * workers, webhook receivers, and cursor reconciliation jobs can treat every
 * provider identically.
 *
 * Contract members:
 *
 * - `providerName` (string)
 *   Stable provider key matching the `provider` CHECK constraint on
 *   `delivery_telematics_connections` ('geotab' | 'samsara' | 'motive' |
 *   'verizon_connect').
 *
 * - `verifyWebhookSignature({ rawBody, signature, secret, ...extra }) => boolean`
 *   Verifies that an inbound webhook request really came from the provider.
 *   The default implementation is HMAC-SHA256 over the raw request body with a
 *   timing-safe comparison; adapters override it when the provider uses a
 *   different scheme (e.g. Samsara's `v1:<timestamp>:<body>` message with a
 *   base64-decoded secret). Never throws on bad input: returns false.
 *
 * - `normalizeLocationPayload(rawEvent) => locationPoint | null`
 *   Maps a provider webhook/event payload to the normalized location shape.
 *   Returns null when the payload is unparseable or carries no coordinates
 *   (unknown event types must never crash the receiver).
 *
 * - `normalizeStatusPayload(rawEvent) => statusPoint | null`
 *   Maps a provider ignition/stop event to the normalized status shape, or
 *   null when the payload carries no status signal.
 *
 * - `fetchIncrementalUpdates({ credentialRef, cursor, vehicleExternalId })
 *     => Promise<{ points, nextCursor }>`
 *   Structured stub for provider polling. Builds the exact HTTP request shape
 *   the provider uses (URL, method, headers, params) but performs NO network
 *   I/O and fabricates NO data. Throws `ProviderNotConfiguredError`
 *   (code 'PROVIDER_NOT_CONFIGURED') when `credentialRef` is missing.
 *
 * - `parseVehicleIdentity(rawEvent) => string | null`
 *   Extracts the provider-side vehicle identifier used to match the event to
 *   an OxSteed vehicle record. Returns null when it cannot be determined.
 *
 * Normalized location point:
 *   {
 *     vehicleExternalId,  // string
 *     latitude,           // number, -90..90
 *     longitude,          // number, -180..180
 *     accuracyMeters,     // number | null
 *     speedMps,           // number | null (meters per second)
 *     headingDegrees,     // number | null (0..360)
 *     recordedAt,         // ISO-8601 string
 *     providerEventId,    // string | null (idempotency key source)
 *     ignitionOn,         // boolean | null
 *     odometerMeters,     // number | null
 *   }
 *
 * Normalized status point:
 *   {
 *     vehicleExternalId,  // string
 *     ignitionOn,         // boolean | null
 *     stopped,            // boolean | null
 *     providerEventId,    // string | null
 *     recordedAt,         // ISO-8601 string
 *   }
 *
 * Security: adapters receive only *references* to credentials and webhook
 * secrets (e.g. `credentialRef`). Raw secrets are resolved from the secure
 * configuration store by the calling worker and are never logged or persisted
 * by this layer.
 */

const crypto = require('crypto');

class ProviderNotConfiguredError extends Error {
  constructor(providerName, detail) {
    super(
      `Telematics provider '${providerName}' is not configured` +
      (detail ? `: ${detail}` : '') +
      '. Set a credential reference before polling.'
    );
    this.name = 'ProviderNotConfiguredError';
    this.code = 'PROVIDER_NOT_CONFIGURED';
    this.providerName = providerName;
  }
}

const REQUIRED_METHODS = [
  'verifyWebhookSignature',
  'normalizeLocationPayload',
  'normalizeStatusPayload',
  'fetchIncrementalUpdates',
  'parseVehicleIdentity',
];

/**
 * Default webhook signature verification: HMAC-SHA256 over the raw body.
 * Accepts signatures with or without common prefixes ('sha256=', 'v1=').
 * Fails closed: any missing/invalid input returns false, never throws.
 */
function verifyWebhookSignature({ rawBody, signature, secret } = {}) {
  if (!rawBody || !signature || !secret) return false;
  const body = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody), 'utf8');
  const presented = String(signature).trim().replace(/^(sha256=|v1=)/i, '');
  let expected;
  try {
    expected = crypto.createHmac('sha256', String(secret)).update(body).digest('hex');
  } catch (err) {
    return false;
  }
  const a = Buffer.from(presented, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/**
 * Timing-safe string equality used by adapters that verify tokens.
 */
function timingSafeStringEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const ba = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

/**
 * Parses a value into a finite number, or null when it is not a usable number.
 */
function finiteNumber(value) {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

/**
 * Parses a value into an ISO-8601 UTC string, or null when invalid.
 * Accepts ISO strings, epoch seconds, and epoch milliseconds.
 */
function isoTimestamp(value) {
  if (value === null || value === undefined || value === '') return null;
  let date;
  if (typeof value === 'number' && Number.isFinite(value)) {
    date = new Date(value > 1e12 ? value : value * 1000);
  } else {
    date = new Date(String(value));
  }
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function firstString(...candidates) {
  for (const candidate of candidates) {
    if (candidate === null || candidate === undefined) continue;
    const text = String(candidate).trim();
    if (text) return text;
  }
  return null;
}

/**
 * Asserts that an adapter object implements the full contract.
 * Throws a descriptive Error listing anything missing. Returns true otherwise.
 */
function validateAdapter(adapter) {
  if (!adapter || typeof adapter !== 'object') {
    throw new Error('Telematics adapter must be an object.');
  }
  const problems = [];
  if (typeof adapter.providerName !== 'string' || !adapter.providerName.trim()) {
    problems.push('providerName must be a non-empty string');
  }
  for (const method of REQUIRED_METHODS) {
    if (typeof adapter[method] !== 'function') {
      problems.push(`${method} must be a function`);
    }
  }
  if (problems.length > 0) {
    throw new Error(
      `Invalid telematics adapter '${adapter.providerName || 'unknown'}': ${problems.join('; ')}.`
    );
  }
  return true;
}

module.exports = {
  ProviderNotConfiguredError,
  REQUIRED_METHODS,
  verifyWebhookSignature,
  timingSafeStringEqual,
  finiteNumber,
  isoTimestamp,
  firstString,
  validateAdapter,
};
