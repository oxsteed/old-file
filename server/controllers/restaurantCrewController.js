'use strict';

const pool = require('../db');
const { AppError } = require('../middleware/errorHandler');
const { withTransaction } = require('../utils/transaction');

function parsePositiveInt(value) {
  const n = Number.parseInt(value, 10);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function normalizeString(value, max = 255) {
  if (value === undefined || value === null) return null;
  const s = String(value).trim();
  if (!s) return null;
  return s.slice(0, max);
}

function asBool(value, fallback = false) {
  if (value === undefined || value === null) return fallback;
  if (typeof value === 'boolean') return value;
  if (value === 'true' || value === 1 || value === '1') return true;
  if (value === 'false' || value === 0 || value === '0') return false;
  return fallback;
}

function parsePercent(value, field = 'scorePercent') {
  const n = Number.parseInt(value, 10);
  if (!Number.isInteger(n) || n < 0 || n > 100) {
    throw new AppError('Validation failed', 400, 'validation_failed', { [field]: 'Must be an integer from 0 to 100' });
  }
  return n;
}

function parseNonNegativeInt(value, field = 'attempts', fallback = 0) {
  if (value === undefined || value === null || value === '') return fallback;
  const n = Number.parseInt(value, 10);
  if (!Number.isInteger(n) || n < 0) {
    throw new AppError('Validation failed', 400, 'validation_failed', { [field]: 'Must be a non-negative integer' });
  }
  return n;
}

const MANAGE_ROLES = new Set(['owner', 'manager']);

async function requireRestaurantAccess(userId, restaurantId) {
  if (!restaurantId) throw new AppError('Restaurant not found', 404, 'restaurant_not_found');
  const { rows } = await pool.query(
    `SELECT fr.id, fr.business_id,
            CASE
              WHEN b.user_id = $2 OR fr.owner_user_id = $2 THEN 'owner'
              ELSE (
                SELECT bm.role
                  FROM business_members bm
                 WHERE bm.business_id = fr.business_id
                   AND bm.member_id = $2
                   AND bm.status = 'active'
                 LIMIT 1
              )
            END AS effective_role
       FROM food_restaurants fr
       JOIN businesses b ON b.id = fr.business_id
      WHERE fr.id = $1`,
    [restaurantId, userId]
  );
  const restaurant = rows[0];
  if (!restaurant || !restaurant.effective_role) {
    throw new AppError('Restaurant not found', 404, 'restaurant_not_found');
  }
  return restaurant;
}

function assertManage(restaurant) {
  if (!MANAGE_ROLES.has(restaurant.effective_role)) {
    throw new AppError('You do not have permission to manage this restaurant', 403, 'forbidden');
  }
}

function defaultTrainingSeed(userId) {
  return {
    modules: [
      { title: 'Opening line check', role: 'Cashier', durationMinutes: 10, isComplete: true },
      { title: 'Allergen handoff protocol', role: 'Kitchen', durationMinutes: 14, isComplete: false },
      { title: 'Refund and void policy', role: 'Manager', durationMinutes: 8, isComplete: false },
      { title: 'Drive-thru greeting script', role: 'Cashier', durationMinutes: 6, isComplete: false },
      { title: 'Expo packaging accuracy', role: 'Kitchen', durationMinutes: 12, isComplete: true },
      { title: 'Guest recovery and escalation', role: 'Manager', durationMinutes: 9, isComplete: true },
    ],
    quizzes: [
      { title: 'Allergen protocol quiz', scorePercent: 92, attempts: 1, passed: true },
      { title: 'Refund and void quiz', scorePercent: 78, attempts: 2, passed: false },
      { title: 'Cleaning closeout quiz', scorePercent: 88, attempts: 1, passed: true },
    ],
    badges: [
      { title: 'Opening Certified', detail: 'Can independently run pre-shift setup.', awarded: true },
      { title: 'Food Safety Ready', detail: 'Passed sanitation and temp-control checks.', awarded: true },
      { title: 'Trainer Candidate', detail: 'Eligible to coach new crew members.', awarded: false },
    ],
    userId,
  };
}

async function loadDashboard(restaurantId) {
  const [modulesRes, quizzesRes, badgesRes] = await Promise.all([
    pool.query(
      `SELECT * FROM restaurant_crew_training_modules
        WHERE restaurant_id = $1
        ORDER BY sort_order ASC, id ASC`,
      [restaurantId]
    ),
    pool.query(
      `SELECT * FROM restaurant_crew_quiz_results
        WHERE restaurant_id = $1
        ORDER BY created_at DESC, id DESC`,
      [restaurantId]
    ),
    pool.query(
      `SELECT * FROM restaurant_crew_badges
        WHERE restaurant_id = $1
        ORDER BY id ASC`,
      [restaurantId]
    ),
  ]);
  return {
    modules: modulesRes.rows,
    quizzes: quizzesRes.rows,
    badges: badgesRes.rows,
  };
}

exports.getDashboard = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    await requireRestaurantAccess(req.user.id, restaurantId);
    res.json(await loadDashboard(restaurantId));
  } catch (err) {
    next(err);
  }
};

exports.bootstrapDefaults = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    const restaurant = await requireRestaurantAccess(req.user.id, restaurantId);
    assertManage(restaurant);

    await withTransaction(async (client) => {
      const [moduleCount, quizCount, badgeCount] = await Promise.all([
        client.query(`SELECT COUNT(*)::int AS count FROM restaurant_crew_training_modules WHERE restaurant_id = $1`, [restaurantId]),
        client.query(`SELECT COUNT(*)::int AS count FROM restaurant_crew_quiz_results WHERE restaurant_id = $1`, [restaurantId]),
        client.query(`SELECT COUNT(*)::int AS count FROM restaurant_crew_badges WHERE restaurant_id = $1`, [restaurantId]),
      ]);
      if (moduleCount.rows[0].count || quizCount.rows[0].count || badgeCount.rows[0].count) return;

      const seed = defaultTrainingSeed(req.user.id);
      let sortOrder = 0;
      for (const module of seed.modules) {
        await client.query(
          `INSERT INTO restaurant_crew_training_modules
             (restaurant_id, title, role, duration_minutes, is_complete, sort_order, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [restaurantId, module.title, module.role, module.durationMinutes, module.isComplete, sortOrder++, req.user.id]
        );
      }
      for (const quiz of seed.quizzes) {
        await client.query(
          `INSERT INTO restaurant_crew_quiz_results
             (restaurant_id, title, score_percent, attempts, passed, created_by)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [restaurantId, quiz.title, quiz.scorePercent, quiz.attempts, quiz.passed, req.user.id]
        );
      }
      for (const badge of seed.badges) {
        await client.query(
          `INSERT INTO restaurant_crew_badges
             (restaurant_id, title, detail, awarded, created_by)
           VALUES ($1,$2,$3,$4,$5)`,
          [restaurantId, badge.title, badge.detail, badge.awarded, req.user.id]
        );
      }
    });

    res.json(await loadDashboard(restaurantId));
  } catch (err) {
    next(err);
  }
};

exports.createModule = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    const restaurant = await requireRestaurantAccess(req.user.id, restaurantId);
    assertManage(restaurant);

    const title = normalizeString(req.body.title, 200);
    const role = normalizeString(req.body.role, 80);
    if (!title) throw new AppError('Validation failed', 400, 'validation_failed', { title: 'Title is required' });
    if (!role) throw new AppError('Validation failed', 400, 'validation_failed', { role: 'Role is required' });

    const durationMinutes = parseNonNegativeInt(req.body.durationMinutes, 'durationMinutes');
    const sortOrder = parseNonNegativeInt(req.body.sortOrder, 'sortOrder');

    const { rows: [module] } = await pool.query(
      `INSERT INTO restaurant_crew_training_modules
         (restaurant_id, title, role, duration_minutes, is_complete, sort_order, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING *`,
      [restaurantId, title, role, durationMinutes, asBool(req.body.isComplete), sortOrder, req.user.id]
    );
    res.status(201).json({ module });
  } catch (err) {
    next(err);
  }
};

exports.updateModule = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    const moduleId = parsePositiveInt(req.params.moduleId);
    await requireRestaurantAccess(req.user.id, restaurantId);

    const sets = [];
    const vals = [];
    let i = 1;
    if (req.body.title !== undefined) {
      const title = normalizeString(req.body.title, 200);
      if (!title) throw new AppError('Validation failed', 400, 'validation_failed', { title: 'Title is required' });
      sets.push(`title = $${i++}`); vals.push(title);
    }
    if (req.body.role !== undefined) {
      const role = normalizeString(req.body.role, 80);
      if (!role) throw new AppError('Validation failed', 400, 'validation_failed', { role: 'Role is required' });
      sets.push(`role = $${i++}`); vals.push(role);
    }
    if (req.body.durationMinutes !== undefined) { sets.push(`duration_minutes = $${i++}`); vals.push(parseNonNegativeInt(req.body.durationMinutes, 'durationMinutes')); }
    if (req.body.isComplete !== undefined) { sets.push(`is_complete = $${i++}`); vals.push(asBool(req.body.isComplete)); }
    if (req.body.sortOrder !== undefined) { sets.push(`sort_order = $${i++}`); vals.push(parseNonNegativeInt(req.body.sortOrder, 'sortOrder')); }
    if (!sets.length) throw new AppError('No updatable fields provided', 400, 'validation_failed', { body: 'No updatable fields provided' });
    sets.push('updated_at = NOW()');

    const { rows: [module] } = await pool.query(
      `UPDATE restaurant_crew_training_modules SET ${sets.join(', ')}
        WHERE id = $${i++} AND restaurant_id = $${i}
        RETURNING *`,
      [...vals, moduleId, restaurantId]
    );
    if (!module) throw new AppError('Training module not found', 404, 'crew_training_module_not_found');
    res.json({ module });
  } catch (err) {
    next(err);
  }
};

exports.createQuizResult = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    const restaurant = await requireRestaurantAccess(req.user.id, restaurantId);
    assertManage(restaurant);

    const title = normalizeString(req.body.title, 200);
    if (!title) throw new AppError('Validation failed', 400, 'validation_failed', { title: 'Title is required' });

    const { rows: [quiz] } = await pool.query(
      `INSERT INTO restaurant_crew_quiz_results
         (restaurant_id, title, score_percent, attempts, passed, created_by)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING *`,
      [
        restaurantId,
        title,
        parsePercent(req.body.scorePercent),
        parseNonNegativeInt(req.body.attempts, 'attempts', 1),
        asBool(req.body.passed),
        req.user.id,
      ]
    );
    res.status(201).json({ quiz });
  } catch (err) {
    next(err);
  }
};

exports.upsertBadge = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    const restaurant = await requireRestaurantAccess(req.user.id, restaurantId);
    assertManage(restaurant);

    const title = normalizeString(req.body.title, 160);
    const detail = normalizeString(req.body.detail, 1000);
    if (!title) throw new AppError('Validation failed', 400, 'validation_failed', { title: 'Title is required' });
    if (!detail) throw new AppError('Validation failed', 400, 'validation_failed', { detail: 'Detail is required' });

    const badgeId = parsePositiveInt(req.params.badgeId);
    let badge;
    if (badgeId) {
      const { rows } = await pool.query(
        `UPDATE restaurant_crew_badges
            SET title = $1, detail = $2, awarded = $3, updated_at = NOW()
          WHERE id = $4 AND restaurant_id = $5
          RETURNING *`,
        [title, detail, asBool(req.body.awarded), badgeId, restaurantId]
      );
      badge = rows[0];
      if (!badge) throw new AppError('Badge not found', 404, 'crew_badge_not_found');
    } else {
      const { rows } = await pool.query(
        `INSERT INTO restaurant_crew_badges
           (restaurant_id, title, detail, awarded, created_by)
         VALUES ($1,$2,$3,$4,$5)
         RETURNING *`,
        [restaurantId, title, detail, asBool(req.body.awarded), req.user.id]
      );
      badge = rows[0];
    }
    res.json({ badge });
  } catch (err) {
    next(err);
  }
};
