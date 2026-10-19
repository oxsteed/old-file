'use strict';

/**
 * Restaurant display pairing (Track B).
 *
 * Wall displays (queue board, kiosk, kitchen screen) are public, no-login
 * pages shown on TVs. A TV must never need a staff login, so pairing works
 * like a Chromecast-style claim flow:
 *   1. TV: POST /api/restaurant/displays/pairing-code { restaurant_id } ->
 *      shows the 6-char code large and polls status.
 *   2. Owner: POST /api/restaurant/displays/claim { code, label } (auth) ->
 *      marks the display paired and receives the pairing token once.
 *   3. TV: POST /api/restaurant/displays/status { code } -> the token is
 *      delivered exactly once, stored in the TV's localStorage.
 *   4. TV: POST /api/restaurant/displays/heartbeat with
 *      Authorization: Bearer <token> -> last_seen_at, refresh flag.
 *
 * Security notes:
 * - Only SHA-256 hashes of codes and tokens are stored for auth; raw values
 *   are never persisted in plaintext and must never be logged. The raw token
 *   is held only in a server-key-encrypted escrow column between claim and
 *   first delivery, then nulled.
 * - Codes are 6 chars from an unambiguous alphabet (no 0/O, no 1/I, no L),
 *   single-use for claiming, 10-minute TTL.
 * - Hash comparisons are constant-time; claim is a conditional UPDATE so a
 *   racing double-claim cannot pair the same code twice.
 * - Code issuance, claim attempts and status polls are strictly rate-limited.
 */

const crypto = require('crypto');
const pool = require('../db');
const AppError = require('../utils/appError');
const logger = require('../utils/logger');
const { encrypt, decrypt } = require('../utils/encryption');
const { resolveScope, resolveRestaurantAccess } = require('../services/scopeModel');

// ── Pure helpers (exported for unit tests) ────────────────────────────────

const PAIRING_CODE_TTL_MS = 10 * 60 * 1000;
// Unambiguous alphabet: no 0/O, no 1/I, no L.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 6;
// Heartbeats at a 30s cadence stay "online" with headroom for jitter.
const ONLINE_THRESHOLD_MS = 90 * 1000;
const MAX_LABEL_LENGTH = 60;

function generatePairingCode(randomBytes = crypto.randomBytes) {
  const alphabet = CODE_ALPHABET;
  const limit = 256 - (256 % alphabet.length);
  let code = '';
  while (code.length < CODE_LENGTH) {
    const bytes = randomBytes(CODE_LENGTH - code.length);
    for (const byte of bytes) {
      if (code.length >= CODE_LENGTH) break;
      if (byte >= limit) continue; // rejection sampling: no modulo bias
      code += alphabet[byte % alphabet.length];
    }
  }
  return code;
}

function hashSecret(secret) {
  return crypto.createHash('sha256').update(String(secret), 'utf8').digest('hex');
}

function timingSafeEqualHex(a, b) {
  const bufA = Buffer.from(String(a || ''), 'hex');
  const bufB = Buffer.from(String(b || ''), 'hex');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

// Accept lowercase / spaces / dashes for human typing; only the unambiguous
// alphabet survives normalization.
function normalizeCode(raw) {
  return String(raw || '')
    .toUpperCase()
    .replace(/[\s-]/g, '');
}

function isValidCodeShape(code) {
  return new RegExp(`^[${CODE_ALPHABET}]{${CODE_LENGTH}}$`).test(code);
}

function normalizeLabel(raw) {
  if (raw === undefined || raw === null) return null;
  const s = String(raw).trim();
  if (!s) return null;
  return s.slice(0, MAX_LABEL_LENGTH);
}

function parsePositiveInt(value) {
  const n = Number.parseInt(value, 10);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function bearerToken(req) {
  const header = req.headers?.authorization || '';
  const match = /^Bearer\s+(\S+)$/i.exec(header);
  return match ? match[1] : null;
}

// Canonical owner gate: the restaurant must belong to the caller's business
// and the caller must be its owner (not just a member/manager).
async function requireRestaurantOwner(userId, restaurantId) {
  if (!userId) throw new AppError('Sign in required', 401, 'unauthorized');
  if (!restaurantId) throw new AppError('Restaurant not found', 404, 'restaurant_not_found');
  const restaurant = await resolveRestaurantAccess(userId, restaurantId);
  if (restaurant.effective_role !== 'owner') {
    throw new AppError('Restaurant owner access required', 403, 'forbidden');
  }
  return restaurant;
}

async function requireOwnedPairing(userId, pairingId) {
  const id = parsePositiveInt(pairingId);
  if (!id) throw new AppError('Display not found', 404, 'display_not_found');
  const { rows } = await pool.query('SELECT * FROM display_pairings WHERE id = $1', [id]);
  const pairing = rows[0];
  if (!pairing) throw new AppError('Display not found', 404, 'display_not_found');
  // resolveRestaurantAccess maps "no standing" to 404 restaurant_not_found, so
  // the pairing's existence never leaks to an outsider.
  await requireRestaurantOwner(userId, pairing.restaurant_id);
  return pairing;
}

function publicPairingShape(row) {
  return {
    id: Number(row.id),
    restaurant_id: Number(row.restaurant_id),
    restaurant_name: row.restaurant_name || null,
    label: row.label,
    paired_at: row.paired_at,
    last_seen_at: row.last_seen_at,
    refresh_requested_at: row.refresh_requested_at,
    online:
      row.last_seen_at != null &&
      Date.now() - new Date(row.last_seen_at).getTime() < ONLINE_THRESHOLD_MS,
    created_at: row.created_at,
  };
}

// ── Endpoints ─────────────────────────────────────────────────────────────

// POST /api/restaurant/displays/pairing-code  (public, strictly rate-limited)
// Body: { restaurant_id }. Returns the plain code once; only its hash is stored.
async function issuePairingCode(req, res, next) {
  try {
    const restaurantId = parsePositiveInt(req.body?.restaurant_id);
    if (!restaurantId) throw new AppError('A valid restaurant id is required', 400, 'invalid_restaurant_id');
    const { rows } = await pool.query('SELECT id FROM food_restaurants WHERE id = $1', [restaurantId]);
    if (!rows[0]) throw new AppError('Restaurant not found', 404, 'restaurant_not_found');

    // Codes live in a 31^6 space and the code_hash column is unique, so retry
    // a few times on the (astronomically unlikely) collision.
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const code = generatePairingCode();
      const codeHash = hashSecret(code);
      try {
        const { rows: inserted } = await pool.query(
          `INSERT INTO display_pairings (restaurant_id, code_hash, expires_at)
           VALUES ($1, $2, NOW() + make_interval(secs => $3))
           RETURNING id, expires_at`,
          [restaurantId, codeHash, PAIRING_CODE_TTL_MS / 1000]
        );
        return res.status(201).json({
          code,
          expires_at: inserted[0].expires_at,
          expires_in_seconds: PAIRING_CODE_TTL_MS / 1000,
        });
      } catch (insertErr) {
        if (insertErr.code !== '23505') throw insertErr; // unique violation: retry
        logger.warn('display pairing code collision, retrying', { restaurantId });
      }
    }
    throw new AppError('Could not issue a pairing code; try again', 503, 'code_issue_failed');
  } catch (err) {
    return next(err);
  }
}

// POST /api/restaurant/displays/claim  (authenticated owner)
// Body: { code, label }. Single-use conditional UPDATE: a racing second claim
// of the same code updates zero rows and gets the same generic 404.
async function claimDisplay(req, res, next) {
  try {
    const code = normalizeCode(req.body?.code);
    if (!isValidCodeShape(code)) throw new AppError('Invalid pairing code', 400, 'invalid_code');
    const label = normalizeLabel(req.body?.label);
    const codeHash = hashSecret(code);

    const { rows: candidates } = await pool.query(
      `SELECT id, restaurant_id, code_hash, paired_at, expires_at
         FROM display_pairings
        WHERE code_hash = $1 AND paired_at IS NULL AND expires_at > NOW()`,
      [codeHash]
    );
    const candidate = candidates[0];
    if (!candidate || !timingSafeEqualHex(candidate.code_hash, codeHash)) {
      throw new AppError('Pairing code not found or expired', 404, 'code_not_found');
    }
    // Ownership first: claiming a code for a restaurant the caller does not
    // own must fail even when the code is valid (fail closed).
    const restaurant = await requireRestaurantOwner(req.user?.id, candidate.restaurant_id);

    const token = crypto.randomBytes(32).toString('hex');
    const { rows: updated } = await pool.query(
      `UPDATE display_pairings
          SET paired_at = NOW(),
              label = $2,
              pairing_token_hash = $3,
              pairing_token_encrypted = $4
        WHERE id = $1 AND paired_at IS NULL AND expires_at > NOW()
        RETURNING id, restaurant_id, label, paired_at, created_at`,
      [candidate.id, label, hashSecret(token), encrypt(token)]
    );
    if (!updated[0]) {
      throw new AppError('Pairing code not found or expired', 404, 'code_not_found');
    }
    return res.status(201).json({
      token,
      display: publicPairingShape({ ...updated[0], restaurant_name: restaurant.display_name || null }),
    });
  } catch (err) {
    return next(err);
  }
}

// POST /api/restaurant/displays/status  (public, strictly rate-limited)
// Body: { code }. The TV polls this after showing the code. Before claim it
// returns { claimed: false }; after claim it delivers the pairing token
// exactly once, then reports { claimed: true } with nothing sensitive.
async function pairingStatus(req, res, next) {
  try {
    const code = normalizeCode(req.body?.code);
    if (!isValidCodeShape(code)) throw new AppError('Invalid pairing code', 400, 'invalid_code');
    const codeHash = hashSecret(code);

    const { rows } = await pool.query(
      `SELECT id, paired_at, expires_at, label, pairing_token_encrypted, token_delivered_at
         FROM display_pairings
        WHERE code_hash = $1`,
      [codeHash]
    );
    const row = rows[0];
    if (!row) {
      // Generic 404 whether the code never existed, expired unclaimed, or
      // belongs to a claimed display: code existence cannot be probed.
      throw new AppError('Pairing code not found or expired', 404, 'code_not_found');
    }
    if (!row.paired_at) {
      if (new Date(row.expires_at).getTime() <= Date.now()) {
        throw new AppError('Pairing code not found or expired', 404, 'code_not_found');
      }
      return res.json({ claimed: false, expires_at: row.expires_at });
    }
    if (row.token_delivered_at || !row.pairing_token_encrypted) {
      // Token already delivered (or delivery already consumed): reveal nothing.
      return res.json({ claimed: true, label: row.label });
    }
    // Decrypt BEFORE consuming the escrow: if decryption fails (e.g. a key
    // rotation between claim and delivery) the escrow stays intact so the TV
    // can retry instead of being stuck paired-but-tokenless forever.
    let token;
    try {
      token = decrypt(row.pairing_token_encrypted);
    } catch (decryptErr) {
      logger.error('display pairing token decrypt failed', { pairingId: row.id });
      throw new AppError('Pairing failed; request a new code', 500, 'delivery_failed');
    }
    // Exactly-once delivery: the conditional UPDATE below nulls the escrow, so
    // a racing second poll gets the "already delivered" branch above and the
    // already-decrypted token is simply not sent again.
    const { rows: delivered } = await pool.query(
      `UPDATE display_pairings
          SET token_delivered_at = NOW(), pairing_token_encrypted = NULL
        WHERE id = $1 AND token_delivered_at IS NULL
        RETURNING id`,
      [row.id]
    );
    if (!delivered[0]) {
      return res.json({ claimed: true, label: row.label });
    }
    return res.json({ claimed: true, label: row.label, token });
  } catch (err) {
    return next(err);
  }
}

// POST /api/restaurant/displays/heartbeat  (pairing-token bearer auth)
// Updates last_seen_at; consumes refresh_requested_at and reports it.
async function heartbeat(req, res, next) {
  try {
    const token = bearerToken(req);
    if (!token || token.length > 256) throw new AppError('Unauthorized', 401, 'unauthorized');
    const { rows } = await pool.query(
      `SELECT id, restaurant_id, label, pairing_token_hash, refresh_requested_at
         FROM display_pairings
        WHERE pairing_token_hash = $1 AND paired_at IS NOT NULL`,
      [hashSecret(token)]
    );
    const row = rows[0];
    // The row matched the token's hash in SQL; compare again in constant time
    // so the bearer credential check does not leak via timing.
    if (!row || !timingSafeEqualHex(row.pairing_token_hash, hashSecret(token))) {
      throw new AppError('Unauthorized', 401, 'unauthorized');
    }
    const refreshRequested = row.refresh_requested_at != null;
    await pool.query(
      `UPDATE display_pairings
          SET last_seen_at = NOW(),
              refresh_requested_at = NULL
        WHERE id = $1`,
      [row.id]
    );
    return res.json({
      refresh_requested: refreshRequested,
      restaurant_id: Number(row.restaurant_id),
      label: row.label,
    });
  } catch (err) {
    return next(err);
  }
}

// GET /api/restaurant/displays  (authenticated owner)
// Lists pairings for the caller's owned restaurants, with online derived from
// last_seen_at (< 90s).
async function listPairings(req, res, next) {
  try {
    const userId = req.user?.id;
    if (!userId) throw new AppError('Sign in required', 401, 'unauthorized');
    const scope = await resolveScope({ id: userId, role: req.user?.role });
    const ownedIds = scope.restaurants.filter((r) => r.role === 'owner').map((r) => r.id);
    if (ownedIds.length === 0) return res.json({ displays: [] });
    const { rows } = await pool.query(
      `SELECT dp.*, fr.display_name AS restaurant_name
         FROM display_pairings dp
         JOIN food_restaurants fr ON fr.id = dp.restaurant_id
        WHERE dp.restaurant_id = ANY($1)
        ORDER BY dp.created_at DESC`,
      [ownedIds]
    );
    return res.json({ displays: rows.map(publicPairingShape) });
  } catch (err) {
    return next(err);
  }
}

// POST /api/restaurant/displays/:id/refresh  (authenticated owner)
// Sets refresh_requested_at; the display's next heartbeat consumes it.
async function requestRefresh(req, res, next) {
  try {
    const pairing = await requireOwnedPairing(req.user?.id, req.params?.id);
    const { rows } = await pool.query(
      `UPDATE display_pairings
          SET refresh_requested_at = NOW()
        WHERE id = $1 AND paired_at IS NOT NULL
        RETURNING id`,
      [pairing.id]
    );
    if (!rows[0]) throw new AppError('Display not found', 404, 'display_not_found');
    return res.json({ ok: true, id: Number(pairing.id) });
  } catch (err) {
    return next(err);
  }
}

// DELETE /api/restaurant/displays/:id  (authenticated owner)
// Unpairs the display (row deleted; its token stops working immediately).
async function unpairDisplay(req, res, next) {
  try {
    const pairing = await requireOwnedPairing(req.user?.id, req.params?.id);
    await pool.query('DELETE FROM display_pairings WHERE id = $1', [pairing.id]);
    return res.json({ ok: true, id: Number(pairing.id) });
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  issuePairingCode,
  claimDisplay,
  pairingStatus,
  heartbeat,
  listPairings,
  requestRefresh,
  unpairDisplay,
  // Pure helpers for unit tests.
  _test: {
    generatePairingCode,
    hashSecret,
    timingSafeEqualHex,
    normalizeCode,
    isValidCodeShape,
    normalizeLabel,
    parsePositiveInt,
    bearerToken,
    PAIRING_CODE_TTL_MS,
    ONLINE_THRESHOLD_MS,
    CODE_ALPHABET,
    CODE_LENGTH,
  },
};
