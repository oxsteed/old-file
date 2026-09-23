// server/utils/modeRole.js
//
// One concept, one source of truth: a user's `default_mode` IS their account
// type. The legacy `users.role` column still exists (every controller and
// middleware reads it) so we derive role from mode and keep them in lockstep
// on every write. Frontend reads `default_mode` for UI; backend RBAC keeps
// reading `role`.
//
// This util is the only place that decides what role a mode implies. If you
// add a new mode, add it to MODE_ROLE_MAP here and to the CHECK constraint in
// migration 270.

'use strict';

const crypto = require('crypto');

// ── Mode → DB role mapping ───────────────────────────────────────────────────
// 'helper' role unlocks: helper_profiles row, bidding, listing in directory,
// Business Hub, QR generator, payout setup, etc. Modes that need any of those
// experiences derive to 'helper'. Everything else is 'customer'.
//
// Admin / super_admin are preserved unchanged — switching mode never demotes
// or promotes an admin's RBAC role.
const MODE_ROLE_MAP = Object.freeze({
  customer:                 'customer',
  investor:                 'customer',
  helper:                   'helper',
  logistics:                'customer',
  business_owner:           'helper',
  restaurant_customer:      'customer',
  restaurant_owner:         'helper',
  restaurant_manager:       'helper',
  restaurant_staff:         'helper',
  restaurant_runner:        'helper',
  consultant:               'helper',
  tool_owner:               'helper',
  franchise_applicant:      'customer',
  life_only:                'customer',
  // Granted modes (assigned via Vortex / employer flow, not self-selected).
  // They DO NOT auto-switch the user — the user has to manually enter them
  // via the Mode Switcher. The role they imply matches the underlying biz
  // membership rights: managers / reps / employees / support agents are all
  // "helper-class" at the DB level (they need access to a workspace).
  business_manager:         'helper',
  business_representative:  'helper',
  business_employee:        'helper',
  business_support_agent:   'helper',
  admin:                    'admin',
});

const SELF_SELECTABLE_MODES = Object.freeze([
  'customer',
  'investor',
  'helper',
  'logistics',
  'business_owner',
  'restaurant_customer',
  'restaurant_owner',
  'restaurant_manager',
  'restaurant_staff',
  'restaurant_runner',
  'consultant',
  'tool_owner',
  'franchise_applicant',
  'life_only',
]);

const GRANTED_MODES = Object.freeze([
  'business_manager',
  'business_representative',
  'business_employee',
  'business_support_agent',
]);

function isValidMode(m) {
  return typeof m === 'string' && Object.prototype.hasOwnProperty.call(MODE_ROLE_MAP, m);
}

function isSelfSelectableMode(m) {
  return SELF_SELECTABLE_MODES.includes(m);
}

function isGrantedMode(m) {
  return GRANTED_MODES.includes(m);
}

/**
 * Returns the users.role value that should be set for a given mode.
 * For admins / super_admins we never demote — the caller passes the current
 * role and we honor it.
 */
function roleForMode(mode, { currentRole } = {}) {
  if (currentRole === 'super_admin') return 'super_admin';
  if (currentRole === 'admin') return 'admin';
  if (currentRole === 'employee') return 'employee';
  const target = MODE_ROLE_MAP[mode];
  return target || 'customer';
}

/**
 * Apply a mode switch transactionally. Updates default_mode + role together,
 * ensures a helper_profiles row exists when switching INTO a helper-class
 * mode (so the helper can start listing immediately), and invalidates every
 * existing session for the user so the new JWT role claim takes effect on
 * the next refresh.
 *
 * Caller is responsible for issuing fresh tokens AFTER this returns — this
 * function only mutates the DB.
 *
 * @param {Pool|PoolClient} client  pg client (must be a transactional client)
 * @param {string}          userId
 * @param {string}          newMode  one of MODE_ROLE_MAP keys
 * @returns {Promise<object|null>}   the updated users row, or null on conflict
 */
async function applyModeSwitch(client, userId, newMode) {
  if (!isValidMode(newMode)) {
    throw Object.assign(new Error('invalid_mode'), { code: 'invalid_mode' });
  }

  // Read current user (we need current role to honor admin invariants).
  const { rows: currentRows } = await client.query(
    'SELECT id, role, default_mode FROM users WHERE id = $1 AND deleted_at IS NULL FOR UPDATE',
    [userId],
  );
  if (currentRows.length === 0) {
    throw Object.assign(new Error('user_not_found'), { code: 'user_not_found' });
  }
  const current = currentRows[0];
  const newRole = roleForMode(newMode, { currentRole: current.role });

  // If switching INTO a helper-class mode, make sure a helper_profiles row
  // exists so the user can immediately start using helper features.
  if (newRole === 'helper') {
    await client.query(
      `INSERT INTO helper_profiles (user_id, is_listed)
       VALUES ($1, FALSE)
       ON CONFLICT (user_id) DO NOTHING`,
      [userId],
    );
  }

  const { rows: updateRows } = await client.query(
    `UPDATE users
        SET default_mode = $2,
            role         = $3,
            onboarding_completed = TRUE,
            membership_tier = COALESCE(membership_tier, 'tier1'),
            updated_at = NOW()
      WHERE id = $1
      RETURNING id`,
    [userId, newMode, newRole],
  );
  if (updateRows.length === 0) return null;

  // Re-fetch joined with helper_profiles + primary business so the response
  // shape matches what formatAuthUser expects.
  const { rows } = await client.query(
    `SELECT u.*, b.business_name, hp.is_listed
       FROM users u
       LEFT JOIN businesses b
              ON b.user_id = u.id AND b.is_primary = TRUE
       LEFT JOIN helper_profiles hp
              ON hp.user_id = u.id
      WHERE u.id = $1`,
    [userId],
  );
  return rows[0] || null;
}

/**
 * Invalidate all of a user's sessions. Call after applyModeSwitch when you
 * want the new role to take effect immediately on every device.
 */
async function invalidateUserSessions(client, userId) {
  await client.query(
    'UPDATE sessions SET is_valid = false WHERE user_id::text = $1',
    [String(userId)],
  );
}

module.exports = {
  MODE_ROLE_MAP,
  SELF_SELECTABLE_MODES,
  GRANTED_MODES,
  isValidMode,
  isSelfSelectableMode,
  isGrantedMode,
  roleForMode,
  applyModeSwitch,
  invalidateUserSessions,
};
