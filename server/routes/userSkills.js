// server/routes/userSkills.js
// User skills listings — any authenticated user can manage their own skills
// GET    /api/user-skills/me          → list my skills
// POST   /api/user-skills             → create skill listing
// PUT    /api/user-skills/:id         → update skill listing
// DELETE /api/user-skills/:id         → delete skill listing
// GET    /api/user-skills/lookup      → search skills_lookup (autocomplete)

const express = require('express');
const router  = express.Router();
const { authenticate } = require('../middleware/auth');
const pool    = require('../db');

// GET /api/user-skills/categories?q=elec&limit=20
// Public — returns distinct categories from skills_lookup for autocomplete
router.get('/categories', async (req, res) => {
  try {
    const { q = '', limit = 20 } = req.query;
    const limitN = Math.min(Math.max(1, parseInt(limit) || 20), 50);
    const result = await pool.query(
      `SELECT DISTINCT category
         FROM skills_lookup
        WHERE is_active = true
          AND category IS NOT NULL
          AND ($1 = '' OR category ILIKE $2)
        ORDER BY category
        LIMIT $3`,
      [q, `%${q}%`, limitN]
    );
    res.json({ categories: result.rows.map(r => r.category) });
  } catch (err) {
    require('../utils/logger').error('[userSkills] categories error', err);
    res.status(500).json({ error: 'Failed to fetch categories' });
  }
});

// GET /api/user-skills/lookup?q=plumb&limit=20&offset=0
// Public — no auth required (needed for job-post autocomplete)
router.get('/lookup', async (req, res) => {
  try {
    const { q = '', limit = 20, offset = 0 } = req.query;
    const limitN  = Math.min(Math.max(1, parseInt(limit)  || 20), 100);
    const offsetN = Math.max(0, parseInt(offset) || 0);
    const result = await pool.query(
      `SELECT id, name, category
         FROM skills_lookup
        WHERE is_active = true
          AND ($1 = '' OR name ILIKE $2 OR category ILIKE $2)
        ORDER BY name
        LIMIT $3 OFFSET $4`,
      [q, `%${q}%`, limitN, offsetN]
    );
    res.json({ skills: result.rows, limit: limitN, offset: offsetN });
  } catch (err) {
    require('../utils/logger').error('[userSkills] lookup error', err);
    res.status(500).json({ error: 'Failed to search skills' });
  }
});

// GET /api/user-skills/me
router.get('/me', authenticate, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, skill_name, category, hourly_rate, description,
              years_exp, is_available, created_at, updated_at
         FROM user_skills
        WHERE user_id = $1
        ORDER BY created_at DESC`,
      [req.user.id]
    );
    res.json({ skills: result.rows });
  } catch (err) {
    require('../utils/logger').error('[userSkills] list error:', err.message);
    res.status(500).json({ error: 'Failed to fetch skills' });
  }
});

// POST /api/user-skills
router.post('/', authenticate, async (req, res) => {
  try {
    const {
      skill_name, category, hourly_rate,
      description, years_exp, is_available = true,
    } = req.body;

    if (!skill_name?.trim()) {
      return res.status(400).json({ error: 'skill_name is required' });
    }

    const result = await pool.query(
      `INSERT INTO user_skills
         (user_id, skill_name, category, hourly_rate, description, years_exp, is_available)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (user_id, skill_name)
       DO UPDATE SET
         category     = EXCLUDED.category,
         hourly_rate  = EXCLUDED.hourly_rate,
         description  = EXCLUDED.description,
         years_exp    = EXCLUDED.years_exp,
         is_available = EXCLUDED.is_available,
         updated_at   = NOW()
       RETURNING *`,
      [
        req.user.id,
        skill_name.trim(),
        category?.trim() || null,
        hourly_rate ? parseFloat(hourly_rate) : null,
        description?.trim() || null,
        years_exp !== undefined && years_exp !== '' ? parseInt(years_exp) : null,
        is_available,
      ]
    );

    res.status(201).json({ skill: result.rows[0] });
  } catch (err) {
    require('../utils/logger').error('[userSkills] create error:', err.message);
    res.status(500).json({ error: 'Failed to save skill' });
  }
});

// PUT /api/user-skills/:id
router.put('/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const {
      skill_name, category, hourly_rate,
      description, years_exp, is_available,
    } = req.body;

    const result = await pool.query(
      `UPDATE user_skills
          SET skill_name   = COALESCE($1, skill_name),
              category     = COALESCE($2, category),
              hourly_rate  = $3,
              description  = COALESCE($4, description),
              years_exp    = $5,
              is_available = COALESCE($6, is_available),
              updated_at   = NOW()
        WHERE id = $7 AND user_id = $8
        RETURNING *`,
      [
        skill_name?.trim() || null,
        category?.trim() || null,
        hourly_rate !== undefined ? (hourly_rate ? parseFloat(hourly_rate) : null) : undefined,
        description?.trim() || null,
        years_exp !== undefined && years_exp !== '' ? parseInt(years_exp) : null,
        is_available !== undefined ? is_available : null,
        id,
        req.user.id,
      ]
    );

    if (!result.rows.length) {
      return res.status(404).json({ error: 'Skill not found' });
    }
    res.json({ skill: result.rows[0] });
  } catch (err) {
    require('../utils/logger').error('[userSkills] update error:', err.message);
    res.status(500).json({ error: 'Failed to update skill' });
  }
});

// DELETE /api/user-skills/:id
router.delete('/:id', authenticate, async (req, res) => {
  try {
    const result = await pool.query(
      `DELETE FROM user_skills WHERE id = $1 AND user_id = $2 RETURNING id`,
      [req.params.id, req.user.id]
    );
    if (!result.rows.length) {
      return res.status(404).json({ error: 'Skill not found' });
    }
    res.json({ deleted: true });
  } catch (err) {
    require('../utils/logger').error('[userSkills] delete error:', err.message);
    res.status(500).json({ error: 'Failed to delete skill' });
  }
});

module.exports = router;
