'use strict';

const crypto = require('node:crypto');

// Shared key -> response store for idempotent mutations.
//
// The table was created for access requests (migration
// 20261116131500_progressive_access.sql), but its shape is generic: one row
// per (actor, key) holding the action, a sha256 fingerprint of the request,
// the status code, and the response body, so a replayed key returns the
// original result without re-running the work. Callers namespace the key
// per action + target (e.g. `planned-need-fund:<needId>:<uuid>`) so one
// actor's key in one flow can never replay another flow's response, and
// the fingerprint rejects the same key reused for a different payload
// (422 `idempotency_key_reused`).
//
// A dedicated per-domain table would be the cleaner long-term home for a
// new flow; this reuse exists so flows can be idempotent without a schema
// change. The table has no retention sweep; rows are small (one per keyed
// request) and keyed by actor, so growth is bounded by keyed requests.

function fingerprintFor(action, target, payload) {
  return crypto.createHash('sha256')
    .update(JSON.stringify([action, target, payload ?? null]))
    .digest('hex');
}

// Returns null (no prior request), { status, body } (replay the stored
// response), or { mismatch: true } (key reused for a different payload).
async function lookupIdempotency(client, { actorId, key, action, target, payload }) {
  if (!key) return null;
  const fingerprint = fingerprintFor(action, target, payload);
  const { rows } = await client.query(
    'SELECT fingerprint, status_code, response FROM access_idempotency_keys WHERE actor_id = $1 AND idem_key = $2',
    [actorId, key],
  );
  if (!rows.length) return null;
  if (rows[0].fingerprint !== fingerprint) return { mismatch: true };
  return { status: rows[0].status_code, body: rows[0].response, fingerprint };
}

// Returns true when the row was stored, false when a concurrent request
// already stored this key (caller re-runs lookupIdempotency for the replay).
async function storeIdempotency(client, { actorId, key, action, fingerprint, status, body }) {
  if (!key) return true;
  try {
    await client.query(
      `INSERT INTO access_idempotency_keys (actor_id, idem_key, action, fingerprint, status_code, response)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [actorId, key, action, fingerprint, status, JSON.stringify(body)],
    );
    return true;
  } catch (err) {
    if (err && err.code === '23505') return false;
    throw err;
  }
}

module.exports = { fingerprintFor, lookupIdempotency, storeIdempotency };
