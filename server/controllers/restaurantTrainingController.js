// OxSteed Restaurants — Staff training (franchise system).
// Modules (lessons + quizzes), assignments to staff, and completions.
// Access model mirrors restaurantOpsController: owner/manager author and
// assign; any active member can view modules and complete their own
// assignments. Quiz answers (correct_index) are only exposed to managers.

const pool = require('../db');
const { AppError } = require('../middleware/errorHandler');

const TRAINING_CATEGORIES = ['general', 'kitchen', 'front_of_house', 'cleaning', 'food_safety', 'customer_service', 'safety'];
const ASSIGNMENT_STATUSES = ['assigned', 'in_progress', 'completed', 'overdue'];
const MANAGE_ROLES = new Set(['owner', 'manager']);

function parsePositiveInt(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

// Identical access query to restaurantOpsController.requireRestaurantAccess.
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

function sanitizeModule(row, isManager) {
  const questions = (row.questions || []).map((q) => {
    const base = { id: q.id, question: q.question, options: q.options || [], sort_order: q.sort_order };
    if (isManager) base.correct_index = q.correct_index;
    return base;
  });
  return { ...row, questions };
}

async function loadModules(restaurantId, isManager) {
  const { rows: modules } = await pool.query(
    `SELECT * FROM restaurant_training_modules
      WHERE restaurant_id = $1
      ORDER BY is_active DESC, sort_order ASC, id ASC`,
    [restaurantId]
  );
  const ids = modules.map((m) => m.id);
  let questionsByModule = {};
  if (ids.length) {
    const { rows: questions } = await pool.query(
      `SELECT * FROM restaurant_training_questions
        WHERE module_id = ANY($1::bigint[])
        ORDER BY sort_order ASC, id ASC`,
      [ids]
    );
    questionsByModule = questions.reduce((acc, q) => {
      (acc[q.module_id] ||= []).push(q);
      return acc;
    }, {});
  }
  return modules.map((m) => sanitizeModule({ ...m, questions: questionsByModule[m.id] || [] }, isManager));
}

// ── Modules ──────────────────────────────────────────────────────────────────
exports.listModules = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    const restaurant = await requireRestaurantAccess(req.user.id, restaurantId);
    const isManager = MANAGE_ROLES.has(restaurant.effective_role);
    res.json({ modules: await loadModules(restaurantId, isManager) });
  } catch (err) {
    next(err);
  }
};

exports.createModule = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    const restaurant = await requireRestaurantAccess(req.user.id, restaurantId);
    assertManage(restaurant);
    const { title, description, content, category, passScorePct, questions } = req.body || {};
    if (!title || !String(title).trim()) throw new AppError('Title is required', 400, 'title_required');
    if (category && !TRAINING_CATEGORIES.includes(category)) throw new AppError('Invalid category', 400, 'invalid_category');
    const pass = passScorePct == null ? 80 : Number(passScorePct);
    if (!Number.isInteger(pass) || pass < 0 || pass > 100) throw new AppError('Pass score must be 0-100', 400, 'invalid_pass_score');

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows: [module] } = await client.query(
        `INSERT INTO restaurant_training_modules
           (restaurant_id, title, description, content, category, pass_score_pct, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING *`,
        [restaurantId, String(title).trim(), description || null, content || null, category || 'general', pass, req.user.id]
      );
      const created = await insertQuestions(client, module.id, questions);
      await client.query('COMMIT');
      res.status(201).json({ module: sanitizeModule({ ...module, questions: created }, true) });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    next(err);
  }
};

async function insertQuestions(client, moduleId, questions) {
  const list = Array.isArray(questions) ? questions : [];
  const created = [];
  for (let i = 0; i < list.length; i += 1) {
    const q = list[i] || {};
    const options = Array.isArray(q.options) ? q.options.map((o) => String(o)).filter((o) => o.trim()) : [];
    if (!q.question || !String(q.question).trim() || options.length < 2) continue;
    const correct = Number.isInteger(q.correct_index) ? q.correct_index : 0;
    const { rows: [row] } = await client.query(
      `INSERT INTO restaurant_training_questions
         (module_id, question, options, correct_index, sort_order)
       VALUES ($1, $2, $3::jsonb, $4, $5)
       RETURNING *`,
      [moduleId, String(q.question).trim(), JSON.stringify(options), Math.min(Math.max(correct, 0), options.length - 1), i]
    );
    created.push(row);
  }
  return created;
}

exports.updateModule = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    const moduleId = parsePositiveInt(req.params.moduleId);
    const restaurant = await requireRestaurantAccess(req.user.id, restaurantId);
    assertManage(restaurant);
    const { title, description, content, category, passScorePct, isActive, questions } = req.body || {};
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows: [existing] } = await client.query(
        `SELECT * FROM restaurant_training_modules WHERE id = $1 AND restaurant_id = $2`,
        [moduleId, restaurantId]
      );
      if (!existing) throw new AppError('Training module not found', 404, 'module_not_found');
      if (category && !TRAINING_CATEGORIES.includes(category)) throw new AppError('Invalid category', 400, 'invalid_category');
      const { rows: [module] } = await client.query(
        `UPDATE restaurant_training_modules
            SET title = COALESCE($3, title),
                description = $4,
                content = $5,
                category = COALESCE($6, category),
                pass_score_pct = COALESCE($7, pass_score_pct),
                is_active = COALESCE($8, is_active),
                updated_at = NOW()
          WHERE id = $1 AND restaurant_id = $2
          RETURNING *`,
        [
          moduleId, restaurantId,
          title && String(title).trim() ? String(title).trim() : null,
          description === undefined ? existing.description : description,
          content === undefined ? existing.content : content,
          category || null,
          passScorePct == null ? null : Number(passScorePct),
          isActive == null ? null : Boolean(isActive),
        ]
      );
      let created = null;
      if (Array.isArray(questions)) {
        await client.query(`DELETE FROM restaurant_training_questions WHERE module_id = $1`, [moduleId]);
        created = await insertQuestions(client, moduleId, questions);
      }
      await client.query('COMMIT');
      const withQuestions = created
        ? sanitizeModule({ ...module, questions: created }, true)
        : (await loadModules(restaurantId, true)).find((m) => m.id === moduleId);
      res.json({ module: withQuestions });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    next(err);
  }
};

exports.deleteModule = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    const moduleId = parsePositiveInt(req.params.moduleId);
    const restaurant = await requireRestaurantAccess(req.user.id, restaurantId);
    assertManage(restaurant);
    const { rowCount } = await pool.query(
      `DELETE FROM restaurant_training_modules WHERE id = $1 AND restaurant_id = $2`,
      [moduleId, restaurantId]
    );
    if (!rowCount) throw new AppError('Training module not found', 404, 'module_not_found');
    res.json({ deleted: true });
  } catch (err) {
    next(err);
  }
};

// ── Staff (assignment picker) ────────────────────────────────────────────────
exports.listStaff = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    const restaurant = await requireRestaurantAccess(req.user.id, restaurantId);
    assertManage(restaurant);
    const { rows } = await pool.query(
      `SELECT u.id AS user_id, u.first_name, u.last_name, bm.role
         FROM business_members bm
         JOIN users u ON u.id = bm.member_id
        WHERE bm.business_id = $1 AND bm.status = 'active'
        ORDER BY bm.role, u.first_name, u.last_name`,
      [restaurant.business_id]
    );
    res.json({ staff: rows });
  } catch (err) {
    next(err);
  }
};

// ── Assignments ──────────────────────────────────────────────────────────────
exports.assignModule = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    const moduleId = parsePositiveInt(req.params.moduleId);
    const restaurant = await requireRestaurantAccess(req.user.id, restaurantId);
    assertManage(restaurant);
    const { userId, dueAt } = req.body || {};
    if (!userId) throw new AppError('userId is required', 400, 'user_required');
    const { rows: [module] } = await pool.query(
      `SELECT id FROM restaurant_training_modules WHERE id = $1 AND restaurant_id = $2`,
      [moduleId, restaurantId]
    );
    if (!module) throw new AppError('Training module not found', 404, 'module_not_found');
    // The assignee must belong to the restaurant's business.
    const { rows: [member] } = await pool.query(
      `SELECT 1 FROM business_members
        WHERE business_id = $1 AND member_id = $2 AND status = 'active'`,
      [restaurant.business_id, userId]
    );
    if (!member) throw new AppError('Staff member not found', 404, 'staff_not_found');
    const { rows: [assignment] } = await pool.query(
      `INSERT INTO restaurant_training_assignments
         (module_id, restaurant_id, user_id, assigned_by, due_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (module_id, user_id)
       DO UPDATE SET due_at = EXCLUDED.due_at, assigned_by = EXCLUDED.assigned_by,
                     status = CASE WHEN restaurant_training_assignments.status = 'completed'
                                   THEN 'completed' ELSE 'assigned' END,
                     updated_at = NOW()
       RETURNING *`,
      [moduleId, restaurantId, userId, req.user.id, dueAt || null]
    );
    res.status(201).json({ assignment });
  } catch (err) {
    next(err);
  }
};

exports.listAssignments = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    const restaurant = await requireRestaurantAccess(req.user.id, restaurantId);
    const isManager = MANAGE_ROLES.has(restaurant.effective_role);
    const mineOnly = req.query.mine === '1' || !isManager;
    const { rows } = await pool.query(
      `SELECT a.*, m.title AS module_title, m.pass_score_pct,
              u.first_name, u.last_name,
              c.score_pct, c.passed, c.completed_at
         FROM restaurant_training_assignments a
         JOIN restaurant_training_modules m ON m.id = a.module_id
         JOIN users u ON u.id = a.user_id
         LEFT JOIN restaurant_training_completions c ON c.assignment_id = a.id
        WHERE a.restaurant_id = $1 ${mineOnly ? 'AND a.user_id = $2' : ''}
        ORDER BY a.created_at DESC`,
      mineOnly ? [restaurantId, req.user.id] : [restaurantId]
    );
    res.json({ assignments: rows });
  } catch (err) {
    next(err);
  }
};

exports.startAssignment = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    const assignmentId = parsePositiveInt(req.params.assignmentId);
    await requireRestaurantAccess(req.user.id, restaurantId);
    const { rows: [assignment] } = await pool.query(
      `UPDATE restaurant_training_assignments
          SET status = 'in_progress', updated_at = NOW()
        WHERE id = $1 AND restaurant_id = $2 AND user_id = $3 AND status = 'assigned'
        RETURNING *`,
      [assignmentId, restaurantId, req.user.id]
    );
    if (!assignment) throw new AppError('Assignment not found', 404, 'assignment_not_found');
    res.json({ assignment });
  } catch (err) {
    next(err);
  }
};

// Submit quiz answers for your own assignment. Scored transactionally: the
// completion row and the assignment status flip together.
exports.submitQuiz = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    const assignmentId = parsePositiveInt(req.params.assignmentId);
    await requireRestaurantAccess(req.user.id, restaurantId);
    const { answers } = req.body || {};
    if (!Array.isArray(answers)) throw new AppError('answers must be an array', 400, 'answers_required');

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows: [assignment] } = await client.query(
        `SELECT a.*, m.pass_score_pct
           FROM restaurant_training_assignments a
           JOIN restaurant_training_modules m ON m.id = a.module_id
          WHERE a.id = $1 AND a.restaurant_id = $2 AND a.user_id = $3
          FOR UPDATE`,
        [assignmentId, restaurantId, req.user.id]
      );
      if (!assignment) throw new AppError('Assignment not found', 404, 'assignment_not_found');
      if (assignment.status === 'completed') throw new AppError('Already completed', 409, 'already_completed');
      const { rows: questions } = await client.query(
        `SELECT correct_index FROM restaurant_training_questions
          WHERE module_id = $1 ORDER BY sort_order ASC, id ASC`,
        [assignment.module_id]
      );
      let correct = 0;
      questions.forEach((q, i) => {
        if (Number(answers[i]) === q.correct_index) correct += 1;
      });
      const scorePct = questions.length ? Math.round((correct / questions.length) * 100) : 100;
      const passed = scorePct >= assignment.pass_score_pct;
      const { rows: [completion] } = await client.query(
        `INSERT INTO restaurant_training_completions (assignment_id, score_pct, passed, answers)
         VALUES ($1, $2, $3, $4::jsonb)
         ON CONFLICT (assignment_id) DO NOTHING
         RETURNING *`,
        [assignmentId, scorePct, passed, JSON.stringify(answers.map((a) => Number(a) || 0))]
      );
      if (!completion) throw new AppError('Already completed', 409, 'already_completed');
      await client.query(
        `UPDATE restaurant_training_assignments
            SET status = 'completed', updated_at = NOW()
          WHERE id = $1`,
        [assignmentId]
      );
      await client.query('COMMIT');
      res.json({ completion, passed, scorePct });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    next(err);
  }
};

exports.listCompletions = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    const restaurant = await requireRestaurantAccess(req.user.id, restaurantId);
    assertManage(restaurant);
    const { rows } = await pool.query(
      `SELECT c.*, m.title AS module_title, u.first_name, u.last_name, a.due_at
         FROM restaurant_training_completions c
         JOIN restaurant_training_assignments a ON a.id = c.assignment_id
         JOIN restaurant_training_modules m ON m.id = a.module_id
         JOIN users u ON u.id = a.user_id
        WHERE a.restaurant_id = $1
        ORDER BY c.completed_at DESC
        LIMIT 200`,
      [restaurantId]
    );
    res.json({ completions: rows });
  } catch (err) {
    next(err);
  }
};

exports.trainingCategories = TRAINING_CATEGORIES;
exports.assignmentStatuses = ASSIGNMENT_STATUSES;
