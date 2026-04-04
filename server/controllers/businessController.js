// server/controllers/businessController.js
// One person, multiple businesses. Managed from dashboard.

const pool = require('../db');

// ── List user's businesses ──────────────────────────────
async function listBusinesses(req, res) {
  try {
    const { rows } = await pool.query(
      `SELECT id, business_name, business_type, address_city, address_state,
              is_primary, is_active, created_at
       FROM businesses
       WHERE user_id = $1
       ORDER BY is_primary DESC, created_at ASC`,
      [req.user.id]
    );
    return res.json({ businesses: rows });
  } catch (err) {
    console.error('listBusinesses error:', err);
    return res.status(500).json({ error: 'Failed to load businesses' });
  }
}

// ── Add a business ──────────────────────────────────────
async function addBusiness(req, res) {
  try {
    const {
      business_name, business_type, ein,
      address_street, address_city, address_state, address_zip,
    } = req.body;

    if (!business_name?.trim()) {
      return res.status(400).json({ error: 'Business name is required' });
    }

    // Check if user has any businesses yet — first one is auto-primary
    const { rows: existing } = await pool.query(
      'SELECT COUNT(*) as count FROM businesses WHERE user_id = $1',
      [req.user.id]
    );
    const isPrimary = parseInt(existing[0].count) === 0;

    const { rows: [biz] } = await pool.query(
      `INSERT INTO businesses
         (user_id, business_name, business_type, ein,
          address_street, address_city, address_state, address_zip, is_primary)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [
        req.user.id, business_name.trim(), business_type || null, ein || null,
        address_street || null, address_city || null, address_state || null,
        address_zip || null, isPrimary,
      ]
    );

    return res.status(201).json({ business: biz });
  } catch (err) {
    console.error('addBusiness error:', err);
    return res.status(500).json({ error: 'Failed to add business' });
  }
}

// ── Update a business ───────────────────────────────────
async function updateBusiness(req, res) {
  try {
    const { id } = req.params;
    const { business_name, business_type, ein,
            address_street, address_city, address_state, address_zip } = req.body;

    const { rows: [biz] } = await pool.query(
      `UPDATE businesses
       SET business_name = COALESCE($1, business_name),
           business_type = COALESCE($2, business_type),
           ein = COALESCE($3, ein),
           address_street = COALESCE($4, address_street),
           address_city = COALESCE($5, address_city),
           address_state = COALESCE($6, address_state),
           address_zip = COALESCE($7, address_zip),
           updated_at = NOW()
       WHERE id = $8 AND user_id = $9
       RETURNING *`,
      [business_name, business_type, ein,
       address_street, address_city, address_state, address_zip,
       id, req.user.id]
    );

    if (!biz) return res.status(404).json({ error: 'Business not found' });
    return res.json({ business: biz });
  } catch (err) {
    console.error('updateBusiness error:', err);
    return res.status(500).json({ error: 'Failed to update business' });
  }
}

// ── Set primary business ────────────────────────────────
async function setPrimary(req, res) {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    // Unset current primary
    await pool.query(
      'UPDATE businesses SET is_primary = FALSE WHERE user_id = $1',
      [userId]
    );
    // Set new primary
    const { rows: [biz] } = await pool.query(
      'UPDATE businesses SET is_primary = TRUE WHERE id = $1 AND user_id = $2 RETURNING *',
      [id, userId]
    );

    if (!biz) return res.status(404).json({ error: 'Business not found' });
    return res.json({ business: biz });
  } catch (err) {
    console.error('setPrimary error:', err);
    return res.status(500).json({ error: 'Failed to set primary business' });
  }
}

// ── Delete a business ───────────────────────────────────
async function deleteBusiness(req, res) {
  try {
    const { id } = req.params;
    const { rowCount } = await pool.query(
      'DELETE FROM businesses WHERE id = $1 AND user_id = $2',
      [id, req.user.id]
    );
    if (!rowCount) return res.status(404).json({ error: 'Business not found' });
    return res.json({ ok: true });
  } catch (err) {
    console.error('deleteBusiness error:', err);
    return res.status(500).json({ error: 'Failed to delete business' });
  }
}

module.exports = { listBusinesses, addBusiness, updateBusiness, setPrimary, deleteBusiness };
