'use strict';

const pool = require('../db');
const { AppError } = require('../middleware/errorHandler');
const { resolveRestaurantAccess } = require('../services/scopeModel');
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

// Canonical restaurant access gate (analytics scope model, Phase 1 Item 6).
// The fast-fail `!restaurantId` guard is preserved here (not inside the
// shared gate) so invalid ids keep this module's exact 404 behavior.
async function requireRestaurantAccess(userId, restaurantId) {
  if (!restaurantId) throw new AppError('Restaurant not found', 404, 'restaurant_not_found');
  return resolveRestaurantAccess(userId, restaurantId);
}

function assertManage(restaurant) {
  if (!MANAGE_ROLES.has(restaurant.effective_role)) {
    throw new AppError('You do not have permission to manage this restaurant', 403, 'forbidden');
  }
}

function defaultTrainingSeed(userId) {
  // S-13: seed templates only — never a completed/passed/awarded state.
  // The old seed marked modules complete, quizzes passed and badges
  // "awarded" for the whole restaurant, which reads as real compliance
  // evidence to a franchisor or inspector. Migration 667's per-person
  // training is where completions actually live.
  return {
    modules: [
      { title: 'Opening line check', role: 'Cashier', durationMinutes: 10, isComplete: false },
      { title: 'Allergen handoff protocol', role: 'Kitchen', durationMinutes: 14, isComplete: false },
      { title: 'Refund and void policy', role: 'Manager', durationMinutes: 8, isComplete: false },
      { title: 'Drive-thru greeting script', role: 'Cashier', durationMinutes: 6, isComplete: false },
      { title: 'Expo packaging accuracy', role: 'Kitchen', durationMinutes: 12, isComplete: false },
      { title: 'Guest recovery and escalation', role: 'Manager', durationMinutes: 9, isComplete: false },
    ],
    quizzes: [
      { title: 'Allergen protocol quiz', scorePercent: 0, attempts: 0, passed: false },
      { title: 'Refund and void quiz', scorePercent: 0, attempts: 0, passed: false },
      { title: 'Cleaning closeout quiz', scorePercent: 0, attempts: 0, passed: false },
    ],
    badges: [
      { title: 'Opening Certified', detail: 'Can independently run pre-shift setup.', awarded: false },
      { title: 'Food Safety Ready', detail: 'Passed sanitation and temp-control checks.', awarded: false },
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

    // NOTE: this call previously omitted the pool argument, so
    // withTransaction threw before seeding anything (S-13 track fix).
    await withTransaction(pool, async (client) => {
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
    // S-13: renaming a module or marking it complete is a manager action —
    // every other crew write in this controller asserts manage; this one
    // previously let any member (even a support agent) do it.
    const restaurant = await requireRestaurantAccess(req.user.id, restaurantId);
    assertManage(restaurant);

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
