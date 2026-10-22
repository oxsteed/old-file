'use strict';

// Staff-management review S-06 / S-07: shared-device staff identity and
// manager-PIN approvals for the restaurant POS.
//
// Before this service, restaurant_staff_pins existed but validateStaffPin
// only answered { valid } — no session was issued, so every action on a
// shared counter tablet was attributed to whichever account had logged in.
// PINs were also not unique per store (the first bcrypt match won, and
// label-only PINs duplicated freely), had no lockout, and were never
// checked against current membership.
//
// Model:
//   - A PIN value is unique per restaurant, enforced by an HMAC digest
//     column (migration 948) because salted bcrypt hashes cannot be
//     unique-indexed. bcrypt remains the verifier of record.
//   - Validating a PIN records the attempt, enforces per-device and
//     per-PIN lockout, verifies the PIN owner is still a member (S-11),
//     and issues a short-lived staff sub-session scoped to the device and
//     restaurant. The session token travels in the X-Staff-Session header;
//     POS writes stamp acting_staff_user_id from it.
//   - Manager approvals (S-07) reuse the same PIN validation: a manager
//     types their PIN on the cashier's device, and the approval is written
//     to restaurant_pos_approvals linked to the resulting payment, drawer
//     event, or void.

const crypto = require('crypto');
const bcrypt = require('bcrypt');
const pool = require('../db');
const { AppError } = require('../middleware/errorHandler');
const { resolveRestaurantAccess } = require('./scopeModel');
const { getEffectivePermissions, hasRestaurantPermission } = require('./permissionsService');

const PIN_LOCKOUT_WINDOW_MINUTES = 15;
const PIN_LOCKOUT_MAX_FAILURES = 5;
const DEFAULT_SESSION_IDLE_MINUTES = 10;
const DEFAULT_SESSION_MAX_HOURS = 12;
const SESSION_ACTIVITY_SLIDE_SECONDS = 30;

const POS_VOID_REASON_CODES = new Set([
  'customer_request',
  'wrong_order',
  'kitchen_error',
  'duplicate_entry',
  'customer_left',
  'quality_issue',
  'other',
]);

const POS_COMP_REASON_CODES = new Set([
  'service_recovery',
  'quality_issue',
  'promotion',
  'staff_meal',
  'owner_comp',
  'other',
]);

// Default approval policy: a non-manager needs a manager-PIN approval for
// no-sale drawer opens, voids and refunds at any amount, and for payouts,
// cash-outs and comps above a threshold. Restaurants can override per
// action in settings.posApprovalPolicy:
//   { payout: { thresholdCents: 5000 }, comp: { thresholdCents: null } }
// A thresholdCents of null disables approval for that action; "always"
// forces approval regardless of amount. Unknown actions (no default entry
// and no restaurant override) fail CLOSED to { always: true }: a money
// action wired through consumeManagerApproval with an unconfigured name
// must never silently skip manager approval.
const DEFAULT_POS_APPROVAL_POLICY = {
  payout: { thresholdCents: 10000 },
  cash_out: { thresholdCents: 10000 },
  no_sale: { always: true },
  void: { always: true },
  refund: { always: true },
  discount: { always: true },
  comp: { thresholdCents: 2500 },
};

function normalizeString(value, maxLength = 255) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  if (!text) return null;
  return text.length > maxLength ? text.slice(0, maxLength) : text;
}

function safeJson(value, fallback = {}) {
  if (!value) return fallback;
  if (typeof value === 'object') return value;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function staffPinDigest(restaurantId, pin) {
  const secret = process.env.STAFF_PIN_DIGEST_SECRET
    || process.env.JWT_SECRET
    || 'oxsteed-staff-pin-digest-dev';
  return crypto
    .createHmac('sha256', String(secret))
    .update(`${Number(restaurantId)}:${String(pin)}`)
    .digest('hex');
}

function sessionTokenHash(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

async function recordPinAttempt({ restaurantId, deviceId = null, staffPinId = null, success }) {
  await pool.query(
    `INSERT INTO restaurant_staff_pin_attempts (restaurant_id, device_id, staff_pin_id, success)
     VALUES ($1,$2,$3,$4)`,
    [restaurantId, deviceId, staffPinId, Boolean(success)]
  );
}

// Failures inside the trailing window, ignoring any failure that predates
// the most recent success for the same scope (a good unlock resets the
// counter, a lockout lets the window drain on its own).
async function recentPinFailures({ restaurantId, deviceId = null, staffPinId = null }) {
  const scopeColumn = staffPinId ? 'staff_pin_id' : 'device_id';
  const scopeValue = staffPinId || deviceId;
  if (!scopeValue) return 0;
  const { rows: [row] } = await pool.query(
    `SELECT COUNT(*)::int AS failures
       FROM restaurant_staff_pin_attempts
      WHERE restaurant_id = $1
        AND ${scopeColumn} = $2
        AND success = FALSE
        AND created_at > NOW() - ($3 || ' minutes')::interval
        AND created_at > COALESCE((
          SELECT MAX(created_at) FROM restaurant_staff_pin_attempts
           WHERE restaurant_id = $1 AND ${scopeColumn} = $2 AND success = TRUE
        ), 'epoch'::timestamptz)`,
    [restaurantId, scopeValue, String(PIN_LOCKOUT_WINDOW_MINUTES)]
  );
  return Number(row?.failures || 0);
}

async function assertPinNotLocked({ restaurantId, deviceId = null, staffPinId = null }) {
  if (deviceId) {
    const deviceFailures = await recentPinFailures({ restaurantId, deviceId });
    if (deviceFailures >= PIN_LOCKOUT_MAX_FAILURES) {
      throw new AppError(
        'Too many failed PIN attempts on this device. PIN entry is locked for a few minutes.',
        429,
        'pin_locked',
        { scope: 'device', retryAfterMinutes: PIN_LOCKOUT_WINDOW_MINUTES }
      );
    }
  }
  if (staffPinId) {
    const pinFailures = await recentPinFailures({ restaurantId, staffPinId });
    if (pinFailures >= PIN_LOCKOUT_MAX_FAILURES) {
      throw new AppError(
        'Too many failed attempts for this PIN. It is locked for a few minutes.',
        429,
        'pin_locked',
        { scope: 'pin', retryAfterMinutes: PIN_LOCKOUT_WINDOW_MINUTES }
      );
    }
  }
}

// Validates a PIN for a restaurant with lockout + membership enforcement.
// Returns the pin row and the owner's access snapshot. Throws AppError
// (401 invalid_pin, 403 staff_not_member, 429 pin_locked).
async function validateStaffPinForRestaurant({ restaurantId, pin, deviceId = null }) {
  await assertPinNotLocked({ restaurantId, deviceId });
  const digest = staffPinDigest(restaurantId, pin);
  let pinRow = null;
  const { rows: [digestRow] } = await pool.query(
    `SELECT * FROM restaurant_staff_pins
      WHERE restaurant_id = $1 AND pin_digest = $2 AND is_active = TRUE`,
    [restaurantId, digest]
  );
  if (digestRow) {
    await assertPinNotLocked({ restaurantId, deviceId, staffPinId: digestRow.id });
    if (await bcrypt.compare(pin, digestRow.pin_hash)) {
      pinRow = digestRow;
    }
  }
  if (!pinRow) {
    // Legacy rows predate the digest column; fall back to a bcrypt scan
    // over just those rows and backfill the digest on a match so the
    // store converges on digest lookups (and uniqueness).
    const { rows: legacyRows } = await pool.query(
      `SELECT * FROM restaurant_staff_pins
        WHERE restaurant_id = $1 AND is_active = TRUE AND pin_digest IS NULL
        ORDER BY updated_at DESC`,
      [restaurantId]
    );
    for (const row of legacyRows) {
      if (await bcrypt.compare(pin, row.pin_hash)) {
        pinRow = row;
        await assertPinNotLocked({ restaurantId, deviceId, staffPinId: row.id });
        try {
          await pool.query(
            'UPDATE restaurant_staff_pins SET pin_digest = $1 WHERE id = $2 AND pin_digest IS NULL',
            [digest, row.id]
          );
        } catch (err) {
          // 23505: another active row already owns this digest; uniqueness
          // wins and the legacy duplicate simply stays un-backfilled.
          if (err.code !== '23505') throw err;
        }
        break;
      }
    }
  }
  if (!pinRow) {
    await recordPinAttempt({ restaurantId, deviceId, staffPinId: digestRow?.id || null, success: false });
    throw new AppError('Invalid staff PIN', 401, 'invalid_pin');
  }
  let staffAccess = null;
  if (pinRow.staff_user_id) {
    // S-11: a PIN whose owner was removed from the business must stop
    // working immediately, not at the next login.
    try {
      staffAccess = await resolveRestaurantAccess(pinRow.staff_user_id, restaurantId);
    } catch (err) {
      await recordPinAttempt({ restaurantId, deviceId, staffPinId: pinRow.id, success: false });
      // S-11: retire the PIN when membership is CONFIRMED gone (the owner
      // is neither the business owner nor an active member). A resolution
      // error alone does not retire it: the refusal above already fails
      // closed for this attempt, and a transient error must not destroy
      // a valid PIN.
      try {
        const { rows: [restaurantRow] } = await pool.query(
          'SELECT business_id FROM food_restaurants WHERE id = $1',
          [restaurantId]
        );
        if (restaurantRow) {
          const { rows: memberRows } = await pool.query(
            `SELECT 1 FROM businesses b
              WHERE b.id = $1 AND b.user_id = $2
             UNION ALL
             SELECT 1 FROM business_members bm
              WHERE bm.business_id = $1 AND bm.member_id = $2 AND bm.status = 'active'
             LIMIT 1`,
            [restaurantRow.business_id, pinRow.staff_user_id]
          );
          if (!memberRows.length) {
            await pool.query(
              'UPDATE restaurant_staff_pins SET is_active = FALSE, updated_at = NOW() WHERE id = $1',
              [pinRow.id]
            );
          }
        }
      } catch (retireErr) {
        // Retirement is best-effort; the refusal stands either way.
      }
      throw new AppError('This staff PIN no longer belongs to an active team member', 403, 'staff_not_member');
    }
  }
  await recordPinAttempt({ restaurantId, deviceId, staffPinId: pinRow.id, success: true });
  return {
    pinRow,
    staff: {
      pinId: pinRow.id,
      userId: pinRow.staff_user_id || null,
      label: pinRow.staff_label || null,
      roleLabel: pinRow.role_label || null,
      effectiveRole: staffAccess?.effective_role || null,
      businessId: staffAccess?.business_id || null,
      membershipId: staffAccess?.effective_membership_id || null,
    },
  };
}

function sessionPolicyFromSettings(settings) {
  const source = safeJson(settings, {});
  const idleRaw = Number(source.staffSessionIdleMinutes);
  const idleMinutes = Number.isFinite(idleRaw) && idleRaw >= 1 && idleRaw <= 240
    ? Math.floor(idleRaw)
    : DEFAULT_SESSION_IDLE_MINUTES;
  const maxRaw = Number(source.staffSessionMaxHours);
  const maxHours = Number.isFinite(maxRaw) && maxRaw >= 1 && maxRaw <= 24
    ? Math.floor(maxRaw)
    : DEFAULT_SESSION_MAX_HOURS;
  return { idleMinutes, maxHours };
}

async function createStaffSession({ restaurantId, deviceId = null, pinRow, createdByUserId = null, settings = null }) {
  const { idleMinutes, maxHours } = sessionPolicyFromSettings(settings);
  const token = crypto.randomBytes(32).toString('base64url');
  const { rows: [session] } = await pool.query(
    `INSERT INTO restaurant_staff_sessions
       (restaurant_id, device_id, staff_pin_id, staff_user_id, token_hash, created_by, expires_at, metadata)
     VALUES ($1,$2,$3,$4,$5,$6, NOW() + ($7 || ' minutes')::interval, $8::jsonb)
     RETURNING *`,
    [
      restaurantId,
      deviceId,
      pinRow.id,
      pinRow.staff_user_id || null,
      sessionTokenHash(token),
      createdByUserId,
      String(idleMinutes),
      JSON.stringify({
        idleMinutes,
        maxHours,
        staffLabel: pinRow.staff_label || null,
        roleLabel: pinRow.role_label || null,
      }),
    ]
  );
  return { token, session, idleMinutes, maxHours };
}

function staffSessionTokenFromRequest(req) {
  return normalizeString(
    req.get?.('X-Staff-Session')
      || req.get?.('X-Staff-Session-Token')
      || req.body?.staffSessionToken
      || req.body?.staff_session_token,
    200
  );
}

// Resolves the request's staff sub-session, if any. Returns null without
// touching the database when the request carries no session token, so
// ordinary account-authenticated POS traffic is unaffected. Activity
// slides the idle expiry (throttled); passing the absolute cap or the
// idle deadline ends the session lazily with end_reason 'idle_timeout'.
//
// Auth-audit item 18: the session row records device_id at creation (the
// paired POS appliance's id via req.restaurantDevice, or a body-supplied
// id), so a session token issued on one POS device cannot be replayed from
// another device in the same restaurant. Sessions issued on the
// deviceId-less account-auth PIN path store device_id NULL and resolve as
// before (NULL device_id is a wildcard), so that path keeps working.
async function resolveStaffSession(req, restaurantId) {
  const token = staffSessionTokenFromRequest(req);
  if (!token) return null;
  const requestDeviceId = req.restaurantDevice?.id ?? null;
  const { rows: [session] } = await pool.query(
    `SELECT * FROM restaurant_staff_sessions
      WHERE token_hash = $1 AND restaurant_id = $2
        AND (device_id IS NULL OR device_id = $3)`,
    [sessionTokenHash(token), restaurantId, requestDeviceId]
  );
  if (!session || session.ended_at) return null;
  const now = Date.now();
  if (new Date(session.expires_at).getTime() <= now) {
    await pool.query(
      `UPDATE restaurant_staff_sessions
          SET ended_at = NOW(), end_reason = 'idle_timeout'
        WHERE id = $1 AND ended_at IS NULL`,
      [session.id]
    );
    return null;
  }
  const metadata = safeJson(session.metadata, {});
  const idleMinutes = Number(metadata.idleMinutes) || DEFAULT_SESSION_IDLE_MINUTES;
  const maxHours = Number(metadata.maxHours) || DEFAULT_SESSION_MAX_HOURS;
  const lastActivityMs = new Date(session.last_activity_at).getTime();
  if (now - lastActivityMs > SESSION_ACTIVITY_SLIDE_SECONDS * 1000) {
    const absoluteCap = new Date(session.created_at).getTime() + maxHours * 3600 * 1000;
    const nextExpiry = new Date(Math.min(now + idleMinutes * 60 * 1000, absoluteCap));
    const { rows: [slid] } = await pool.query(
      `UPDATE restaurant_staff_sessions
          SET last_activity_at = NOW(), expires_at = $2
        WHERE id = $1 AND ended_at IS NULL
        RETURNING *`,
      [session.id, nextExpiry.toISOString()]
    );
    if (slid) return slid;
    return null;
  }
  return session;
}

async function endStaffSession(token, reason = 'manual_lock') {
  if (!token) return null;
  const { rows: [session] } = await pool.query(
    `UPDATE restaurant_staff_sessions
        SET ended_at = NOW(), end_reason = $2
      WHERE token_hash = $1 AND ended_at IS NULL
      RETURNING *`,
    [sessionTokenHash(token), normalizeString(reason, 40) || 'manual_lock']
  );
  return session || null;
}

// The acting staff identity for stamping POS writes. Null when the
// request carries no (valid) staff session: the account user remains the
// actor of record in created_by, exactly as before S-06.
async function resolveActingStaff(req, restaurantId) {
  const session = await resolveStaffSession(req, restaurantId);
  if (!session) return null;
  return {
    sessionId: session.id,
    staffPinId: session.staff_pin_id,
    staffUserId: session.staff_user_id || null,
    deviceId: session.device_id || null,
  };
}

async function hasPosManage(restaurant, userId) {
  if (!userId) return false;
  return hasRestaurantPermission(restaurant, userId, ['pos.manage']);
}

function approvalRequirement(restaurant, action, amountCents) {
  const settings = safeJson(restaurant?.settings, {});
  const overrides = safeJson(settings.posApprovalPolicy, {});
  const actionConfigured =
    Object.prototype.hasOwnProperty.call(DEFAULT_POS_APPROVAL_POLICY, action) ||
    Object.prototype.hasOwnProperty.call(overrides, action);
  // Audit fix (finding 19): unknown actions fail closed. Without this, an
  // action with no configured policy yielded {} and returned
  // { required: false }, so any future money action wired through
  // consumeManagerApproval with an unconfigured name silently skipped
  // manager approval.
  const merged = {
    ...(actionConfigured ? {} : { always: true }),
    ...(DEFAULT_POS_APPROVAL_POLICY[action] || {}),
    ...(overrides[action] || {}),
  };
  if (merged.disabled === true) return { required: false, thresholdCents: null, always: false };
  if (merged.always === true) return { required: true, thresholdCents: null, always: true };
  const threshold = merged.thresholdCents;
  if (threshold === null || threshold === undefined) {
    return { required: false, thresholdCents: null, always: false };
  }
  const thresholdCents = Math.max(0, Math.floor(Number(threshold) || 0));
  return {
    required: Number(amountCents || 0) > thresholdCents,
    thresholdCents,
    always: false,
  };
}

// Verifies a manager PIN for an approval. The approver must be an
// identified staff member (label-only PINs cannot approve money movement)
// whose current role is owner/manager or who holds pos.manage.
async function verifyManagerPinApproval({ restaurantId, pin, deviceId = null }) {
  const { pinRow, staff } = await validateStaffPinForRestaurant({ restaurantId, pin, deviceId });
  if (!pinRow.staff_user_id) {
    throw new AppError('A manager approval must use a PIN assigned to a team member', 403, 'manager_approval_invalid');
  }
  let manager = false;
  if (staff.businessId) {
    const permissionResult = await getEffectivePermissions({
      businessId: staff.businessId,
      userId: pinRow.staff_user_id,
      role: staff.effectiveRole,
      membershipId: staff.membershipId || null,
    }).catch(() => null);
    const permissions = new Set(permissionResult?.permissions || []);
    manager = permissions.has('*') || permissions.has('pos.manage');
  }
  if (!manager) {
    throw new AppError('This PIN does not belong to a manager', 403, 'manager_approval_invalid');
  }
  return { pinRow, staff };
}

// Gate for one approval-protected action. Returns null when no approval
// is needed (manager actor, or below the threshold). Otherwise verifies
// the manager PIN from the request body and writes the approvals row on
// the caller's transaction client, returning it. Throws:
//   403 manager_approval_required (no PIN supplied) with policy details
//   400 validation_failed (missing/unknown reason code on approval path)
//   401/403/429 from PIN validation.
async function consumeManagerApproval({
  client,
  restaurant,
  req,
  action,
  amountCents = 0,
  shiftId = null,
  orderId = null,
  locationId = null,
  actingStaff = null,
  reasonCodes = null,
}) {
  const actorIsManager = await hasPosManage(restaurant, req.user.id);
  if (actorIsManager) return null;
  const requirement = approvalRequirement(restaurant, action, amountCents);
  if (!requirement.required) return null;

  const reasonCode = normalizeString(req.body.reasonCode || req.body.reason_code, 60);
  const reason = normalizeString(req.body.reason || req.body.approvalReason || req.body.approval_reason, 1000);
  const approvalPin = normalizeString(
    req.body.approvalPin || req.body.approval_pin || req.body.managerPin || req.body.manager_pin,
    12
  );
  if (!approvalPin) {
    throw new AppError(
      'A manager PIN approval is required for this action',
      403,
      'manager_approval_required',
      { action, amountCents, thresholdCents: requirement.thresholdCents, always: requirement.always }
    );
  }
  if (reasonCodes && (!reasonCode || !reasonCodes.has(reasonCode))) {
    throw new AppError('Validation failed', 400, 'validation_failed', {
      reasonCode: 'A valid reason code is required for this action',
    });
  }
  const { pinRow } = await verifyManagerPinApproval({
    restaurantId: restaurant.id,
    pin: approvalPin,
    deviceId: actingStaff?.deviceId || null,
  });
  const { rows: [approval] } = await client.query(
    `INSERT INTO restaurant_pos_approvals
       (restaurant_id, location_id, action, amount_cents, requester_user_id, requester_staff_user_id,
        approver_user_id, approver_staff_pin_id, reason_code, reason, shift_id, food_order_id, status)
     VALUES ($1,
             COALESCE(
               $2,
               (SELECT location_id FROM food_orders WHERE id = $12 AND restaurant_id = $1),
               (SELECT location_id FROM restaurant_pos_shifts WHERE id = $11 AND restaurant_id = $1),
               (SELECT id FROM restaurant_locations WHERE restaurant_id = $1 ORDER BY is_primary DESC, id ASC LIMIT 1)
             ),
             $3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'approved')
     RETURNING *`,
    [
      restaurant.id,
      locationId,
      action,
      Math.max(0, Math.floor(Number(amountCents) || 0)),
      req.user.id,
      actingStaff?.staffUserId || null,
      pinRow.staff_user_id,
      pinRow.id,
      reasonCode,
      reason,
      shiftId,
      orderId,
    ]
  );
  return approval;
}

async function linkApproval(client, approvalId, { paymentId = null, drawerEventId = null } = {}) {
  if (!approvalId) return;
  await client.query(
    `UPDATE restaurant_pos_approvals
        SET payment_id = COALESCE($2, payment_id),
            drawer_event_id = COALESCE($3, drawer_event_id),
            status = 'consumed'
      WHERE id = $1`,
    [approvalId, paymentId, drawerEventId]
  );
}

module.exports = {
  POS_VOID_REASON_CODES,
  POS_COMP_REASON_CODES,
  DEFAULT_POS_APPROVAL_POLICY,
  staffPinDigest,
  recordPinAttempt,
  validateStaffPinForRestaurant,
  createStaffSession,
  staffSessionTokenFromRequest,
  resolveStaffSession,
  endStaffSession,
  resolveActingStaff,
  hasPosManage,
  approvalRequirement,
  verifyManagerPinApproval,
  consumeManagerApproval,
  linkApproval,
};
