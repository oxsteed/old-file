'use strict';

// OxSteed Restaurants — Operations controller (Phase 2: checklists + SOPs).
//
// Additive surface mounted at /api/restaurants. It reuses the exact restaurant
// access model from foodController (owner = businesses.user_id OR
// food_restaurants.owner_user_id; otherwise an active business_members role),
// so a user only ever touches restaurants they belong to. Every route is nested
// under /restaurants/:restaurantId and every child row (checklist/run/sop) is
// verified to belong to that restaurant — one restaurant can never read or
// mutate another's operations data.
//
// The food_* ordering tables and /api/food are untouched.

const pool = require('../db');
const { AppError } = require('../middleware/errorHandler');
const { withTransaction } = require('../utils/transaction');

// ── helpers ──────────────────────────────────────────────────────────────────
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

const CHECKLIST_TYPES = ['opening', 'closing', 'cleaning', 'food_safety', 'custom'];
const SOP_CATEGORIES = ['general', 'kitchen', 'front_of_house', 'cleaning', 'food_safety', 'opening', 'closing', 'safety'];
const MANAGE_ROLES = new Set(['owner', 'manager']);

// Identical access query to foodController.requireRestaurantAccess.
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

// Templates + SOP authoring are owner/manager only. Viewing + running are open
// to any active member (cashier/kitchen/etc. complete the daily checklist).
function assertManage(restaurant) {
  if (!MANAGE_ROLES.has(restaurant.effective_role)) {
    throw new AppError('You do not have permission to manage this restaurant', 403, 'forbidden');
  }
}

// ── Checklists (templates) ─────────────────────────────────────────────────────
exports.listChecklists = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    await requireRestaurantAccess(req.user.id, restaurantId);

    const { rows: checklists } = await pool.query(
      `SELECT * FROM restaurant_checklists
        WHERE restaurant_id = $1
        ORDER BY is_active DESC, sort_order ASC, id ASC`,
      [restaurantId]
    );
    const ids = checklists.map((c) => c.id);
    let tasksByChecklist = {};
    if (ids.length) {
      const { rows: tasks } = await pool.query(
        `SELECT * FROM restaurant_checklist_tasks
          WHERE checklist_id = ANY($1::bigint[])
          ORDER BY sort_order ASC, id ASC`,
        [ids]
      );
      tasksByChecklist = tasks.reduce((acc, tk) => {
        (acc[tk.checklist_id] ||= []).push(tk);
        return acc;
      }, {});
    }
    res.json({
      checklists: checklists.map((c) => ({ ...c, tasks: tasksByChecklist[c.id] || [] })),
    });
  } catch (err) {
    next(err);
  }
};

exports.createChecklist = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    const restaurant = await requireRestaurantAccess(req.user.id, restaurantId);
    assertManage(restaurant);

    const name = normalizeString(req.body.name, 160);
    if (!name) throw new AppError('Validation failed', 400, 'validation_failed', { name: 'Name is required' });
    const type = CHECKLIST_TYPES.includes(req.body.checklistType) ? req.body.checklistType : 'opening';
    const tasksInput = Array.isArray(req.body.tasks) ? req.body.tasks.slice(0, 50) : [];

    const created = await withTransaction(async (client) => {
      const { rows: [checklist] } = await client.query(
        `INSERT INTO restaurant_checklists
           (restaurant_id, name, checklist_type, description, sort_order, created_by)
         VALUES ($1,$2,$3,$4,$5,$6)
         RETURNING *`,
        [restaurantId, name, type, normalizeString(req.body.description, 2000),
         Number.parseInt(req.body.sortOrder, 10) || 0, req.user.id]
      );
      const tasks = [];
      let sort = 0;
      for (const raw of tasksInput) {
        const label = normalizeString(raw?.label, 255);
        if (!label) continue;
        const { rows: [task] } = await client.query(
          `INSERT INTO restaurant_checklist_tasks
             (checklist_id, label, instructions, requires_note, sort_order)
           VALUES ($1,$2,$3,$4,$5)
           RETURNING *`,
          [checklist.id, label, normalizeString(raw?.instructions, 1000), asBool(raw?.requiresNote), sort++]
        );
        tasks.push(task);
      }
      return { ...checklist, tasks };
    });
    res.status(201).json({ checklist: created });
  } catch (err) {
    next(err);
  }
};

exports.updateChecklist = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    const checklistId = parsePositiveInt(req.params.checklistId);
    const restaurant = await requireRestaurantAccess(req.user.id, restaurantId);
    assertManage(restaurant);

    const sets = [];
    const vals = [];
    let i = 1;
    if (req.body.name !== undefined) {
      const name = normalizeString(req.body.name, 160);
      if (!name) throw new AppError('Validation failed', 400, 'validation_failed', { name: 'Name is required' });
      sets.push(`name = $${i++}`); vals.push(name);
    }
    if (req.body.checklistType !== undefined && CHECKLIST_TYPES.includes(req.body.checklistType)) {
      sets.push(`checklist_type = $${i++}`); vals.push(req.body.checklistType);
    }
    if (req.body.description !== undefined) { sets.push(`description = $${i++}`); vals.push(normalizeString(req.body.description, 2000)); }
    if (req.body.isActive !== undefined) { sets.push(`is_active = $${i++}`); vals.push(asBool(req.body.isActive, true)); }
    if (req.body.sortOrder !== undefined) { sets.push(`sort_order = $${i++}`); vals.push(Number.parseInt(req.body.sortOrder, 10) || 0); }
    if (!sets.length) throw new AppError('No updatable fields provided', 400, 'validation_failed', { body: 'No updatable fields provided' });
    sets.push('updated_at = NOW()');

    const { rows: [checklist] } = await pool.query(
      `UPDATE restaurant_checklists SET ${sets.join(', ')}
        WHERE id = $${i++} AND restaurant_id = $${i}
        RETURNING *`,
      [...vals, checklistId, restaurantId]
    );
    if (!checklist) throw new AppError('Checklist not found', 404, 'checklist_not_found');
    res.json({ checklist });
  } catch (err) {
    next(err);
  }
};

exports.deleteChecklist = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    const checklistId = parsePositiveInt(req.params.checklistId);
    const restaurant = await requireRestaurantAccess(req.user.id, restaurantId);
    assertManage(restaurant);
    const { rowCount } = await pool.query(
      `DELETE FROM restaurant_checklists WHERE id = $1 AND restaurant_id = $2`,
      [checklistId, restaurantId]
    );
    if (!rowCount) throw new AppError('Checklist not found', 404, 'checklist_not_found');
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
};

// Verify a checklist belongs to the restaurant before touching its tasks.
async function assertChecklistInRestaurant(checklistId, restaurantId) {
  const { rows } = await pool.query(
    `SELECT id FROM restaurant_checklists WHERE id = $1 AND restaurant_id = $2`,
    [checklistId, restaurantId]
  );
  if (!rows[0]) throw new AppError('Checklist not found', 404, 'checklist_not_found');
}

exports.addTask = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    const checklistId = parsePositiveInt(req.params.checklistId);
    const restaurant = await requireRestaurantAccess(req.user.id, restaurantId);
    assertManage(restaurant);
    await assertChecklistInRestaurant(checklistId, restaurantId);

    const label = normalizeString(req.body.label, 255);
    if (!label) throw new AppError('Validation failed', 400, 'validation_failed', { label: 'Label is required' });
    const { rows: [task] } = await pool.query(
      `INSERT INTO restaurant_checklist_tasks (checklist_id, label, instructions, requires_note, sort_order)
       VALUES ($1,$2,$3,$4, COALESCE((SELECT MAX(sort_order)+1 FROM restaurant_checklist_tasks WHERE checklist_id = $1), 0))
       RETURNING *`,
      [checklistId, label, normalizeString(req.body.instructions, 1000), asBool(req.body.requiresNote)]
    );
    res.status(201).json({ task });
  } catch (err) {
    next(err);
  }
};

exports.updateTask = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    const checklistId = parsePositiveInt(req.params.checklistId);
    const taskId = parsePositiveInt(req.params.taskId);
    const restaurant = await requireRestaurantAccess(req.user.id, restaurantId);
    assertManage(restaurant);
    await assertChecklistInRestaurant(checklistId, restaurantId);

    const sets = [];
    const vals = [];
    let i = 1;
    if (req.body.label !== undefined) {
      const label = normalizeString(req.body.label, 255);
      if (!label) throw new AppError('Validation failed', 400, 'validation_failed', { label: 'Label is required' });
      sets.push(`label = $${i++}`); vals.push(label);
    }
    if (req.body.instructions !== undefined) { sets.push(`instructions = $${i++}`); vals.push(normalizeString(req.body.instructions, 1000)); }
    if (req.body.requiresNote !== undefined) { sets.push(`requires_note = $${i++}`); vals.push(asBool(req.body.requiresNote)); }
    if (req.body.isActive !== undefined) { sets.push(`is_active = $${i++}`); vals.push(asBool(req.body.isActive, true)); }
    if (req.body.sortOrder !== undefined) { sets.push(`sort_order = $${i++}`); vals.push(Number.parseInt(req.body.sortOrder, 10) || 0); }
    if (!sets.length) throw new AppError('No updatable fields provided', 400, 'validation_failed', { body: 'No updatable fields provided' });

    const { rows: [task] } = await pool.query(
      `UPDATE restaurant_checklist_tasks SET ${sets.join(', ')}
        WHERE id = $${i++} AND checklist_id = $${i}
        RETURNING *`,
      [...vals, taskId, checklistId]
    );
    if (!task) throw new AppError('Task not found', 404, 'task_not_found');
    res.json({ task });
  } catch (err) {
    next(err);
  }
};

exports.deleteTask = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    const checklistId = parsePositiveInt(req.params.checklistId);
    const taskId = parsePositiveInt(req.params.taskId);
    const restaurant = await requireRestaurantAccess(req.user.id, restaurantId);
    assertManage(restaurant);
    await assertChecklistInRestaurant(checklistId, restaurantId);
    const { rowCount } = await pool.query(
      `DELETE FROM restaurant_checklist_tasks WHERE id = $1 AND checklist_id = $2`,
      [taskId, checklistId]
    );
    if (!rowCount) throw new AppError('Task not found', 404, 'task_not_found');
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
};

// ── Checklist runs (execution) ─────────────────────────────────────────────────
async function loadRunWithItems(runId, restaurantId) {
  const { rows: [run] } = await pool.query(
    `SELECT * FROM restaurant_checklist_runs WHERE id = $1 AND restaurant_id = $2`,
    [runId, restaurantId]
  );
  if (!run) throw new AppError('Run not found', 404, 'run_not_found');
  const { rows: items } = await pool.query(
    `SELECT * FROM restaurant_checklist_run_items WHERE run_id = $1 ORDER BY sort_order ASC, id ASC`,
    [runId]
  );
  return { ...run, items };
}

exports.startRun = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    const checklistId = parsePositiveInt(req.params.checklistId);
    await requireRestaurantAccess(req.user.id, restaurantId); // any active member may run
    await assertChecklistInRestaurant(checklistId, restaurantId);

    const run = await withTransaction(async (client) => {
      const { rows: tasks } = await client.query(
        `SELECT * FROM restaurant_checklist_tasks
          WHERE checklist_id = $1 AND is_active = TRUE
          ORDER BY sort_order ASC, id ASC`,
        [checklistId]
      );
      const { rows: [created] } = await client.query(
        `INSERT INTO restaurant_checklist_runs
           (checklist_id, restaurant_id, started_by, total_tasks)
         VALUES ($1,$2,$3,$4)
         RETURNING *`,
        [checklistId, restaurantId, req.user.id, tasks.length]
      );
      let sort = 0;
      for (const tk of tasks) {
        await client.query(
          `INSERT INTO restaurant_checklist_run_items
             (run_id, task_id, label, requires_note, sort_order)
           VALUES ($1,$2,$3,$4,$5)`,
          [created.id, tk.id, tk.label, tk.requires_note, sort++]
        );
      }
      return created;
    });
    const full = await loadRunWithItems(run.id, restaurantId);
    res.status(201).json({ run: full });
  } catch (err) {
    next(err);
  }
};

exports.getRun = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    const runId = parsePositiveInt(req.params.runId);
    await requireRestaurantAccess(req.user.id, restaurantId);
    res.json({ run: await loadRunWithItems(runId, restaurantId) });
  } catch (err) {
    next(err);
  }
};

exports.toggleRunItem = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    const runId = parsePositiveInt(req.params.runId);
    const itemId = parsePositiveInt(req.params.itemId);
    await requireRestaurantAccess(req.user.id, restaurantId);

    const run = await withTransaction(async (client) => {
      // Lock the run; confirm it belongs to this restaurant and is open.
      const { rows: [r] } = await client.query(
        `SELECT * FROM restaurant_checklist_runs WHERE id = $1 AND restaurant_id = $2 FOR UPDATE`,
        [runId, restaurantId]
      );
      if (!r) throw new AppError('Run not found', 404, 'run_not_found');
      if (r.status !== 'in_progress') throw new AppError('Run is already closed', 409, 'run_closed');

      const isDone = asBool(req.body.isDone, true);
      const { rows: [item] } = await client.query(
        `UPDATE restaurant_checklist_run_items
            SET is_done = $1,
                note = COALESCE($2, note),
                done_by = CASE WHEN $1 THEN $3 ELSE NULL END,
                done_at = CASE WHEN $1 THEN NOW() ELSE NULL END
          WHERE id = $4 AND run_id = $5
          RETURNING *`,
        [isDone, normalizeString(req.body.note, 1000), req.user.id, itemId, runId]
      );
      if (!item) throw new AppError('Item not found', 404, 'item_not_found');

      const { rows: [{ done }] } = await client.query(
        `SELECT COUNT(*)::int AS done FROM restaurant_checklist_run_items WHERE run_id = $1 AND is_done = TRUE`,
        [runId]
      );
      const { rows: [updated] } = await client.query(
        `UPDATE restaurant_checklist_runs SET completed_tasks = $1 WHERE id = $2 RETURNING *`,
        [done, runId]
      );
      return updated;
    });
    const full = await loadRunWithItems(run.id, restaurantId);
    res.json({ run: full });
  } catch (err) {
    next(err);
  }
};

exports.completeRun = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    const runId = parsePositiveInt(req.params.runId);
    await requireRestaurantAccess(req.user.id, restaurantId);

    const { rows: [run] } = await pool.query(
      `UPDATE restaurant_checklist_runs
          SET status = 'completed', completed_at = NOW(), completed_by = $1,
              notes = COALESCE($2, notes)
        WHERE id = $3 AND restaurant_id = $4 AND status = 'in_progress'
        RETURNING *`,
      [req.user.id, normalizeString(req.body.notes, 2000), runId, restaurantId]
    );
    if (!run) throw new AppError('Run not found or already closed', 404, 'run_not_found');
    res.json({ run: await loadRunWithItems(run.id, restaurantId) });
  } catch (err) {
    next(err);
  }
};

exports.listRuns = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    await requireRestaurantAccess(req.user.id, restaurantId);
    const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 50, 1), 100);
    const offset = Math.max(Number.parseInt(req.query.offset, 10) || 0, 0);
    const checklistId = parsePositiveInt(req.query.checklistId);

    const params = [restaurantId];
    let where = 'r.restaurant_id = $1';
    if (checklistId) { params.push(checklistId); where += ` AND r.checklist_id = $${params.length}`; }
    params.push(limit, offset);

    const { rows } = await pool.query(
      `SELECT r.*, c.name AS checklist_name, c.checklist_type
         FROM restaurant_checklist_runs r
         JOIN restaurant_checklists c ON c.id = r.checklist_id
        WHERE ${where}
        ORDER BY r.started_at DESC
        LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    res.json({ runs: rows, limit, offset });
  } catch (err) {
    next(err);
  }
};

// ── SOP library ─────────────────────────────────────────────────────────────
exports.listSops = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    await requireRestaurantAccess(req.user.id, restaurantId);
    const { rows } = await pool.query(
      `SELECT * FROM restaurant_sops WHERE restaurant_id = $1 ORDER BY category ASC, title ASC`,
      [restaurantId]
    );
    res.json({ sops: rows });
  } catch (err) {
    next(err);
  }
};

exports.createSop = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    const restaurant = await requireRestaurantAccess(req.user.id, restaurantId);
    assertManage(restaurant);
    const title = normalizeString(req.body.title, 200);
    if (!title) throw new AppError('Validation failed', 400, 'validation_failed', { title: 'Title is required' });
    const category = SOP_CATEGORIES.includes(req.body.category) ? req.body.category : 'general';
    const { rows: [sop] } = await pool.query(
      `INSERT INTO restaurant_sops (restaurant_id, title, category, body, is_published, created_by)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING *`,
      [restaurantId, title, category, normalizeString(req.body.body, 20000), asBool(req.body.isPublished, true), req.user.id]
    );
    res.status(201).json({ sop });
  } catch (err) {
    next(err);
  }
};

exports.updateSop = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    const sopId = parsePositiveInt(req.params.sopId);
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
    if (req.body.category !== undefined && SOP_CATEGORIES.includes(req.body.category)) { sets.push(`category = $${i++}`); vals.push(req.body.category); }
    if (req.body.body !== undefined) { sets.push(`body = $${i++}`); vals.push(normalizeString(req.body.body, 20000)); }
    if (req.body.isPublished !== undefined) { sets.push(`is_published = $${i++}`); vals.push(asBool(req.body.isPublished, true)); }
    if (!sets.length) throw new AppError('No updatable fields provided', 400, 'validation_failed', { body: 'No updatable fields provided' });
    sets.push('version = version + 1');
    sets.push('updated_at = NOW()');

    const { rows: [sop] } = await pool.query(
      `UPDATE restaurant_sops SET ${sets.join(', ')}
        WHERE id = $${i++} AND restaurant_id = $${i}
        RETURNING *`,
      [...vals, sopId, restaurantId]
    );
    if (!sop) throw new AppError('SOP not found', 404, 'sop_not_found');
    res.json({ sop });
  } catch (err) {
    next(err);
  }
};

exports.deleteSop = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    const sopId = parsePositiveInt(req.params.sopId);
    const restaurant = await requireRestaurantAccess(req.user.id, restaurantId);
    assertManage(restaurant);
    const { rowCount } = await pool.query(
      `DELETE FROM restaurant_sops WHERE id = $1 AND restaurant_id = $2`,
      [sopId, restaurantId]
    );
    if (!rowCount) throw new AppError('SOP not found', 404, 'sop_not_found');
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
};
