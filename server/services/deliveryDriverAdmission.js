'use strict';

/**
 * G-46: delivery-driver admission on the progressive contract.
 *
 * An approved delivery driver is a `ship_goods` signer-upper holding the
 * `logistics.ship` capability. The driver path used to read only legacy
 * helper state (`default_mode` in HELPER_MODES or role `helper`), which a
 * progressive approval deliberately never writes (requireLogisticsAccess:
 * "a progressive logistics approval grants organizer authority without
 * rewriting the user's legacy role or default mode"). A `logistics.ship`
 * holder with no helper history therefore 403ed on driver onboarding and
 * could not see or claim marketplace jobs.
 *
 * Admission is now: legacy helper state OR the authoritative
 * `logistics.ship` capability (self subject). Legacy drivers keep working
 * exactly as before; the grant only ADDS a path, it never removes one.
 * No legacy helper state is backfilled from the grant.
 *
 * The capability check is fail-closed for the new leg only: when the
 * progressive tables are unavailable the grant is treated as not held and
 * the legacy legs still decide. Callers check the legacy legs first so
 * the capability lookup runs only for users the legacy state does not
 * already admit (and so mocked unit tests that queue exact query counts
 * for helper callers see no extra query).
 */
const pool = require('../db');
const accessService = require('./access/accessService');
const { projectionEnabled } = require('./access/flags');

const HELPER_MODES = new Set([
  'helper', 'helper_pro', 'business_owner', 'business_manager',
  'business_representative', 'business_employee',
]);

function isLegacyDeliveryHelper(user) {
  return HELPER_MODES.has(user?.default_mode) || user?.role === 'helper';
}

function isInternalDriver(user) {
  return user?.logistics_role === 'internal_driver' || user?.default_mode === 'internal_driver';
}

async function holdsLogisticsShip(userId) {
  try {
    if (!userId || !projectionEnabled(userId)) return false;
    const result = await accessService.can(userId, 'logistics.ship', { type: 'self' });
    return result?.allowed === true;
  } catch {
    return false;
  }
}

// Marketplace driving (job list visibility + claim): a legacy helper or a
// `logistics.ship` holder. Pure internal drivers are deliberately NOT
// admitted here: they are assigned by operations, not the marketplace.
async function canDriveMarketplace(user) {
  if (!user?.id) return false;
  if (isLegacyDeliveryHelper(user)) return true;
  return holdsLogisticsShip(user.id);
}

// Full driver admission (self-serve onboarding + driver payouts): legacy
// helper, internal driver, or `logistics.ship` holder.
async function isAdmittedDriver(user) {
  if (!user?.id) return false;
  if (isLegacyDeliveryHelper(user) || isInternalDriver(user)) return true;
  return holdsLogisticsShip(user.id);
}

// Driver-specific activation state: an approved + active profile row.
async function hasApprovedActiveDriverProfile(userId, db = pool) {
  if (!userId) return false;
  const { rows } = await db.query(
    'SELECT 1 FROM delivery_driver_profiles WHERE user_id = $1 AND approved = TRUE AND active = TRUE',
    [userId],
  );
  return rows.length > 0;
}

module.exports = {
  HELPER_MODES,
  isLegacyDeliveryHelper,
  isInternalDriver,
  holdsLogisticsShip,
  canDriveMarketplace,
  isAdmittedDriver,
  hasApprovedActiveDriverProfile,
};
