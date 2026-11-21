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
      WHERE business_id = $1 AND member_id::text = $2::text AND status = 'active' AND (access_valid_until IS NULL OR access_valid_until>NOW())
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
  // G-19, deliberate boundary: a member with active location assignments
  // gets NO restaurant-wide settlement standing here, even if they hold a
  // finance read code. The settlement journal is restaurant-level (one
  // sub-bank account per restaurant+currency; the stored document's orders
  // carry no location_id), so a location-filtered settlement cannot be
  // derived without fabricating numbers. Location-scoped members get their
  // finance view from memberLocationFinanceStanding below (the
  // location-scoped sales report), and settlement stays HQ-only.
  if (standing && restaurantId != null) {
    const { rows } = await queryable.query(
      `SELECT 1 FROM restaurant_location_memberships
        WHERE restaurant_id = $1 AND membership_id = $2 AND status = 'active' LIMIT 1`,
      [restaurantId, member.id]);
    if (rows.length) return null;
  }
  return standing;
}

// G-19: location-scoped finance standing. A member with active assignments
// to stores of this restaurant may read the location-scoped financial
// report for exactly those stores. This standing admits NOTHING
// restaurant-wide: no settlement documents, no sub-bank balances.
async function memberLocationFinanceStanding(queryable, { businessId, userId, restaurantId }) {
  const { rows: [member] } = await queryable.query(
    `SELECT id FROM business_members
      WHERE business_id = $1 AND member_id::text = $2::text AND status = 'active' AND (access_valid_until IS NULL OR access_valid_until>NOW())
      ORDER BY id LIMIT 1`,
    [businessId, String(userId)]);
  if (!member) return null;
  const { rows } = await queryable.query(
    `SELECT lm.location_id, l.name AS location_name
       FROM restaurant_location_memberships lm
       JOIN restaurant_locations l
         ON l.id = lm.location_id AND l.restaurant_id = lm.restaurant_id
      WHERE lm.restaurant_id = $1 AND lm.membership_id = $2 AND lm.status = 'active'
      ORDER BY l.name ASC, l.id ASC`,
    [restaurantId, member.id]);
  if (!rows.length) return null;
  return {
    standing: 'location_reports',
    locationIds: rows.map((row) => String(row.location_id)),
    locationNames: rows.map((row) => String(row.location_name || '')),
  };
}

async function memberHasFinanceRead(queryable, scope) {
  return Boolean(await memberFinanceReadStanding(queryable, scope));
}

module.exports = { memberFinanceReadStanding, memberHasFinanceRead, memberLocationFinanceStanding, FINANCE_READ };
