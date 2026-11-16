'use strict';

/**
 * WP-073: who may read a business's or restaurant's money statements.
 *
 * Owners always may. A member must hold the manager role AND effectively hold
 * `payouts.view` (managers have it by default, so a deny override is how an
 * owner keeps a staffing manager out of finance). For a restaurant statement,
 * a manager limited to some stores (active store assignments) does not read
 * the restaurant-wide settlement. Operational membership alone never implies
 * finance reads. Checked on every request, so an old download link stops
 * working as soon as the standing goes.
 */

const permissionsService = require('../permissionsService');

const FINANCE_READ = 'payouts.view';

async function memberHasFinanceRead(queryable, { businessId, userId, restaurantId = null }) {
  const { rows: [member] } = await queryable.query(
    `SELECT id, role FROM business_members
      WHERE business_id = $1 AND member_id::text = $2::text AND status = 'active'
      ORDER BY id LIMIT 1`,
    [businessId, String(userId)]);
  if (!member || member.role !== 'manager') return false;
  let permissions;
  try {
    ({ permissions } = await permissionsService.getEffectivePermissions({
      businessId, userId, role: member.role, membershipId: member.id,
    }));
  } catch (_) {
    return false; // fail closed
  }
  if (!permissionsService.hasAny(permissions, [FINANCE_READ])) return false;
  if (restaurantId != null) {
    const { rows } = await queryable.query(
      `SELECT 1 FROM restaurant_location_memberships
        WHERE restaurant_id = $1 AND membership_id = $2 AND status = 'active' LIMIT 1`,
      [restaurantId, member.id]);
    if (rows.length) return false;
  }
  return true;
}

module.exports = { memberHasFinanceRead, FINANCE_READ };
