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

router.get('/helpers/search', async (req, res, next) => {
  try {
    const rawQuery = String(req.query.q || '').trim().toLowerCase();
    const limit = Math.min(20, Math.max(1, parseInt(req.query.limit, 10) || 20));

    if (!rawQuery) {
      return res.json({ helpers: [] });
    }

    const searchLike = `%${rawQuery}%`;
    const { rows } = await pool.query(
      `SELECT
         u.id,
         u.first_name,
         u.last_name,
         hp.bio_short AS bio,
         hp.service_city AS city,
         COALESCE(hp.avg_rating, 0) AS rating,
         COALESCE(hp.is_identity_verified, FALSE) AS is_verified,
         COALESCE(skill_match.skill_name, primary_skill.skill_name) AS primary_skill
       FROM users u
       LEFT JOIN helper_profiles hp ON hp.user_id = u.id
       LEFT JOIN LATERAL (
         SELECT hs.skill_name
           FROM helper_skills hs
          WHERE hs.user_id = u.id
          ORDER BY hs.skill_id NULLS LAST, hs.id
          LIMIT 1
       ) primary_skill ON TRUE
       LEFT JOIN LATERAL (
         SELECT hs.skill_name
           FROM helper_skills hs
          WHERE hs.user_id = u.id
            AND LOWER(hs.skill_name) LIKE $1
          ORDER BY hs.skill_id NULLS LAST, hs.id
          LIMIT 1
       ) skill_match ON TRUE
       WHERE u.deleted_at IS NULL
         AND u.is_active = TRUE
         AND u.role = ANY($2::text[])
         AND u.email_verified = TRUE
         AND u.onboarding_completed = TRUE
         AND COALESCE(hp.is_listed, TRUE) = TRUE
         AND COALESCE(hp.is_hidden_by_admin, FALSE) = FALSE
         AND (
           LOWER(TRIM(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, ''))) LIKE $1
           OR LOWER(COALESCE(hp.bio_short, '')) LIKE $1
           OR LOWER(COALESCE(hp.profile_headline, '')) LIKE $1
           OR LOWER(COALESCE(hp.service_city, '')) LIKE $1
           OR skill_match.skill_name IS NOT NULL
         )
       ORDER BY
         COALESCE(hp.search_rank_boost, 0) DESC,
         COALESCE(hp.avg_rating, 0) DESC,
         COALESCE(hp.total_reviews, 0) DESC,
         u.created_at DESC
       LIMIT $3`,
      [searchLike, ['helper', 'helper_pro', 'broker'], limit]
    );

    const helpers = rows.map((row) => ({
      id: String(row.id),
      firstName: row.first_name || null,
      lastName: row.last_name || null,
      bio: row.bio || null,
      city: row.city || null,
      rating: row.rating === null || row.rating === undefined ? null : Number(row.rating),
      primarySkill: row.primary_skill || null,
      isVerified: Boolean(row.is_verified),
    }));

    return res.json({ helpers });
  } catch (err) {
    next(err);
  }
});

router.get('/:id/profile', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT
         u.id, u.first_name, u.last_name, u.created_at,
         hp.bio_short AS bio,
         hp.service_city AS city,
         hp.service_state AS state,
         hp.jobs_completed,
         COALESCE(
           json_agg(DISTINCT hs.skill_name) FILTER (WHERE hs.skill_name IS NOT NULL),
           '[]'
         ) AS skills
       FROM users u
       LEFT JOIN helper_profiles hp ON hp.user_id = u.id
       LEFT JOIN helper_skills hs ON hs.user_id = u.id
       WHERE u.id = $1
         AND u.deleted_at IS NULL
         AND u.is_active = TRUE
         AND u.email_verified = TRUE
         AND u.onboarding_completed = TRUE
         AND u.role = ANY($2::text[])
         AND COALESCE(hp.is_listed, TRUE) = TRUE
         AND COALESCE(hp.is_hidden_by_admin, FALSE) = FALSE
       GROUP BY u.id, hp.bio_short, hp.service_city, hp.service_state, hp.service_zip, hp.jobs_completed`,
      [req.params.id, ['helper', 'helper_pro', 'broker']]
    );
    if (!rows.length) return res.status(404).json({ error: 'Profile not found' });
    return res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

router.use(errorHandler);

module.exports = router;
