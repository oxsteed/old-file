'use strict';

/**
 * WP-073: who may read a business's or restaurant's money statements.
 *
 * Owners always may. A member must hold the manager role AND effectively hold
 * `payouts.view` (managers have it by default, so a deny override is how an
 * owner keeps a staffing manager out of finance). For a restaurant statement,
 * a manager limited to some stores (active store assignments) does not read
 * the restaurant-wide settlement. Operational membership alone never implies
 * finance reads. An explicit statements.view override can separately allow
 * issued records. The caller must opt in only on read surfaces.
 */

const permissionsService = require('../permissionsService');

const FINANCE_READ = 'payouts.view';
const DELEGATED_STATEMENT_READ = 'statements.view';

async function memberFinanceReadStanding(queryable, { businessId, userId, restaurantId = null, allowDelegated = false }) {
  const { rows: [member] } = await queryable.query(
    `SELECT id, role FROM business_members
      WHERE business_id = $1 AND member_id::text = $2::text AND status = 'active'
      ORDER BY id LIMIT 1`,
    [businessId, String(userId)]);
  if (!member) return null;
  let standing = null;
  if (member.role === 'manager') {
    try {
      const { permissions } = await permissionsService.getEffectivePermissions({
        businessId, userId, role: member.role, membershipId: member.id,
      });
      if (permissionsService.hasAny(permissions, [FINANCE_READ])) standing = 'finance';
    } catch (_) {
      return null;
    }
  }
  if (!standing && allowDelegated) {
    // This grant is deliberately an explicit, expirable membership override.
    // Read it fresh so a revoked or expired grant closes old archive links.
    const { rows } = await queryable.query(
      `SELECT 1 FROM membership_permission_overrides mpo
        JOIN team_permissions p ON p.id = mpo.permission_id
       WHERE mpo.membership_id = $1 AND p.code = $2 AND mpo.effect = 'allow'
         AND (mpo.expires_at IS NULL OR mpo.expires_at > NOW())`,
      [member.id, DELEGATED_STATEMENT_READ]);
    if (rows.length) standing = 'issued_statements';
  }
  if (standing && restaurantId != null) {
    const { rows } = await queryable.query(
      `SELECT 1 FROM restaurant_location_memberships
        WHERE restaurant_id = $1 AND membership_id = $2 AND status = 'active' LIMIT 1`,
      [restaurantId, member.id]);
    if (rows.length) return null;
  }
  return standing;
}

async function memberHasFinanceRead(queryable, scope) {
  return Boolean(await memberFinanceReadStanding(queryable, scope));
}

module.exports = { memberFinanceReadStanding, memberHasFinanceRead, FINANCE_READ };
