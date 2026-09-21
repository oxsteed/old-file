const pool = require('../db');

async function ownedBusiness(userId, bizId) {
  const { rows } = await pool.query(
    'SELECT id, business_name, is_primary, tax_rate FROM businesses WHERE id = $1 AND user_id = $2',
    [bizId, userId]
  );
  return rows[0] || null;
}

/**
 * Returns { id, owner_id } if the user is the business owner OR an active manager.
 * Representatives are not granted profile-edit access.
 * Returns null if the user has no qualifying access.
 */
async function canEditProfile(userId, bizId) {
  const { rows } = await pool.query(
    `SELECT b.id, b.user_id AS owner_id
     FROM businesses b
     WHERE b.id = $1
       AND (
         b.user_id = $2
         OR EXISTS (
           SELECT 1 FROM business_members bm
           WHERE bm.business_id = b.id
             AND bm.member_id   = $2
             AND bm.role        = 'manager'
             AND bm.status      = 'active'
         )
       )`,
    [bizId, userId]
  );
  return rows[0] || null;
}

/**
 * Owner OR active manager OR active representative (team tab / inbox context).
 */
async function canAccessBusinessTeam(userId, bizId) {
  const { rows } = await pool.query(
    `SELECT b.id, b.user_id AS owner_id
     FROM businesses b
     WHERE b.id = $1
       AND (
         b.user_id = $2
         OR EXISTS (
           SELECT 1 FROM business_members bm
           WHERE bm.business_id = b.id
             AND bm.member_id   = $2
             AND bm.status      = 'active'
         )
       )`,
    [bizId, userId]
  );
  return rows[0] || null;
}

/**
 * Owner OR active manager - Business Hub financials (analytics, invoices, tax, goals).
 * Representatives must not use finance APIs (they handle chat / jobs only).
 * Returns the same shape as ownedBusiness plus owner_id for queries keyed on the owner account.
 */
async function canManageBusinessFinance(userId, bizId) {
  const { rows } = await pool.query(
    `SELECT b.id, b.business_name, b.is_primary, b.tax_rate, b.user_id AS owner_id
     FROM businesses b
     WHERE b.id = $1
       AND b.deleted_at IS NULL
       AND (
         b.user_id = $2
         OR EXISTS (
           SELECT 1 FROM business_members bm
           WHERE bm.business_id = b.id
             AND bm.member_id   = $2
             AND bm.role        = 'manager'
             AND bm.status      = 'active'
         )
       )`,
    [bizId, userId]
  );
  return rows[0] || null;
}

/**
 * Boolean access check used by content/booking controllers.
 * Default roles are owner and manager (profile-edit access).
 * Pass a broader role list (e.g. representative) to allow any active member.
 */
async function canAccessBusiness(userId, bizId, roles = ['owner', 'manager']) {
  if (!userId || bizId == null) return false;
  const allowed = Array.isArray(roles) && roles.length ? roles : ['owner', 'manager'];
  const needsTeam = allowed.some((role) => role !== 'owner' && role !== 'manager');
  const row = needsTeam
    ? await canAccessBusinessTeam(userId, bizId)
    : await canEditProfile(userId, bizId);
  return !!row;
}

module.exports = {
  ownedBusiness,
  canEditProfile,
  canAccessBusiness,
  canAccessBusinessTeam,
  canManageBusinessFinance,
};
