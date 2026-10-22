// OxSteed Restaurants — Staff training (franchise system).
// Modules (lessons + quizzes), assignments to staff, and completions.
// Access model mirrors restaurantOpsController: owner/manager author and
// assign; any active member can view modules and complete their own
// assignments. Quiz answers (correct_index) are only exposed to managers.

const pool = require('../db');
const v = require('../utils/restaurantReviewValidation');
const { strictInteger } = require('../utils/strictInteger');
const { withTransaction } = require('../utils/transaction');
const { attachScope, requireBrand, assertStaff, staffPredicate } = require('../services/restaurantReviewScope');
const { AppError } = require('../middleware/errorHandler');
const { resolveRestaurantAccess } = require('../services/scopeModel');
const {
  MEMBER_ROLES,
  snapshotModuleVersion,
  notifyTrainingAssigned,
  applyAutoAssignRules,
} = require('../services/restaurantTrainingLifecycle');
const permissionsService = require('../services/permissionsService');
const { logBusinessAction } = require('../services/businessAuditLog');

const TRAINING_CATEGORIES = ['general', 'kitchen', 'front_of_house', 'cleaning', 'food_safety', 'customer_service', 'safety'];
const ASSIGNMENT_STATUSES = ['assigned', 'in_progress', 'completed', 'overdue'];

function parsePositiveInt(value) {
  return strictInteger(value);
}

// Identical access query to restaurantOpsController.requireRestaurantAccess.
// Canonical restaurant access gate (analytics scope model, Phase 1 Item 6).
// The fast-fail `!restaurantId` guard is preserved here (not inside the
// shared gate) so invalid ids keep this module's exact 404 behavior.
async function requireRestaurantAccess(userId, restaurantId) {
  if (!restaurantId) throw new AppError('Restaurant not found', 404, 'restaurant_not_found');
  return attachScope(await resolveRestaurantAccess(userId, restaurantId), userId);
}

// S-08: manage gates resolve through the permission catalog (role defaults
// + per-membership overrides) via permissionsService, the single resolver.
// MANAGE_PERMISSION_CODES reproduces the previous owner/manager-only gate
// for members without overrides; deny overrides now take effect here too.
const MANAGE_PERMISSION_CODES = ['crew.manage'];

async function assertManage(restaurant, userId, brand = true) {
  const allowed = await permissionsService.hasRestaurantPermission(restaurant, userId, MANAGE_PERMISSION_CODES);
  if (!allowed) {
    throw new AppError('You do not have permission to manage this restaurant', 403, 'forbidden');
  }
  if (brand) requireBrand(restaurant);
}

// Optional positive integer from a request body; undefined stays
// undefined (field not provided), null/invalid is a 400.
function parseBoundedInt(value, { min, max, code, label, allowNull = false }) {
  if (value === undefined) return undefined;
  if (value === null && allowNull) return null;
  const n = strictInteger(value, { min, max });
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new AppError(`${label} must be between ${min} and ${max}`, 400, code);
  }
  return n;
}

function sanitizeModule(row, isManager) {
  const questions = (row.questions || []).map((q) => {
    const base = { id: q.id, question: q.question, options: q.options || [], sort_order: q.sort_order };
    if (isManager) base.correct_index = q.correct_index;
    return base;
  });
  return { ...row, questions };
}

async function loadModules(restaurantId, isManager, db = pool) {
  const { rows: modules } = await db.query(
    `SELECT * FROM restaurant_training_modules
      WHERE restaurant_id = $1 AND archived_at IS NULL
      ORDER BY is_active DESC, sort_order ASC, id ASC`,
    [restaurantId]
  );
  const ids = modules.map((m) => m.id);
  let questionsByModule = {};
  if (ids.length) {
    const { rows: questions } = await db.query(
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
    const isManager = await permissionsService.hasRestaurantPermission(restaurant, req.user.id, ['crew.manage']);
    res.json({ modules: await loadModules(restaurantId, isManager) });
  } catch (err) {
    next(err);
  }
};

exports.createModule = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    const restaurant = await requireRestaurantAccess(req.user.id, restaurantId);
    await assertManage(restaurant, req.user.id);
    const { title, description, content, category, passScorePct, questions } = req.body || {};
    v.text(title, 'title', 200);
    v.text(description, 'description', 10000, { optional: true });
    v.text(content, 'content', 100000, { optional: true });
    normalizeQuestions(questions);
    if (category && !TRAINING_CATEGORIES.includes(category)) throw new AppError('Invalid category', 400, 'invalid_category');
    const pass = passScorePct === undefined ? 80 : v.integer(passScorePct, 'passScorePct', 0, 100);
    if (!Number.isInteger(pass) || pass < 0 || pass > 100) throw new AppError('Pass score must be 0-100', 400, 'invalid_pass_score');
    // S-12: recertification window + retake budget are part of the module.
    const validForDays = parseBoundedInt(req.body.validForDays, { min: 1, max: 3650, code: 'invalid_valid_for_days', label: 'Valid-for days', allowNull: true }) ?? null;
    const maxAttempts = parseBoundedInt(req.body.maxAttempts, { min: 1, max: 20, code: 'invalid_max_attempts', label: 'Max attempts' }) ?? 3;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows: [module] } = await client.query(
        `INSERT INTO restaurant_training_modules
           (restaurant_id, title, description, content, category, pass_score_pct, created_by, valid_for_days, max_attempts)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING *`,
        [restaurantId, String(title).trim(), description || null, content || null, category || 'general', pass, req.user.id, validForDays, maxAttempts]
      );
      const created = await insertQuestions(client, module.id, questions);
      // S-12: version 1 snapshot so completions can name the content taken.
      await snapshotModuleVersion(client, module, req.user.id);
      // S-16: module writes are auditable team events.
      await logBusinessAction(req, {
        action: 'restaurant.training_module.created',
        target_type: 'training_module',
        target_id: module.id,
        after_state: { title: module.title, category: module.category },
        business_id: restaurant.business_id,
        client, throwOnError: true,
      });
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

function normalizeQuestions(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 100) v.invalid('questions');
  return value.map((q) => {
    if (!q || typeof q !== 'object' || Array.isArray(q)) v.invalid('question');
    const question = v.text(q.question, 'question', 4000);
    if (!Array.isArray(q.options) || q.options.length < 2 || q.options.length > 10) v.invalid('options');
    const options = q.options.map((o) => v.text(o, 'option', 1000));
    if (new Set(options).size !== options.length) v.invalid('options');
    const correct_index = q.correct_index === undefined ? 0 : v.integer(q.correct_index, 'correct_index', 0, options.length - 1);
    return { question, options, correct_index };
  });
}
async function insertQuestions(client, moduleId, questions) {
  const list = normalizeQuestions(questions), created = [];
  for (const [index, q] of list.entries()) {
    const { rows: [row] } = await client.query(`INSERT INTO restaurant_training_questions(module_id,question,options,correct_index,sort_order)
      VALUES($1,$2,$3::jsonb,$4,$5) RETURNING *`, [moduleId,q.question,JSON.stringify(q.options),q.correct_index,index]);
    created.push(row);
  }
  return created;
}

exports.updateModule = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    const moduleId = parsePositiveInt(req.params.moduleId);
    const restaurant = await requireRestaurantAccess(req.user.id, restaurantId);
    await assertManage(restaurant, req.user.id);
    const { title, description, content, category, passScorePct, isActive, questions } = req.body || {};
    if (title !== undefined) v.text(title, 'title', 200);
    if (description !== undefined) v.text(description, 'description', 10000, { optional: true });
    if (content !== undefined) v.text(content, 'content', 100000, { optional: true });
    if (questions !== undefined) normalizeQuestions(questions);
    const validForDays = parseBoundedInt(req.body.validForDays, { min: 1, max: 3650, code: 'invalid_valid_for_days', label: 'Valid-for days', allowNull: true });
    const maxAttempts = parseBoundedInt(req.body.maxAttempts, { min: 1, max: 20, code: 'invalid_max_attempts', label: 'Max attempts' });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows: [existing] } = await client.query(
        `SELECT * FROM restaurant_training_modules WHERE id = $1 AND restaurant_id = $2 AND archived_at IS NULL FOR UPDATE`,
        [moduleId, restaurantId]
      );
      if (!existing) throw new AppError('Training module not found', 404, 'module_not_found');
      if (category && !TRAINING_CATEGORIES.includes(category)) throw new AppError('Invalid category', 400, 'invalid_category');
      // S-12: edits to teachable content (lesson, quiz, pass mark, title,
      // validity/attempt policy) create a new module version; pure
      // activation toggles do not.
      const contentChanged = [title, description, content, category, passScorePct, validForDays, maxAttempts]
        .some((v) => v !== undefined) || Array.isArray(questions);
      const { rows: [module] } = await client.query(
        `UPDATE restaurant_training_modules
            SET title = COALESCE($3, title),
                description = $4,
                content = $5,
                category = COALESCE($6, category),
                pass_score_pct = COALESCE($7, pass_score_pct),
                is_active = COALESCE($8, is_active),
                valid_for_days = $9,
                max_attempts = COALESCE($10, max_attempts),
                current_version = current_version + $11,
                updated_at = NOW()
          WHERE id = $1 AND restaurant_id = $2
          RETURNING *`,
        [
          moduleId, restaurantId,
          title && String(title).trim() ? String(title).trim() : null,
          description === undefined ? existing.description : description,
          content === undefined ? existing.content : content,
          category || null,
          passScorePct === undefined ? null : v.integer(passScorePct, 'passScorePct', 0, 100),
          isActive === undefined ? null : v.boolean(isActive, 'isActive'),
          validForDays === undefined ? existing.valid_for_days : validForDays,
          maxAttempts === undefined ? null : maxAttempts,
          contentChanged ? 1 : 0,
        ]
      );
      let created = null;
      if (Array.isArray(questions)) {
        await client.query(`DELETE FROM restaurant_training_questions WHERE module_id = $1`, [moduleId]);
        created = await insertQuestions(client, moduleId, questions);
      }
      if (contentChanged) {
        await snapshotModuleVersion(client, module, req.user.id);
      }
      // S-16: module writes are auditable team events.
      await logBusinessAction(req, {
        action: 'restaurant.training_module.updated',
        target_type: 'training_module',
        target_id: module.id,
        before_state: { title: existing.title, category: existing.category, pass_score_pct: existing.pass_score_pct },
        after_state: { title: module.title, category: module.category, pass_score_pct: module.pass_score_pct },
        business_id: restaurant.business_id,
        client, throwOnError: true,
      });
      const withQuestions = created
        ? sanitizeModule({ ...module, questions: created }, true)
        : (await loadModules(restaurantId, true, client)).find((m) => Number(m.id) === moduleId);
      await client.query('COMMIT');
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
    const moduleId = v.integer(req.params.moduleId, 'moduleId');
    const restaurant = await requireRestaurantAccess(req.user.id, restaurantId);
    await assertManage(restaurant, req.user.id);
    await withTransaction(pool, async (client) => {
      const { rows: [module] } = await client.query('UPDATE restaurant_training_modules SET is_active=FALSE,archived_at=NOW(),updated_at=NOW() WHERE id=$1 AND restaurant_id=$2 RETURNING *', [moduleId,restaurantId]);
      if (!module) throw new AppError('Training module not found',404,'module_not_found');
      await logBusinessAction(req, { client, throwOnError:true, business_id:restaurant.business_id,
        action:'restaurant.training_module.archived',target_type:'training_module',target_id:moduleId,
        after_state:{title:module.title,is_active:false} });
    }, 'training_module_archive');
    res.json({deleted:true});
  } catch (err) { next(err); }
};

// ── Staff (assignment picker) ────────────────────────────────────────────────
exports.listStaff = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    const restaurant = await requireRestaurantAccess(req.user.id, restaurantId);
    await assertManage(restaurant, req.user.id, false);
    const params = [restaurant.business_id];
    const scope = staffPredicate(restaurant, 'bm.member_id', params);
    const { rows } = await pool.query(
      `SELECT u.id AS user_id, u.first_name, u.last_name, bm.role
         FROM business_members bm
         JOIN users u ON u.id = bm.member_id
        WHERE bm.business_id = $1 AND bm.status = 'active'${scope}
        ORDER BY bm.role, u.first_name, u.last_name`,
      params
    );
    res.json({ staff: rows });
  } catch (err) {
    next(err);
  }
};

// ── Assignments ──────────────────────────────────────────────────────────────
exports.assignModule = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId), moduleId = v.integer(req.params.moduleId,'moduleId');
    const restaurant = await requireRestaurantAccess(req.user.id,restaurantId);
    await assertManage(restaurant,req.user.id,false);
    const userId = v.uuid(req.body?.userId,'userId'), dueAt = v.timestamp(req.body?.dueAt,'dueAt');
    const result = await withTransaction(pool,async(client)=>{
      const {rows:[module]}=await client.query('SELECT id,title FROM restaurant_training_modules WHERE id=$1 AND restaurant_id=$2 AND is_active=TRUE FOR SHARE',[moduleId,restaurantId]);
      if(!module)throw new AppError('Active training module not found',404,'module_not_found');
      await assertStaff(restaurant,userId,client);
      const stillValid = `EXISTS (SELECT 1 FROM restaurant_training_completions c
        WHERE c.assignment_id=restaurant_training_assignments.id AND c.passed=TRUE AND (c.expires_at IS NULL OR c.expires_at>NOW()))`;
      const {rows:[assignment]}=await client.query(`INSERT INTO restaurant_training_assignments(module_id,restaurant_id,user_id,assigned_by,due_at)
        VALUES($1,$2,$3,$4,$5) ON CONFLICT(module_id,user_id) DO UPDATE SET due_at=EXCLUDED.due_at,assigned_by=EXCLUDED.assigned_by,
        status=CASE WHEN ${stillValid} THEN 'completed' ELSE 'assigned' END,
        attempts_used=CASE WHEN ${stillValid} THEN restaurant_training_assignments.attempts_used ELSE 0 END,updated_at=NOW()
        RETURNING *,(xmax=0) AS inserted`,[moduleId,restaurantId,userId,req.user.id,dueAt]);
      await logBusinessAction(req,{client,throwOnError:true,business_id:restaurant.business_id,action:'restaurant.training.assigned',target_type:'training_assignment',target_id:assignment.id,after_state:assignment});
      return {module,assignment};
    },'training_assign');
    const {module,assignment}=result;
    if(assignment.status!=='completed'&&String(userId)!==String(req.user.id))await notifyTrainingAssigned(userId,{
      assignmentId:assignment.id,moduleId,moduleTitle:module.title,restaurantId,restaurantName:restaurant.display_name,
      dueAt:assignment.due_at,recertification:!assignment.inserted });
    res.status(201).json({assignment});
  }catch(err){next(err);}
};

exports.listAssignments = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    const restaurant = await requireRestaurantAccess(req.user.id, restaurantId);
    const isManager = await permissionsService.hasRestaurantPermission(restaurant, req.user.id, ['crew.manage']);
    const mineOnly = req.query.mine === '1' || !isManager;
    // S-12: completions are an attempts log now; surface only the latest
    // attempt per assignment, plus its version and validity expiry.
    const params = mineOnly ? [restaurantId,req.user.id] : [restaurantId];
    const scope = mineOnly ? '' : staffPredicate(restaurant,'a.user_id',params);
    const { rows } = await pool.query(
      `SELECT a.*, m.title AS module_title, m.pass_score_pct,
              m.max_attempts, m.valid_for_days, m.current_version,
              u.first_name, u.last_name,
              c.score_pct, c.passed, c.completed_at,
              c.module_version, c.attempt_number, c.expires_at AS completion_expires_at
         FROM restaurant_training_assignments a
         JOIN restaurant_training_modules m ON m.id = a.module_id
         JOIN users u ON u.id = a.user_id
         LEFT JOIN LATERAL (
           SELECT score_pct, passed, completed_at, module_version, attempt_number, expires_at
             FROM restaurant_training_completions
            WHERE assignment_id = a.id
            ORDER BY completed_at DESC, id DESC
            LIMIT 1
         ) c ON TRUE
        WHERE a.restaurant_id = $1 AND (m.archived_at IS NULL OR a.status='completed') ${mineOnly ? 'AND a.user_id = $2' : ''}${scope}
        ORDER BY a.created_at DESC`,
      params
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
        WHERE id = $1 AND restaurant_id = $2 AND user_id = $3 AND status IN ('assigned', 'overdue', 'in_progress')
          AND EXISTS (SELECT 1 FROM restaurant_training_modules m WHERE m.id=restaurant_training_assignments.module_id AND m.is_active=TRUE)
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
// attempt row and the assignment status flip together.
//
// S-12 semantics:
//  * A failed attempt is NOT final: it is logged, attempts_used grows, and
//    the assignment returns to 'assigned' so the staff member can retake.
//  * Attempts are capped by the module's max_attempts per cycle; a manager
//    re-assigning (or a recertification reset) restores the budget.
//  * Scoring uses the module's CURRENT version snapshot, and the attempt
//    records that version, so later content edits never rewrite history.
//  * A passing attempt stamps expires_at from valid_for_days; when it
//    elapses the assignment re-opens for recertification (nightly job, or
//    immediately here if the job has not run yet).
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
        `SELECT a.*, m.pass_score_pct, m.max_attempts, m.valid_for_days, m.current_version
           FROM restaurant_training_assignments a
           JOIN restaurant_training_modules m ON m.id = a.module_id
          WHERE a.id = $1 AND a.restaurant_id = $2 AND a.user_id = $3 AND m.is_active=TRUE
          FOR UPDATE OF a, m`,
        [assignmentId, restaurantId, req.user.id]
      );
      if (!assignment) throw new AppError('Assignment not found', 404, 'assignment_not_found');

      let attemptsUsed = assignment.attempts_used || 0;
      if (assignment.status === 'completed') {
        // Completed only blocks a retake while the pass is still valid.
        const { rows: [latestPass] } = await client.query(
          `SELECT expires_at FROM restaurant_training_completions
            WHERE assignment_id = $1 AND passed = TRUE
            ORDER BY completed_at DESC, id DESC
            LIMIT 1`,
          [assignmentId]
        );
        if (latestPass && (latestPass.expires_at === null || new Date(latestPass.expires_at) > new Date())) {
          throw new AppError('Already completed', 409, 'already_completed');
        }
        // Expired pass: this submit is a recertification cycle.
        attemptsUsed = 0;
      }
      if (attemptsUsed >= assignment.max_attempts) {
        throw new AppError('No attempts remaining for this assignment', 409, 'attempts_exhausted', {
          attemptsUsed, maxAttempts: assignment.max_attempts,
        });
      }

      // Score against the current version's snapshot (falls back to the
      // live questions for modules created before versioning shipped).
      const { rows: [version] } = await client.query(
        `SELECT questions FROM restaurant_training_module_versions
          WHERE module_id = $1 AND version = $2`,
        [assignment.module_id, assignment.current_version]
      );
      let questions = Array.isArray(version?.questions) ? version.questions : null;
      if (!questions) {
        const { rows: live } = await client.query(
          `SELECT correct_index,options FROM restaurant_training_questions
            WHERE module_id = $1 ORDER BY sort_order ASC, id ASC`,
          [assignment.module_id]
        );
        questions = live;
      }
      if (answers.length !== questions.length || answers.some((answer,i)=>typeof answer !== 'number' || !Number.isInteger(answer) || answer<0 || (Array.isArray(questions[i].options) && answer>=questions[i].options.length))) v.invalid('answers');
      let correct = 0;
      questions.forEach((q, i) => {
        if (answers[i] === q.correct_index) correct += 1;
      });
      const scorePct = questions.length ? Math.round((correct / questions.length) * 100) : 100;
      const passed = scorePct >= assignment.pass_score_pct;
      const attemptNumber = attemptsUsed + 1;
      const { rows: [completion] } = await client.query(
        `INSERT INTO restaurant_training_completions
           (assignment_id, score_pct, passed, answers, module_version, attempt_number, expires_at)
         VALUES ($1, $2, $3, $4::jsonb, $5, $6,
                 CASE WHEN $3 AND $7::int IS NOT NULL
                      THEN NOW() + ($7::int * INTERVAL '1 day') ELSE NULL END)
         RETURNING *`,
        [
          assignmentId, scorePct, passed,
          JSON.stringify(answers),
          assignment.current_version, attemptNumber, assignment.valid_for_days,
        ]
      );
      await client.query(
        `UPDATE restaurant_training_assignments
            SET status = $2, attempts_used = $3, updated_at = NOW()
          WHERE id = $1`,
        [assignmentId, passed ? 'completed' : 'assigned', attemptNumber]
      );
      await client.query('COMMIT');
      // S-17: the manager who assigned the training hears when it is
      // passed. Skipped for self-assigned training.
      if (passed && assignment.assigned_by && String(assignment.assigned_by) !== String(req.user.id)) {
        try {
          const { rows: [modRow] } = await pool.query(
            'SELECT title FROM restaurant_training_modules WHERE id = $1',
            [assignment.module_id]
          );
          const { sendNotification } = require('../services/notificationService');
          await sendNotification({
            userId: assignment.assigned_by,
            type: 'training_completed',
            title: 'Training completed',
            body: `Training "${modRow?.title || 'module'}" was completed.`,
            action_url: '/restaurants/merchant?tab=training',
            emailChannel: false,
            data: {
              assignment_id: assignmentId,
              module_id: assignment.module_id,
              restaurant_id: restaurantId,
              params: { moduleTitle: modRow?.title || null },
            },
          });
        } catch (notifyErr) {
          // Best-effort: the completion stands even if the notice fails.
        }
      }
      res.json({
        completion,
        passed,
        scorePct,
        attemptsUsed: attemptNumber,
        attemptsRemaining: Math.max(0, assignment.max_attempts - attemptNumber),
        maxAttempts: assignment.max_attempts,
      });
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
    await assertManage(restaurant, req.user.id, false);
    const params = [restaurantId];
    const scope = staffPredicate(restaurant, 'a.user_id', params);
    const { rows } = await pool.query(
      `SELECT c.*, m.title AS module_title, u.first_name, u.last_name, a.due_at
         FROM restaurant_training_completions c
         JOIN restaurant_training_assignments a ON a.id = c.assignment_id
         JOIN restaurant_training_modules m ON m.id = a.module_id
         JOIN users u ON u.id = a.user_id
        WHERE a.restaurant_id = $1${scope}
        ORDER BY c.completed_at DESC
        LIMIT 200`,
      params
    );
    res.json({ completions: rows });
  } catch (err) {
    next(err);
  }
};

// ── Auto-assignment rules (S-12) ─────────────────────────────────────────────
// A rule assigns a module automatically to active members with a given
// membership role (or every member when targetRole is null). Rules apply
// immediately when created/updated, and the nightly job re-applies them
// so staff hired later ("on hire") pick the module up without a manager
// having to remember.
function validateRuleBody(body) {
  const { targetRole, onHire, dueDays } = body || {};
  if (targetRole !== undefined && targetRole !== null && !MEMBER_ROLES.includes(targetRole)) {
    throw new AppError('Invalid target role', 400, 'invalid_target_role');
  }
  const due = parseBoundedInt(dueDays, { min: 1, max: 365, code: 'invalid_due_days', label: 'Due days', allowNull: true });
  return {
    targetRole: targetRole === undefined ? undefined : targetRole,
    onHire: onHire === undefined ? undefined : v.boolean(onHire, 'onHire'),
    dueDays: due,
  };
}

async function applyAndNotify(restaurant, restaurantId, moduleId) {
  const created = await applyAutoAssignRules(pool, {
    restaurantId,
    businessId: restaurant.business_id,
    moduleId,
  });
  for (const item of created) {
    await notifyTrainingAssigned(item.userId, item);
  }
  return created.length;
}

exports.listAutoAssignRules = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    const restaurant = await requireRestaurantAccess(req.user.id, restaurantId);
    await assertManage(restaurant, req.user.id);
    const { rows } = await pool.query(
      `SELECT r.*, m.title AS module_title
         FROM restaurant_training_auto_assign_rules r
         JOIN restaurant_training_modules m ON m.id = r.module_id
        WHERE r.restaurant_id = $1
        ORDER BY r.created_at ASC`,
      [restaurantId]
    );
    res.json({ rules: rows });
  } catch (err) {
    next(err);
  }
};

exports.createAutoAssignRule = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    const moduleId = parsePositiveInt(req.params.moduleId);
    const restaurant = await requireRestaurantAccess(req.user.id, restaurantId);
    await assertManage(restaurant, req.user.id);
    const { targetRole, onHire, dueDays } = validateRuleBody(req.body);
    const { rows: [module] } = await pool.query(
      `SELECT id FROM restaurant_training_modules WHERE id = $1 AND restaurant_id = $2`,
      [moduleId, restaurantId]
    );
    if (!module) throw new AppError('Training module not found', 404, 'module_not_found');
    const { rows: [rule] } = await pool.query(
      `INSERT INTO restaurant_training_auto_assign_rules
         (restaurant_id, module_id, target_role, on_hire, due_days, created_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (module_id, COALESCE(target_role, ''))
       DO UPDATE SET on_hire = EXCLUDED.on_hire, due_days = EXCLUDED.due_days,
                     is_active = TRUE, updated_at = NOW()
       RETURNING *`,
      [restaurantId, moduleId, targetRole || null, onHire !== false, dueDays ?? null, req.user.id]
    );
    const assignedCount = await applyAndNotify(restaurant, restaurantId, moduleId);
    res.status(201).json({ rule, assignedCount });
  } catch (err) {
    next(err);
  }
};

exports.updateAutoAssignRule = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    const ruleId = parsePositiveInt(req.params.ruleId);
    const restaurant = await requireRestaurantAccess(req.user.id, restaurantId);
    await assertManage(restaurant, req.user.id);
    const { targetRole, onHire, dueDays } = validateRuleBody(req.body);
    const { rows: [existing] } = await pool.query(
      `SELECT * FROM restaurant_training_auto_assign_rules WHERE id = $1 AND restaurant_id = $2`,
      [ruleId, restaurantId]
    );
    if (!existing) throw new AppError('Auto-assign rule not found', 404, 'rule_not_found');
    const { rows: [rule] } = await pool.query(
      `UPDATE restaurant_training_auto_assign_rules
          SET target_role = $3, on_hire = $4, due_days = $5,
              is_active = COALESCE($6, is_active), updated_at = NOW()
        WHERE id = $1 AND restaurant_id = $2
        RETURNING *`,
      [
        ruleId, restaurantId,
        targetRole === undefined ? existing.target_role : targetRole,
        onHire === undefined ? existing.on_hire : onHire,
        dueDays === undefined ? existing.due_days : dueDays,
        req.body?.isActive === undefined ? null : v.boolean(req.body.isActive, 'isActive'),
      ]
    );
    const assignedCount = rule.is_active
      ? await applyAndNotify(restaurant, restaurantId, rule.module_id)
      : 0;
    res.json({ rule, assignedCount });
  } catch (err) {
    next(err);
  }
};

exports.deleteAutoAssignRule = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    const ruleId = parsePositiveInt(req.params.ruleId);
    const restaurant = await requireRestaurantAccess(req.user.id, restaurantId);
    await assertManage(restaurant, req.user.id);
    const { rowCount } = await pool.query(
      `DELETE FROM restaurant_training_auto_assign_rules WHERE id = $1 AND restaurant_id = $2`,
      [ruleId, restaurantId]
    );
    if (!rowCount) throw new AppError('Auto-assign rule not found', 404, 'rule_not_found');
    res.json({ deleted: true });
  } catch (err) {
    next(err);
  }
};

// Manager-triggered re-application of every rule (the nightly job runs
// the same sweep for new hires).
exports.runAutoAssign = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    const restaurant = await requireRestaurantAccess(req.user.id, restaurantId);
    await assertManage(restaurant, req.user.id);
    const created = await applyAutoAssignRules(pool, {
      restaurantId,
      businessId: restaurant.business_id,
      assignedBy: req.user.id,
    });
    for (const item of created) {
      await notifyTrainingAssigned(item.userId, item);
    }
    res.json({ assignedCount: created.length });
  } catch (err) {
    next(err);
  }
};

exports.trainingCategories = TRAINING_CATEGORIES;
exports.assignmentStatuses = ASSIGNMENT_STATUSES;

exports._validation = { parseBoundedInt, normalizeQuestions, validateRuleBody };
