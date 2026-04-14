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

module.exports = {
  ownedBusiness,
  canEditProfile,
};
