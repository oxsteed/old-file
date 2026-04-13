const pool = require('../db');

async function ownedBusiness(userId, bizId) {
  const { rows } = await pool.query(
    'SELECT id, business_name, is_primary, tax_rate FROM businesses WHERE id = $1 AND user_id = $2',
    [bizId, userId]
  );
  return rows[0] || null;
}

module.exports = {
  ownedBusiness,
};
