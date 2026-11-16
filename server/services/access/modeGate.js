'use strict';

/**
 * WP-005 / WP-013 compatibility gate for the legacy mode writes
 * (`PUT /api/auth/profile`, `PATCH /api/auth/me`, `POST /api/auth/switch-role`).
 *
 * While ACCESS_CUSTOMER_FIRST_SIGNUP or ACCESS_LEGACY_SWITCH_RETIRED is on, a
 * mode write may only change the user's *view*; it may never raise authority.
 * A mode whose legacy role would lift a `customer` to a helper-class role is
 * allowed only when the account already holds a capability that justifies it
 * (an effective grant, canonical business ownership, or an active workspace
 * membership). Admin / employee roles are never changed by a mode write
 * (modeRole.roleForMode already preserves them). With both flags off the gate
 * is a no-op, so legacy behaviour is byte-for-byte unchanged.
 */

const flags = require('./flags');
const modeRole = require('../../utils/modeRole');
const { loadFacts } = require('./accessService');
const { accountActive, grantIsEffective } = require('./resolver');

const MODE_CAPABILITY = Object.freeze({
  helper: ['helper.offer_services'],
  business_owner: ['business.own'],
  restaurant_owner: ['restaurant.own', 'business.own'],
  consultant: ['consultant.accept_paying_clients'],
  tool_owner: ['tool_owner.list_equipment'],
});

const HELPER_CLASS_ROLES = new Set(['helper', 'helper_pro', 'broker', 'admin', 'super_admin', 'employee']);

function gateActive() {
  return flags.customerFirstSignup() || flags.legacySwitchRetired();
}

/**
 * @returns {Promise<{allowed:boolean, code?:string, capability?:string|null}>}
 */
async function checkModeChange({ userId, currentRole, targetMode }, db) {
  if (!gateActive()) return { allowed: true };
  const targetRole = modeRole.roleForMode(targetMode, { currentRole });
  // No authority increase: the derived role stays the same class.
  if (targetRole === 'customer' || HELPER_CLASS_ROLES.has(currentRole)) return { allowed: true };

  const facts = await loadFacts(userId, db);
  const now = Date.now();
  if (!accountActive(facts.user, now)) return { allowed: false, code: 'access_required', capability: null };
  const wanted = MODE_CAPABILITY[targetMode] || [];
  const hasGrant = (facts.grants || []).some((g) => wanted.includes(g.capability) && grantIsEffective(g, now));
  if (hasGrant) return { allowed: true };
  const businesses = facts.businesses || [];
  if ((targetMode === 'business_owner' || targetMode === 'restaurant_owner')
      && businesses.some((b) => b.role === 'owner')) return { allowed: true };
  if (!MODE_CAPABILITY[targetMode] && businesses.length > 0) return { allowed: true };
  return { allowed: false, code: 'access_required', capability: wanted[0] || null };
}

module.exports = { checkModeChange, gateActive, MODE_CAPABILITY };
