// server/routes/helperProducts.js
// Products a helper lists for sale (food, supplies, gear, etc.)
// OxSteed keeps a minimal role — products are self-declared, not verified.
//
// GET    /api/helper-products/:helperId   — public: available products for a helper
// GET    /api/helper-products/me          — auth: own full list
// POST   /api/helper-products             — auth: create product
// PATCH  /api/helper-products/:id         — auth + ownership: update
// DELETE /api/helper-products/:id         — auth + ownership: delete

const express = require('express');
const router  = express.Router();
const { authenticate } = require('../middleware/auth');
const pool    = require('../db');
const logger  = require('../utils/logger');

const VALID_CATEGORIES = ['food', 'supply', 'gear', 'other'];

// GET /api/helper-products/me  — own full list (must be before /:helperId)
router.get('/me', authenticate, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, helper_id, name, description, price_cents, category, image_url, is_available, created_at, updated_at
         FROM helper_products
        WHERE helper_id = $1
        ORDER BY category, name`,
      [req.user.id]
    );
    res.json({ products: rows });
  } catch (err) {
    logger.error('[helperProducts] GET /me error', { err: err.message });
    res.status(500).json({ error: 'Failed to fetch products' });
  }
});

// GET /api/helper-products/:helperId  — public
router.get('/:helperId', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, helper_id, name, description, price_cents, category, image_url, created_at
         FROM helper_products
        WHERE helper_id = $1 AND is_available = true
        ORDER BY category, name`,
      [req.params.helperId]
    );
    res.json({ products: rows });
  } catch (err) {
    logger.error('[helperProducts] GET /:helperId error', { err: err.message });
    res.status(500).json({ error: 'Failed to fetch products' });
  }
});

// POST /api/helper-products  — create
router.post('/', authenticate, async (req, res) => {
  try {
    const { name, description = '', price_cents, category = 'food', image_url, is_available = true } = req.body;

    if (!name?.trim()) return res.status(400).json({ error: 'name is required' });
    if (!price_cents || !Number.isInteger(price_cents) || price_cents < 1)
      return res.status(400).json({ error: 'price_cents must be a positive integer' });
    if (!VALID_CATEGORIES.includes(category))
      return res.status(400).json({ error: `category must be one of: ${VALID_CATEGORIES.join(', ')}` });

    const { rows } = await pool.query(
      `INSERT INTO helper_products (helper_id, name, description, price_cents, category, image_url, is_available)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [req.user.id, name.trim(), description.trim(), price_cents, category, image_url || null, is_available]
    );
    res.status(201).json({ product: rows[0] });
  } catch (err) {
    logger.error('[helperProducts] POST error', { err: err.message });
    res.status(500).json({ error: 'Failed to create product' });
  }
});

// PATCH /api/helper-products/:id  — update (ownership check)
router.patch('/:id', authenticate, async (req, res) => {
  try {
    // Ownership check
    const { rows: existing } = await pool.query(
      'SELECT id, helper_id FROM helper_products WHERE id = $1',
      [req.params.id]
    );
    if (!existing.length) return res.status(404).json({ error: 'Product not found' });
    if (existing[0].helper_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });

    const { name, description, price_cents, category, image_url, is_available } = req.body;

    // Validate supplied fields
    if (price_cents !== undefined && (!Number.isInteger(price_cents) || price_cents < 1))
      return res.status(400).json({ error: 'price_cents must be a positive integer' });
    if (category !== undefined && !VALID_CATEGORIES.includes(category))
      return res.status(400).json({ error: `category must be one of: ${VALID_CATEGORIES.join(', ')}` });
    if (name !== undefined && !name.trim())
      return res.status(400).json({ error: 'name cannot be empty' });

    const { rows } = await pool.query(
      `UPDATE helper_products
          SET name         = COALESCE($1, name),
              description  = COALESCE($2, description),
              price_cents  = COALESCE($3, price_cents),
              category     = COALESCE($4, category),
              image_url    = COALESCE($5, image_url),
              is_available = COALESCE($6, is_available),
              updated_at   = NOW()
        WHERE id = $7
        RETURNING *`,
      [
        name?.trim() ?? null,
        description?.trim() ?? null,
        price_cents ?? null,
        category ?? null,
        image_url ?? null,
        is_available ?? null,
        req.params.id,
      ]
    );
    res.json({ product: rows[0] });
  } catch (err) {
    logger.error('[helperProducts] PATCH error', { err: err.message });
    res.status(500).json({ error: 'Failed to update product' });
  }
});

// DELETE /api/helper-products/:id  — delete (ownership check)
router.delete('/:id', authenticate, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'DELETE FROM helper_products WHERE id = $1 AND helper_id = $2 RETURNING id',
      [req.params.id, req.user.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Product not found' });
    res.json({ deleted: true });
  } catch (err) {
    logger.error('[helperProducts] DELETE error', { err: err.message });
    res.status(500).json({ error: 'Failed to delete product' });
  }
});

module.exports = router;
