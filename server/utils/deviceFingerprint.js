'use strict';

// Review P2-6-F12: client-generated device fingerprint for abuse detection
// (referral farming). The client persists a random device id in localStorage
// and sends it as X-Device-Fingerprint on registration requests. The value
// is opaque and carries no PII; it is only used to spot many signups from
// one device. Missing or malformed fingerprints are treated as absent
// (fail open): the first-job value event is the primary anti-farming guard.

function readDeviceFingerprint(req) {
  const raw = String((req.headers && req.headers['x-device-fingerprint']) || '').trim();
  if (!raw) return null;
  const fp = raw.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 128);
  return fp || null;
}

module.exports = { readDeviceFingerprint };
