// Phase 2 - Users routes
// OxSteed v2

const express = require('express');
const router = express.Router();

const { authenticate } = require('../middleware/auth');
const { errorHandler } = require('../middleware/errorHandler');
const { getMe, updateProfile } = require('../controllers/authController');
const pool = require('../db');

router.get('/me', authenticate, getMe);
router.patch('/me', authenticate, updateProfile);

router.get('/:id/profile', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT
         u.id, u.first_name, u.last_name, u.created_at,
         hp.bio_short AS bio,
         hp.service_city AS city,
         hp.service_state AS state,
         hp.service_zip AS zip_code,
         hp.jobs_completed,
         COALESCE(
           json_agg(DISTINCT hs.skill_name) FILTER (WHERE hs.skill_name IS NOT NULL),
           '[]'
         ) AS skills
       FROM users u
       LEFT JOIN helper_profiles hp ON hp.user_id = u.id
       LEFT JOIN helper_skills hs ON hs.user_id = u.id
       WHERE u.id = $1 AND u.deleted_at IS NULL AND u.is_active = TRUE
       GROUP BY u.id, hp.bio_short, hp.service_city, hp.service_state, hp.service_zip, hp.jobs_completed`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Profile not found' });
    return res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

router.use(errorHandler);

module.exports = router;
