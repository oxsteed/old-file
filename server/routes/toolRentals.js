// server/routes/toolRentals.js
// Tool Rental listings — any authenticated user can manage their tools for rent
// GET    /api/tool-rentals/me         → list my tools
// POST   /api/tool-rentals            → create tool listing
// PUT    /api/tool-rentals/:id        → update tool listing
// DELETE /api/tool-rentals/:id        → delete tool listing
// GET    /api/tool-rentals/browse     → public browse (no auth)

const express = require('express');
const router  = express.Router();
const { authenticate } = require('../middleware/auth');
const pool    = require('../db');

const TOOL_FIELDS = `
  id, user_id, name, category, description,
  daily_rate, hourly_rate, deposit_amount,
  condition, brand, model, is_available,
  requires_deposit, delivery_available, pickup_only,
  location_city, location_state, created_at, updated_at
`;

// GET /api/tool-rentals/browse?category=&city=&limit=30
router.get('/browse', async (req, res) => {
  try {
    const { category, city, limit = 30, offset = 0 } = req.query;
    const params = [true];
    let where = 'WHERE t.is_available = $1';
    let idx = 2;

    if (category) { where += ` AND t.category ILIKE $${idx++}`; params.push(`%${category}%`); }
    if (city)     { where += ` AND t.location_city ILIKE $${idx++}`; params.push(`%${city}%`); }

    params.push(Math.min(parseInt(limit) || 30, 100));
    params.push(parseInt(offset) || 0);

    const result = await pool.query(
      `SELECT ${TOOL_FIELDS},
              u.first_name, u.last_name, u.avatar_url
         FROM tool_rentals t
         JOIN users u ON u.id = t.user_id
        ${where}
        ORDER BY t.created_at DESC
        LIMIT $${idx} OFFSET $${idx + 1}`,
      params
    );
    res.json({ tools: result.rows });
  } catch (err) {
    require('../utils/logger').error('[toolRentals] browse error:', err.message);
    res.status(500).json({ error: 'Failed to fetch tools' });
  }
});

// GET /api/tool-rentals/me
router.get('/me', authenticate, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT ${TOOL_FIELDS}
         FROM tool_rentals
        WHERE user_id = $1
        ORDER BY created_at DESC`,
      [req.user.id]
    );
    res.json({ tools: result.rows });
  } catch (err) {
    require('../utils/logger').error('[toolRentals] list error:', err.message);
    res.status(500).json({ error: 'Failed to fetch your tools' });
  }
});

// POST /api/tool-rentals
router.post('/', authenticate, async (req, res) => {
  try {
    const {
      name, category, description,
      daily_rate, hourly_rate, deposit_amount,
      condition, brand, model,
      is_available = true, requires_deposit = false,
      delivery_available = false, pickup_only = true,
      location_city, location_state,
    } = req.body;

    if (!name?.trim()) {
      return res.status(400).json({ error: 'Tool name is required' });
    }

    const VALID_CONDITIONS = ['excellent', 'good', 'fair', 'poor'];
    if (condition && !VALID_CONDITIONS.includes(condition)) {
      return res.status(400).json({ error: 'Invalid condition value' });
    }

    const result = await pool.query(
      `INSERT INTO tool_rentals
         (user_id, name, category, description,
          daily_rate, hourly_rate, deposit_amount,
          condition, brand, model,
          is_available, requires_deposit, delivery_available, pickup_only,
          location_city, location_state)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
       RETURNING ${TOOL_FIELDS}`,
      [
        req.user.id,
        name.trim(),
        category?.trim() || null,
        description?.trim() || null,
        daily_rate  ? parseFloat(daily_rate)  : null,
        hourly_rate ? parseFloat(hourly_rate) : null,
        deposit_amount ? parseFloat(deposit_amount) : null,
        condition || null,
        brand?.trim() || null,
        model?.trim() || null,
        is_available,
        requires_deposit,
        delivery_available,
        pickup_only,
        location_city?.trim() || null,
        location_state?.trim() || null,
      ]
    );

    res.status(201).json({ tool: result.rows[0] });
  } catch (err) {
    require('../utils/logger').error('[toolRentals] create error:', err.message);
    res.status(500).json({ error: 'Failed to create tool listing' });
  }
});

// PUT /api/tool-rentals/:id
router.put('/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;

    // Fetch existing record first (ownership check)
    const existing = await pool.query(
      'SELECT id FROM tool_rentals WHERE id = $1 AND user_id = $2',
      [id, req.user.id]
    );
    if (!existing.rows.length) {
      return res.status(404).json({ error: 'Tool not found' });
    }

    const {
      name, category, description,
      daily_rate, hourly_rate, deposit_amount,
      condition, brand, model,
      is_available, requires_deposit,
      delivery_available, pickup_only,
      location_city, location_state,
    } = req.body;

    const VALID_CONDITIONS = ['excellent', 'good', 'fair', 'poor'];
    if (condition && !VALID_CONDITIONS.includes(condition)) {
      return res.status(400).json({ error: 'Invalid condition value' });
    }

    const result = await pool.query(
      `UPDATE tool_rentals SET
         name               = COALESCE($1,  name),
         category           = COALESCE($2,  category),
         description        = COALESCE($3,  description),
         daily_rate         = $4,
         hourly_rate        = $5,
         deposit_amount     = $6,
         condition          = COALESCE($7,  condition),
         brand              = COALESCE($8,  brand),
         model              = COALESCE($9,  model),
         is_available       = COALESCE($10, is_available),
         requires_deposit   = COALESCE($11, requires_deposit),
         delivery_available = COALESCE($12, delivery_available),
         pickup_only        = COALESCE($13, pickup_only),
         location_city      = COALESCE($14, location_city),
         location_state     = COALESCE($15, location_state),
         updated_at         = NOW()
       WHERE id = $16 AND user_id = $17
       RETURNING ${TOOL_FIELDS}`,
      [
        name?.trim() || null,
        category?.trim() || null,
        description?.trim() || null,
        daily_rate  !== undefined ? (daily_rate  ? parseFloat(daily_rate)  : null) : undefined,
        hourly_rate !== undefined ? (hourly_rate ? parseFloat(hourly_rate) : null) : undefined,
        deposit_amount !== undefined ? (deposit_amount ? parseFloat(deposit_amount) : null) : undefined,
        condition || null,
        brand?.trim() || null,
        model?.trim() || null,
        is_available       !== undefined ? is_available       : null,
        requires_deposit   !== undefined ? requires_deposit   : null,
        delivery_available !== undefined ? delivery_available : null,
        pickup_only        !== undefined ? pickup_only        : null,
        location_city?.trim()  || null,
        location_state?.trim() || null,
        id,
        req.user.id,
      ]
    );

    res.json({ tool: result.rows[0] });
  } catch (err) {
    require('../utils/logger').error('[toolRentals] update error:', err.message);
    res.status(500).json({ error: 'Failed to update tool listing' });
  }
});

// DELETE /api/tool-rentals/:id
router.delete('/:id', authenticate, async (req, res) => {
  try {
    const result = await pool.query(
      'DELETE FROM tool_rentals WHERE id = $1 AND user_id = $2 RETURNING id',
      [req.params.id, req.user.id]
    );
    if (!result.rows.length) {
      return res.status(404).json({ error: 'Tool not found' });
    }
    res.json({ deleted: true });
  } catch (err) {
    require('../utils/logger').error('[toolRentals] delete error:', err.message);
    res.status(500).json({ error: 'Failed to delete tool listing' });
  }
});

module.exports = router;
