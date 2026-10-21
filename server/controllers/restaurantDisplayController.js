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
const permissionsService = require('../services/permissionsService');
const { assertLocationAccess } = require('../services/restaurantLocationAccessService');
// Imported as module objects (not destructured) so tests can stub the staff
// path at the module boundary.
const authMiddleware = require('../middleware/auth');
const scopeGates = require('../middleware/scopeGates');

// ── Pure helpers (exported for unit tests) ────────────────────────────────

const PAIRING_CODE_TTL_MS = 10 * 60 * 1000;
// F-27: pairing tokens get the same bounded lifetime as app device tokens
// (migration 786): 90 days, rotated on heartbeat once inside the final
// week. The rotated-out token stays valid until its original expiry so a
// display that misses the rotation response never goes dark early.
const PAIRING_TOKEN_TTL_MS = 90 * 24 * 60 * 60 * 1000;
const PAIRING_TOKEN_ROTATION_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
// Unambiguous alphabet: no 0/O, no 1/I, no L.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 6;
// Heartbeats at a 30s cadence stay "online" with headroom for jitter.
const ONLINE_THRESHOLD_MS = 90 * 1000;
const MAX_LABEL_LENGTH = 60;
// Device roles (migration 913). A pairing token only authorizes the surface
// its physical display belongs to: 'kitchen' tokens reach the kitchen ticket
// feed + actions, 'kiosk' and 'queue_board' tokens never do. The default is
// the fail-closed choice for the kitchen surface.
const DISPLAY_DEVICE_ROLES = ['kitchen', 'kiosk', 'queue_board'];
const DEFAULT_DEVICE_ROLE = 'kiosk';

// issuePairingCode is lenient: an invalid or absent display_type falls back
// to the fail-closed default.
function normalizeDeviceRole(raw) {
  const role = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  return DISPLAY_DEVICE_ROLES.includes(role) ? role : DEFAULT_DEVICE_ROLE;
}

// claimDisplay is strict: the owner explicitly approves the role at claim
// time, so an invalid device_role is a 400, not a silent default. An absent
// value keeps the role the TV declared when it issued the code.
function resolveClaimDeviceRole(raw, current) {
  if (raw === undefined || raw === null || String(raw).trim() === '') {
    return current || DEFAULT_DEVICE_ROLE;
  }
  const role = String(raw).trim().toLowerCase();
  if (!DISPLAY_DEVICE_ROLES.includes(role)) {
    throw new AppError('Invalid device role', 400, 'invalid_device_role');
  }
  return role;
}

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

// Pairing tokens are 32 random bytes, hex-encoded (64 hex chars). The shape
// check lets the kitchen middleware tell a display token apart from a staff
// impersonation JWT (which contains dots) before touching the database.
function isDisplayTokenShape(token) {
  return typeof token === 'string' && /^[0-9a-f]{64}$/i.test(token);
}

// Verifies a pairing token against display_pairings (paired rows only).
// F-27: tokens expire. The current token is valid until
// pairing_token_expires_at (NULL = legacy row not yet adopted by a
// heartbeat, still valid); the rotated-out previous token stays valid
// until pairing_token_prev_expires_at. Returns
// { pairingId, restaurantId, locationId, label, deviceRole, tokenExpiresAt,
//   usedPreviousToken } or null. Constant-time compares, exactly like
// heartbeat()'s original inline check.
async function verifyDisplayPairingToken(token) {
  if (!isDisplayTokenShape(token)) return null;
  const tokenHash = hashSecret(token);
  const { rows } = await pool.query(
    `SELECT id, restaurant_id, location_id, label, pairing_token_hash, pairing_token_hash_prev,
            pairing_token_expires_at, pairing_token_prev_expires_at, device_role
       FROM display_pairings
      WHERE (pairing_token_hash = $1 OR pairing_token_hash_prev = $1)
        AND paired_at IS NOT NULL`,
    [tokenHash]
  );
  const row = rows[0];
  if (!row) return null;
  const now = Date.now();
  // The row matched the token's hash in SQL; compare again in constant time
  // so the bearer credential check does not leak via timing.
  if (timingSafeEqualHex(row.pairing_token_hash, tokenHash)) {
    if (row.pairing_token_expires_at && new Date(row.pairing_token_expires_at).getTime() <= now) {
      return null;
    }
    return {
      pairingId: Number(row.id),
      restaurantId: Number(row.restaurant_id),
      ...(row.location_id != null ? { locationId: Number(row.location_id) } : {}),
      label: row.label,
      deviceRole: row.device_role || DEFAULT_DEVICE_ROLE,
      tokenExpiresAt: row.pairing_token_expires_at || null,
      usedPreviousToken: false,
    };
  }
  if (row.pairing_token_hash_prev && timingSafeEqualHex(row.pairing_token_hash_prev, tokenHash)) {
    if (!row.pairing_token_prev_expires_at
      || new Date(row.pairing_token_prev_expires_at).getTime() <= now) {
      return null;
    }
    return {
      pairingId: Number(row.id),
      restaurantId: Number(row.restaurant_id),
      ...(row.location_id != null ? { locationId: Number(row.location_id) } : {}),
      label: row.label,
      deviceRole: row.device_role || DEFAULT_DEVICE_ROLE,
      tokenExpiresAt: row.pairing_token_prev_expires_at,
      usedPreviousToken: true,
    };
  }
  return null;
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

// F-27: fleet management gate. Owners always pass; other members need the
// display.manage capability (granted to the manager role by the permission
// catalog, migration 370), so a store manager can replace a broken kitchen
// TV without the owner.
async function requireDisplayManager(userId, restaurantId, locationId = null) {
  if (!userId) throw new AppError('Sign in required', 401, 'unauthorized');
  if (!restaurantId) throw new AppError('Restaurant not found', 404, 'restaurant_not_found');
  const restaurant = await resolveRestaurantAccess(userId, restaurantId);
  if (locationId != null) {
    const { rows: locations } = await pool.query(
      `SELECT id FROM restaurant_locations
        WHERE id = $1 AND restaurant_id = $2 AND status = 'active'`,
      [locationId, restaurantId]
    );
    if (!locations[0]) throw new AppError('Display store not found', 404, 'display_location_not_found');
  }
  if (restaurant.effective_role === 'owner') return restaurant;
  const { permissions } = await permissionsService.getEffectivePermissions({
    businessId: restaurant.business_id,
    userId,
    role: restaurant.effective_role,
    membershipId: restaurant.effective_membership_id,
  });
  if (!permissionsService.hasAny(permissions, ['display.manage'])) {
    throw new AppError('Display manager access required', 403, 'forbidden');
  }
  if (locationId != null) await assertLocationAccess(restaurant, userId, locationId);
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
  await requireDisplayManager(userId, pairing.restaurant_id, pairing.location_id);
  return pairing;
}

function publicPairingShape(row) {
  return {
    id: Number(row.id),
    restaurant_id: Number(row.restaurant_id),
    ...(row.location_id != null ? { location_id: Number(row.location_id) } : {}),
    restaurant_name: row.restaurant_name || null,
    label: row.label,
    device_role: row.device_role || DEFAULT_DEVICE_ROLE,
    paired_at: row.paired_at,
    last_seen_at: row.last_seen_at,
    token_expires_at: row.pairing_token_expires_at || null,
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
    const requestedLocationId = parsePositiveInt(req.body?.location_id ?? req.body?.locationId);
    const { rows: locationRows } = await pool.query(
      `SELECT id
         FROM restaurant_locations
        WHERE restaurant_id = $1
          AND status = 'active'
          AND ($2::bigint IS NULL OR id = $2)
        ORDER BY is_primary DESC, id ASC
        LIMIT 1`,
      [restaurantId, requestedLocationId]
    );
    const locationId = Number(locationRows[0]?.id || 0);
    if (!locationId) {
      throw new AppError('A valid active store is required for display pairing', 409, 'display_location_required');
    }
    // The TV declares its physical role up front so the pairing record is
    // fail-closed from issuance: an invalid or absent display_type becomes
    // 'kiosk', which can never reach the kitchen ticket surface.
    const deviceRole = normalizeDeviceRole(req.body?.display_type);

    // Codes live in a 31^6 space and the code_hash column is unique, so retry
    // a few times on the (astronomically unlikely) collision.
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const code = generatePairingCode();
      const codeHash = hashSecret(code);
      try {
        const { rows: inserted } = await pool.query(
          `INSERT INTO display_pairings (restaurant_id, location_id, code_hash, expires_at, device_role)
           VALUES ($1, $2, $3, NOW() + make_interval(secs => $4), $5)
           RETURNING id, expires_at`,
          [restaurantId, locationId, codeHash, PAIRING_CODE_TTL_MS / 1000, deviceRole]
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
      `SELECT id, restaurant_id, location_id, code_hash, device_role, paired_at, expires_at
         FROM display_pairings
        WHERE code_hash = $1 AND paired_at IS NULL AND expires_at > NOW()`,
      [codeHash]
    );
    const candidate = candidates[0];
    if (!candidate || !timingSafeEqualHex(candidate.code_hash, codeHash)) {
      throw new AppError('Pairing code not found or expired', 404, 'code_not_found');
    }
    // Access first: claiming a code for a restaurant the caller cannot
    // manage displays for must fail even when the code is valid (fail
    // closed). Owners and display.manage holders may claim (F-27).
    const restaurant = await requireDisplayManager(req.user?.id, candidate.restaurant_id, candidate.location_id);
    // The owner approves the final device role at claim time; an invalid
    // value is a 400, an absent one keeps the role the TV declared.
    const deviceRole = resolveClaimDeviceRole(req.body?.device_role, candidate.device_role);

    const token = crypto.randomBytes(32).toString('hex');
    const { rows: updated } = await pool.query(
      `UPDATE display_pairings
          SET paired_at = NOW(),
              label = $2,
              pairing_token_hash = $3,
              pairing_token_encrypted = $4,
              device_role = $5,
              pairing_token_expires_at = NOW() + make_interval(secs => $6),
              pairing_token_hash_prev = NULL,
              pairing_token_prev_expires_at = NULL
        WHERE id = $1 AND paired_at IS NULL AND expires_at > NOW()
        RETURNING id, restaurant_id, location_id, label, device_role, paired_at, created_at, pairing_token_expires_at`,
      [candidate.id, label, hashSecret(token), encrypt(token), deviceRole, PAIRING_TOKEN_TTL_MS / 1000]
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
// F-27: adopts a 90-day expiry for legacy tokens, and rotates the token
// (returning the replacement exactly once, in this response) when the
// current one enters its final week. The rotated-out token remains valid
// until its original expiry, so a display that drops this response keeps
// working and simply re-pairs when the old token finally lapses.
async function heartbeat(req, res, next) {
  try {
    const pairing = await verifyDisplayPairingToken(bearerToken(req));
    if (!pairing) throw new AppError('Unauthorized', 401, 'display_token_invalid');
    const { rows } = await pool.query(
      `SELECT refresh_requested_at, pairing_token_hash, pairing_token_expires_at
         FROM display_pairings WHERE id = $1 AND paired_at IS NOT NULL`,
      [pairing.pairingId]
    );
    const row = rows[0];
    if (!row) throw new AppError('Unauthorized', 401, 'display_token_invalid');
    const refreshRequested = row.refresh_requested_at != null;

    let rotatedToken = null;
    let tokenExpiresAt = row.pairing_token_expires_at || null;
    const now = Date.now();
    if (!pairing.usedPreviousToken && !tokenExpiresAt) {
      // Legacy token (paired before migration 944): adopt the bounded
      // lifetime starting now; the token itself does not change.
      const { rows: adopted } = await pool.query(
        `UPDATE display_pairings
            SET pairing_token_expires_at = NOW() + make_interval(secs => $2)
          WHERE id = $1 AND paired_at IS NOT NULL AND pairing_token_expires_at IS NULL
          RETURNING pairing_token_expires_at`,
        [pairing.pairingId, PAIRING_TOKEN_TTL_MS / 1000]
      );
      tokenExpiresAt = adopted[0]?.pairing_token_expires_at || tokenExpiresAt;
    } else if (
      !pairing.usedPreviousToken
      && tokenExpiresAt
      && new Date(tokenExpiresAt).getTime() - now <= PAIRING_TOKEN_ROTATION_WINDOW_MS
    ) {
      rotatedToken = crypto.randomBytes(32).toString('hex');
      const { rows: rotated } = await pool.query(
        `UPDATE display_pairings
            SET pairing_token_hash_prev = pairing_token_hash,
                pairing_token_prev_expires_at = pairing_token_expires_at,
                pairing_token_hash = $2,
                pairing_token_expires_at = NOW() + make_interval(secs => $3)
          WHERE id = $1 AND paired_at IS NOT NULL AND pairing_token_hash = $4
          RETURNING pairing_token_expires_at`,
        [pairing.pairingId, hashSecret(rotatedToken), PAIRING_TOKEN_TTL_MS / 1000, row.pairing_token_hash]
      );
      if (rotated[0]) {
        tokenExpiresAt = rotated[0].pairing_token_expires_at;
      } else {
        // A concurrent heartbeat already rotated; keep this response
        // token-less rather than issuing a second replacement.
        rotatedToken = null;
      }
    }

    await pool.query(
      `UPDATE display_pairings
          SET last_seen_at = NOW(),
              refresh_requested_at = NULL
        WHERE id = $1 AND paired_at IS NOT NULL`,
      [pairing.pairingId]
    );
    return res.json({
      refresh_requested: refreshRequested,
      restaurant_id: pairing.restaurantId,
      ...(pairing.locationId != null ? { location_id: pairing.locationId } : {}),
      label: pairing.label,
      token_expires_at: tokenExpiresAt,
      ...(rotatedToken ? { rotated_token: rotatedToken } : {}),
    });
  } catch (err) {
    return next(err);
  }
}

// Staff path for the kitchen routes: the standard session chain. authenticate
// populates req.user from the session cookie (or an impersonation JWT);
// requireRestaurantAccess enforces the restaurant tenancy gate.
function kitchenStaffPath(req, res, next) {
  return authMiddleware.authenticate(req, res, (authErr) => {
    if (authErr) return next(authErr);
    return scopeGates.requireRestaurantAccess()(req, res, next);
  });
}

// Kitchen device-or-staff authorization (Track B, roles from migration 913).
//
// A paired display's token authorizes the kitchen ticket feed + ticket
// actions (ack, order/item actions) for ITS restaurant only, so a fresh
// kitchen tablet needs no staff login. Fail closed everywhere:
//   - display-token-shaped bearer, valid, scoped to :restaurantId, AND with
//     device_role 'kitchen' -> req.displayDevice = { pairingId,
//     restaurantId, label, deviceRole }, then next()
//   - display-token-shaped bearer, invalid / unpaired / wrong restaurant /
//     non-kitchen role (kiosk, queue_board) -> 401 with code
//     'display_token_invalid' (never falls through to staff auth; the client
//     drops the pairing when it sees this code)
//   - no bearer, or a bearer that is not display-token-shaped (staff sessions
//     authenticate by cookie; impersonation uses a JWT bearer) -> the
//     standard staff path (session + restaurant tenancy gate)
//
// The pairing token never authorizes stations, audit, printer jobs, events,
// or any other route: those keep requireRestaurantAccess() and stay
// staff-only. Heartbeat and polling stay role-agnostic (presence only).
async function requireKitchenDeviceOrStaff(req, res, next) {
  try {
    const token = bearerToken(req);
    if (token && isDisplayTokenShape(token)) {
      const pairing = await verifyDisplayPairingToken(token);
      if (!pairing || Number(pairing.restaurantId) !== Number(req.params.restaurantId)) {
        throw new AppError('Unauthorized', 401, 'display_token_invalid');
      }
      if (pairing.deviceRole !== 'kitchen') {
        throw new AppError('Unauthorized', 401, 'display_token_invalid');
      }
      req.displayDevice = {
        pairingId: pairing.pairingId,
        restaurantId: pairing.restaurantId,
        locationId: pairing.locationId || null,
        label: pairing.label,
        deviceRole: pairing.deviceRole,
      };
      return next();
    }
    return kitchenStaffPath(req, res, next);
  } catch (err) {
    return next(err);
  }
}

// GET /api/restaurant/displays  (authenticated owner or display manager)
// Lists pairings for the restaurants the caller can manage displays for,
// with online derived from last_seen_at (< 90s) and last_seen_at surfaced
// per display (F-27).
async function listPairings(req, res, next) {
  try {
    const userId = req.user?.id;
    if (!userId) throw new AppError('Sign in required', 401, 'unauthorized');
    const scope = await resolveScope({ id: userId, role: req.user?.role });
    const manageableIds = [];
    for (const entry of scope.restaurants) {
      if (entry.role === 'owner') {
        manageableIds.push(entry.id);
        continue;
      }
      try {
        await requireDisplayManager(userId, entry.id);
        manageableIds.push(entry.id);
      } catch (_) {
        // No display standing for this restaurant: not part of the fleet view.
      }
    }
    if (manageableIds.length === 0) return res.json({ displays: [] });
    const { rows } = await pool.query(
      `SELECT dp.*, fr.display_name AS restaurant_name
         FROM display_pairings dp
         JOIN food_restaurants fr ON fr.id = dp.restaurant_id
        WHERE dp.restaurant_id = ANY($1)
        ORDER BY dp.created_at DESC`,
      [manageableIds]
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
  verifyDisplayPairingToken,
  requireKitchenDeviceOrStaff,
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
    isDisplayTokenShape,
    normalizeDeviceRole,
    resolveClaimDeviceRole,
    DISPLAY_DEVICE_ROLES,
    DEFAULT_DEVICE_ROLE,
    PAIRING_CODE_TTL_MS,
    PAIRING_TOKEN_TTL_MS,
    PAIRING_TOKEN_ROTATION_WINDOW_MS,
    ONLINE_THRESHOLD_MS,
    CODE_ALPHABET,
    CODE_LENGTH,
  },
};
