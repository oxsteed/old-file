"use strict";

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

const pool = require("../db");
const {
  attachScope,
  resolveStore,
  assertStore,
  requireBrand,
} = require("../services/restaurantReviewScope");
const { AppError } = require("../middleware/errorHandler");
const { resolveRestaurantAccess } = require("../services/scopeModel");
const permissionsService = require("../services/permissionsService");
const { withTransaction } = require("../utils/transaction");
const v = require("../utils/restaurantReviewValidation");
const { logBusinessAction } = require("../services/businessAuditLog");

async function audit(
  client,
  req,
  restaurant,
  table,
  before,
  after,
  locationId = null,
) {
  await logBusinessAction(req, {
    client,
    throwOnError: true,
    business_id: restaurant.business_id,
    action: `restaurant.${table}.changed`,
    target_type: table,
    target_id: after?.id || before?.id,
    before_state: before || {},
    after_state: after || {},
    metadata: { location_id: locationId },
  });
}
async function auditedQuery(req, restaurant, table, id, sql, params) {
  return withTransaction(
    pool,
    async (client) => {
      const before = id
        ? (
            await client.query(
              `SELECT * FROM ${table} WHERE id=$1 FOR UPDATE`,
              [id],
            )
          ).rows[0]
        : null;
      const result = await client.query(sql, params);
      if (result.rows[0])
        await audit(client, req, restaurant, table, before, result.rows[0]);
      return result;
    },
    "restaurant_operations_write",
  );
}
function enumValue(value, choices, fallback) {
  if (value === undefined) return fallback;
  if (!choices.includes(value)) v.invalid("category");
  return value;
}
function sortOrder(value) {
  return value === undefined ? 0 : v.integer(value, "sortOrder", 0, 100000);
}

// ── helpers ──────────────────────────────────────────────────────────────────
function parsePositiveInt(value) {
  return require("../utils/strictInteger").strictInteger(value);
}

function normalizeString(value, max = 255) {
  if (value === undefined || value === null) return null;
  const s = String(value).trim();
  if (!s) return null;
  return s.slice(0, max);
}

function asBool(value, fallback = false) {
  return value === undefined ? fallback : v.boolean(value, "boolean");
}

const CHECKLIST_TYPES = [
  "opening",
  "closing",
  "cleaning",
  "food_safety",
  "custom",
];
const SOP_CATEGORIES = [
  "general",
  "kitchen",
  "front_of_house",
  "cleaning",
  "food_safety",
  "opening",
  "closing",
  "safety",
];

// Identical access query to foodController.requireRestaurantAccess.
// Canonical restaurant access gate (analytics scope model, Phase 1 Item 6).
// The fast-fail `!restaurantId` guard is preserved here (not inside the
// shared gate) so invalid ids keep this module's exact 404 behavior.
async function requireRestaurantAccess(userId, restaurantId) {
  if (!restaurantId)
    throw new AppError("Restaurant not found", 404, "restaurant_not_found");
  return resolveRestaurantAccess(userId, restaurantId);
}

// Templates + SOP authoring are owner/manager only. Viewing + running are open
// to any active member (cashier/kitchen/etc. complete the daily checklist).
// S-08: manage gates resolve through the permission catalog (role defaults
// + per-membership overrides) via permissionsService, the single resolver.
// MANAGE_PERMISSION_CODES reproduces the previous owner/manager-only gate
// for members without overrides; deny overrides now take effect here too.
const MANAGE_PERMISSION_CODES = ["crew.manage"];

async function assertManage(restaurant, userId) {
  const allowed = await permissionsService.hasRestaurantPermission(
    restaurant,
    userId,
    MANAGE_PERMISSION_CODES,
  );
  if (!allowed) {
    throw new AppError(
      "You do not have permission to manage this restaurant",
      403,
      "forbidden",
    );
  }
  requireBrand(await attachScope(restaurant, userId));
}

// ── Checklists (templates) ─────────────────────────────────────────────────────
exports.listChecklists = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    await requireRestaurantAccess(req.user.id, restaurantId);

    const { rows: checklists } = await pool.query(
      `SELECT * FROM restaurant_checklists
        WHERE restaurant_id = $1 AND archived_at IS NULL
        ORDER BY is_active DESC, sort_order ASC, id ASC`,
      [restaurantId],
    );
    const ids = checklists.map((c) => c.id);
    let tasksByChecklist = {};
    if (ids.length) {
      const { rows: tasks } = await pool.query(
        `SELECT * FROM restaurant_checklist_tasks
          WHERE checklist_id = ANY($1::bigint[])
          ORDER BY sort_order ASC, id ASC`,
        [ids],
      );
      tasksByChecklist = tasks.reduce((acc, tk) => {
        (acc[tk.checklist_id] ||= []).push(tk);
        return acc;
      }, {});
    }
    res.json({
      checklists: checklists.map((c) => ({
        ...c,
        tasks: tasksByChecklist[c.id] || [],
      })),
    });
  } catch (err) {
    next(err);
  }
};

exports.createChecklist = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    const restaurant = await requireRestaurantAccess(req.user.id, restaurantId);
    await assertManage(restaurant, req.user.id);

    const name = normalizeString(req.body.name, 160);
    if (!name)
      throw new AppError("Validation failed", 400, "validation_failed", {
        name: "Name is required",
      });
    const type = enumValue(req.body.checklistType, CHECKLIST_TYPES, "opening");
    const tasksInput = req.body.tasks === undefined ? [] : req.body.tasks;
    if (!Array.isArray(tasksInput) || tasksInput.length > 50)
      v.invalid("tasks");
    for (const task of tasksInput) {
      v.text(task?.label, "label", 255);
      if (task.requiresNote !== undefined) asBool(task.requiresNote);
    }

    const created = await withTransaction(pool, async (client) => {
      const {
        rows: [checklist],
      } = await client.query(
        `INSERT INTO restaurant_checklists
           (restaurant_id, name, checklist_type, description, sort_order, created_by)
         VALUES ($1,$2,$3,$4,$5,$6)
         RETURNING *`,
        [
          restaurantId,
          name,
          type,
          normalizeString(req.body.description, 2000),
          sortOrder(req.body.sortOrder),
          req.user.id,
        ],
      );
      const tasks = [];
      let sort = 0;
      for (const raw of tasksInput) {
        const label = normalizeString(raw?.label, 255);
        if (!label) continue;
        const {
          rows: [task],
        } = await client.query(
          `INSERT INTO restaurant_checklist_tasks
             (checklist_id, label, instructions, requires_note, sort_order)
           VALUES ($1,$2,$3,$4,$5)
           RETURNING *`,
          [
            checklist.id,
            label,
            normalizeString(raw?.instructions, 1000),
            asBool(raw?.requiresNote),
            sort++,
          ],
        );
        tasks.push(task);
      }
      await audit(client, req, restaurant, "restaurant_checklists", null, {
        ...checklist,
        tasks,
      });
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
    await assertManage(restaurant, req.user.id);

    const sets = [];
    const vals = [];
    let i = 1;
    if (req.body.name !== undefined) {
      const name = normalizeString(req.body.name, 160);
      if (!name)
        throw new AppError("Validation failed", 400, "validation_failed", {
          name: "Name is required",
        });
      sets.push(`name = $${i++}`);
      vals.push(name);
    }
    if (req.body.checklistType !== undefined) {
      enumValue(req.body.checklistType, CHECKLIST_TYPES);
      sets.push(`checklist_type = $${i++}`);
      vals.push(req.body.checklistType);
    }
    if (req.body.description !== undefined) {
      sets.push(`description = $${i++}`);
      vals.push(normalizeString(req.body.description, 2000));
    }
    if (req.body.isActive !== undefined) {
      sets.push(`is_active = $${i++}`);
      vals.push(asBool(req.body.isActive, true));
    }
    if (req.body.sortOrder !== undefined) {
      sets.push(`sort_order = $${i++}`);
      vals.push(sortOrder(req.body.sortOrder));
    }
    if (!sets.length)
      throw new AppError(
        "No updatable fields provided",
        400,
        "validation_failed",
        { body: "No updatable fields provided" },
      );
    sets.push("updated_at = NOW()");

    const {
      rows: [checklist],
    } = await auditedQuery(
      req,
      restaurant,
      "restaurant_checklists",
      checklistId,
      `UPDATE restaurant_checklists SET ${sets.join(", ")}
        WHERE id = $${i++} AND restaurant_id = $${i}
        RETURNING *`,
      [...vals, checklistId, restaurantId],
    );
    if (!checklist)
      throw new AppError("Checklist not found", 404, "checklist_not_found");
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
    await assertManage(restaurant, req.user.id);
    const { rowCount } = await auditedQuery(
      req,
      restaurant,
      "restaurant_checklists",
      checklistId,
      `UPDATE restaurant_checklists SET archived_at=NOW(), is_active=FALSE WHERE id = $1 AND restaurant_id = $2 RETURNING *`,
      [checklistId, restaurantId],
    );
    if (!rowCount)
      throw new AppError("Checklist not found", 404, "checklist_not_found");
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
};

// Verify a checklist belongs to the restaurant before touching its tasks.
async function assertChecklistInRestaurant(checklistId, restaurantId) {
  const { rows } = await pool.query(
    `SELECT id FROM restaurant_checklists WHERE id = $1 AND restaurant_id = $2 AND archived_at IS NULL`,
    [checklistId, restaurantId],
  );
  if (!rows[0])
    throw new AppError("Checklist not found", 404, "checklist_not_found");
}

exports.addTask = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    const checklistId = parsePositiveInt(req.params.checklistId);
    const restaurant = await requireRestaurantAccess(req.user.id, restaurantId);
    await assertManage(restaurant, req.user.id);
    await assertChecklistInRestaurant(checklistId, restaurantId);

    const label = normalizeString(req.body.label, 255);
    if (!label)
      throw new AppError("Validation failed", 400, "validation_failed", {
        label: "Label is required",
      });
    const {
      rows: [task],
    } = await auditedQuery(
      req,
      restaurant,
      "restaurant_checklist_tasks",
      null,
      `INSERT INTO restaurant_checklist_tasks (checklist_id, label, instructions, requires_note, sort_order)
       VALUES ($1,$2,$3,$4, COALESCE((SELECT MAX(sort_order)+1 FROM restaurant_checklist_tasks WHERE checklist_id = $1), 0))
       RETURNING *`,
      [
        checklistId,
        label,
        normalizeString(req.body.instructions, 1000),
        asBool(req.body.requiresNote),
      ],
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
    await assertManage(restaurant, req.user.id);
    await assertChecklistInRestaurant(checklistId, restaurantId);

    const sets = [];
    const vals = [];
    let i = 1;
    if (req.body.label !== undefined) {
      const label = normalizeString(req.body.label, 255);
      if (!label)
        throw new AppError("Validation failed", 400, "validation_failed", {
          label: "Label is required",
        });
      sets.push(`label = $${i++}`);
      vals.push(label);
    }
    if (req.body.instructions !== undefined) {
      sets.push(`instructions = $${i++}`);
      vals.push(normalizeString(req.body.instructions, 1000));
    }
    if (req.body.requiresNote !== undefined) {
      sets.push(`requires_note = $${i++}`);
      vals.push(asBool(req.body.requiresNote));
    }
    if (req.body.isActive !== undefined) {
      sets.push(`is_active = $${i++}`);
      vals.push(asBool(req.body.isActive, true));
    }
    if (req.body.sortOrder !== undefined) {
      sets.push(`sort_order = $${i++}`);
      vals.push(sortOrder(req.body.sortOrder));
    }
    if (!sets.length)
      throw new AppError(
        "No updatable fields provided",
        400,
        "validation_failed",
        { body: "No updatable fields provided" },
      );

    const {
      rows: [task],
    } = await auditedQuery(
      req,
      restaurant,
      "restaurant_checklist_tasks",
      taskId,
      `UPDATE restaurant_checklist_tasks SET ${sets.join(", ")}
        WHERE id = $${i++} AND checklist_id = $${i}
        RETURNING *`,
      [...vals, taskId, checklistId],
    );
    if (!task) throw new AppError("Task not found", 404, "task_not_found");
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
    await assertManage(restaurant, req.user.id);
    await assertChecklistInRestaurant(checklistId, restaurantId);
    const { rowCount } = await auditedQuery(
      req,
      restaurant,
      "restaurant_checklist_tasks",
      taskId,
      `DELETE FROM restaurant_checklist_tasks WHERE id = $1 AND checklist_id = $2 RETURNING *`,
      [taskId, checklistId],
    );
    if (!rowCount) throw new AppError("Task not found", 404, "task_not_found");
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
};

// ── Checklist runs (execution) ─────────────────────────────────────────────────
async function loadRunWithItems(runId, restaurantId, restaurant = null) {
  const {
    rows: [run],
  } = await pool.query(
    `SELECT * FROM restaurant_checklist_runs WHERE id = $1 AND restaurant_id = $2`,
    [runId, restaurantId],
  );
  if (!run) throw new AppError("Run not found", 404, "run_not_found");
  if (restaurant) assertStore(restaurant, run.location_id);
  const { rows: items } = await pool.query(
    `SELECT * FROM restaurant_checklist_run_items WHERE run_id = $1 ORDER BY sort_order ASC, id ASC`,
    [runId],
  );
  return { ...run, items };
}

exports.startRun = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    const checklistId = parsePositiveInt(req.params.checklistId);
    const restaurant = await attachScope(
      await requireRestaurantAccess(req.user.id, restaurantId),
      req.user.id,
    ); // any active member may run
    await assertChecklistInRestaurant(checklistId, restaurantId);

    const run = await withTransaction(pool, async (client) => {
      const locationId = await resolveStore(
        restaurant,
        req.body?.locationId,
        client,
      );
      const {
        rows: [template],
      } = await client.query(
        "SELECT * FROM restaurant_checklists WHERE id=$1 AND restaurant_id=$2 AND is_active=TRUE AND archived_at IS NULL FOR SHARE",
        [checklistId, restaurantId],
      );
      if (!template)
        throw new AppError(
          "Active checklist not found",
          404,
          "checklist_not_found",
        );
      const key =
        req.get?.("Idempotency-Key") || req.body?.idempotencyKey || null;
      if (key != null) v.text(key, "idempotencyKey", 180);
      if (key) {
        await client.query(
          "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
          [`checklist:${restaurantId}:${key}`],
        );
        const {
          rows: [existing],
        } = await client.query(
          "SELECT * FROM restaurant_checklist_runs WHERE restaurant_id=$1 AND idempotency_key=$2",
          [restaurantId, key],
        );
        if (existing) {
          if (
            Number(existing.checklist_id) !== checklistId ||
            Number(existing.location_id) !== Number(locationId) ||
            existing.started_by !== req.user.id
          )
            throw new AppError(
              "Checklist retry conflicts",
              409,
              "idempotency_conflict",
            );
          return existing;
        }
      }
      const { rows: tasks } = await client.query(
        `SELECT * FROM restaurant_checklist_tasks
          WHERE checklist_id = $1 AND is_active = TRUE
          ORDER BY sort_order ASC, id ASC`,
        [checklistId],
      );
      if (!tasks.length)
        throw new AppError(
          "Checklist has no active tasks",
          409,
          "checklist_empty",
        );
      const {
        rows: [created],
      } = await client.query(
        `INSERT INTO restaurant_checklist_runs
           (checklist_id, restaurant_id, started_by, total_tasks, location_id, idempotency_key, business_day)
         VALUES ($1,$2,$3,$4,$5,$6,(SELECT ((NOW() AT TIME ZONE timezone)-(COALESCE(day_start_hour,0)*INTERVAL '1 hour'))::date FROM restaurant_locations WHERE id=$5))
         RETURNING *`,
        [checklistId, restaurantId, req.user.id, tasks.length, locationId, key],
      );
      let sort = 0;
      for (const tk of tasks) {
        await client.query(
          `INSERT INTO restaurant_checklist_run_items
             (run_id, task_id, label, requires_note, sort_order, instructions)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [
            created.id,
            tk.id,
            tk.label,
            tk.requires_note,
            sort++,
            tk.instructions,
          ],
        );
      }
      await audit(
        client,
        req,
        restaurant,
        "restaurant_checklist_runs",
        null,
        created,
        locationId,
      );
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
    const restaurant = await attachScope(
      await requireRestaurantAccess(req.user.id, restaurantId),
      req.user.id,
    );
    res.json({ run: await loadRunWithItems(runId, restaurantId, restaurant) });
  } catch (err) {
    next(err);
  }
};

exports.toggleRunItem = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    const runId = parsePositiveInt(req.params.runId);
    const itemId = parsePositiveInt(req.params.itemId);
    const restaurant = await attachScope(
      await requireRestaurantAccess(req.user.id, restaurantId),
      req.user.id,
    );

    const run = await withTransaction(pool, async (client) => {
      // Lock the run; confirm it belongs to this restaurant and is open.
      const {
        rows: [r],
      } = await client.query(
        `SELECT * FROM restaurant_checklist_runs WHERE id = $1 AND restaurant_id = $2 FOR UPDATE`,
        [runId, restaurantId],
      );
      if (!r) throw new AppError("Run not found", 404, "run_not_found");
      assertStore(restaurant, r.location_id);
      if (r.status !== "in_progress")
        throw new AppError("Run is already closed", 409, "run_closed");

      const isDone = asBool(req.body.isDone, true);
      const {
        rows: [before],
      } = await client.query(
        "SELECT * FROM restaurant_checklist_run_items WHERE id=$1 AND run_id=$2 FOR UPDATE",
        [itemId, runId],
      );
      if (!before) throw new AppError("Item not found", 404, "item_not_found");
      const note =
        req.body.note === undefined
          ? before.note
          : normalizeString(req.body.note, 1000);
      if (isDone && before.requires_note && !note)
        throw new AppError("A note is required", 400, "note_required");
      const {
        rows: [item],
      } = await client.query(
        `UPDATE restaurant_checklist_run_items
            SET is_done = $1,
                note = $2,
                done_by = CASE WHEN $1 THEN $3::uuid ELSE NULL END,
                done_at = CASE WHEN $1 THEN NOW() ELSE NULL END
          WHERE id = $4 AND run_id = $5
          RETURNING *`,
        [isDone, note, req.user.id, itemId, runId],
      );
      if (!item) throw new AppError("Item not found", 404, "item_not_found");
      await audit(
        client,
        req,
        restaurant,
        "restaurant_checklist_run_items",
        before,
        item,
        r.location_id,
      );

      const {
        rows: [{ done }],
      } = await client.query(
        `SELECT COUNT(*)::int AS done FROM restaurant_checklist_run_items WHERE run_id = $1 AND is_done = TRUE`,
        [runId],
      );
      const {
        rows: [updated],
      } = await client.query(
        `UPDATE restaurant_checklist_runs SET completed_tasks = $1 WHERE id = $2 RETURNING *`,
        [done, runId],
      );
      return updated;
    });
    const full = await loadRunWithItems(run.id, restaurantId, restaurant);
    res.json({ run: full });
  } catch (err) {
    next(err);
  }
};

exports.completeRun = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    const runId = parsePositiveInt(req.params.runId);
    const restaurant = await attachScope(
      await requireRestaurantAccess(req.user.id, restaurantId),
      req.user.id,
    );

    const run = await withTransaction(
      pool,
      async (client) => {
        const {
          rows: [current],
        } = await client.query(
          "SELECT * FROM restaurant_checklist_runs WHERE id=$1 AND restaurant_id=$2 FOR UPDATE",
          [runId, restaurantId],
        );
        if (!current) throw new AppError("Run not found", 404, "run_not_found");
        assertStore(restaurant, current.location_id);
        if (current.status === "completed") return current;
        if (current.status !== "in_progress")
          throw new AppError("Run is closed", 409, "run_closed");
        const {
          rows: [remaining],
        } = await client.query(
          `SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE NOT is_done OR (requires_note AND NULLIF(BTRIM(note),'') IS NULL))::int AS incomplete FROM restaurant_checklist_run_items WHERE run_id=$1`,
          [runId],
        );
        if (!remaining.total || remaining.incomplete)
          throw new AppError(
            "Finish all required tasks and notes first",
            409,
            "checklist_incomplete",
          );
        const {
          rows: [run],
        } = await client.query(
          `UPDATE restaurant_checklist_runs
          SET status = 'completed', completed_at = NOW(), completed_by = $1,
              notes = COALESCE($2, notes)
        WHERE id = $3 AND restaurant_id = $4 AND status = 'in_progress'
        RETURNING *`,
          [
            req.user.id,
            normalizeString(req.body.notes, 2000),
            runId,
            restaurantId,
          ],
        );
        if (!run)
          throw new AppError(
            "Run not found or already closed",
            404,
            "run_not_found",
          );
        await audit(
          client,
          req,
          restaurant,
          "restaurant_checklist_runs",
          current,
          run,
          current.location_id,
        );
        return run;
      },
      "checklist_complete",
    );
    res.json({ run: await loadRunWithItems(run.id, restaurantId, restaurant) });
  } catch (err) {
    next(err);
  }
};

exports.listRuns = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    const restaurant = await attachScope(
      await requireRestaurantAccess(req.user.id, restaurantId),
      req.user.id,
    );
    const limit = Math.min(
      Math.max(Number.parseInt(req.query.limit, 10) || 50, 1),
      100,
    );
    const offset = Math.max(Number.parseInt(req.query.offset, 10) || 0, 0);
    const checklistId = parsePositiveInt(req.query.checklistId);

    const params = [restaurantId];
    let where = "r.restaurant_id = $1";
    if (restaurant.locationScope.mode === "assigned") {
      params.push(restaurant.locationScope.location_ids);
      where += ` AND r.location_id=ANY($${params.length}::bigint[])`;
    }
    if (req.query.locationId !== undefined) {
      const locationId = v.integer(req.query.locationId, "locationId");
      assertStore(restaurant, locationId);
      params.push(locationId);
      where += ` AND r.location_id=$${params.length}`;
    }
    if (checklistId) {
      params.push(checklistId);
      where += ` AND r.checklist_id = $${params.length}`;
    }
    params.push(limit, offset);

    const { rows } = await pool.query(
      `SELECT r.*, c.name AS checklist_name, c.checklist_type
         FROM restaurant_checklist_runs r
         JOIN restaurant_checklists c ON c.id = r.checklist_id
        WHERE ${where}
        ORDER BY r.started_at DESC
        LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
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
    const restaurant = await requireRestaurantAccess(req.user.id, restaurantId);
    const manage = await permissionsService.hasRestaurantPermission(
      restaurant,
      req.user.id,
      MANAGE_PERMISSION_CODES,
    );
    const { rows } = await pool.query(
      `SELECT * FROM restaurant_sops WHERE restaurant_id = $1 AND archived_at IS NULL AND ($2::boolean OR is_published=TRUE) ORDER BY category ASC, title ASC`,
      [restaurantId, manage],
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
    await assertManage(restaurant, req.user.id);
    const title = normalizeString(req.body.title, 200);
    if (!title)
      throw new AppError("Validation failed", 400, "validation_failed", {
        title: "Title is required",
      });
    const category = enumValue(req.body.category, SOP_CATEGORIES, "general");
    if (asBool(req.body.isPublished, true))
      v.text(req.body.body, "body", 20000);
    const {
      rows: [sop],
    } = await auditedQuery(
      req,
      restaurant,
      "restaurant_sops",
      null,
      `INSERT INTO restaurant_sops (restaurant_id, title, category, body, is_published, created_by)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING *`,
      [
        restaurantId,
        title,
        category,
        normalizeString(req.body.body, 20000),
        asBool(req.body.isPublished, true),
        req.user.id,
      ],
    );
    res.status(201).json({ sop });
  } catch (err) {
    next(err);
  }
};

exports.updateSop = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId),
      sopId = parsePositiveInt(req.params.sopId);
    const restaurant = await requireRestaurantAccess(req.user.id, restaurantId);
    await assertManage(restaurant, req.user.id);
    const sop = await withTransaction(
      pool,
      async (client) => {
        const {
          rows: [before],
        } = await client.query(
          "SELECT * FROM restaurant_sops WHERE id=$1 AND restaurant_id=$2 AND archived_at IS NULL FOR UPDATE",
          [sopId, restaurantId],
        );
        if (!before) throw new AppError("SOP not found", 404, "sop_not_found");
        const b = req.body,
          next = {
            title:
              b.title === undefined
                ? before.title
                : v.text(b.title, "title", 200),
            category: enumValue(b.category, SOP_CATEGORIES, before.category),
            body:
              b.body === undefined
                ? before.body
                : normalizeString(b.body, 20000),
            is_published:
              b.isPublished === undefined
                ? before.is_published
                : asBool(b.isPublished),
          };
        if (next.is_published) v.text(next.body, "body", 20000);
        if (Object.keys(next).every((k) => next[k] === before[k]))
          return before;
        await client.query(
          "INSERT INTO restaurant_sop_versions(sop_id,version,title,body) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING",
          [sopId, before.version, before.title, before.body],
        );
        const {
          rows: [after],
        } = await client.query(
          "UPDATE restaurant_sops SET title=$3,category=$4,body=$5,is_published=$6,version=version+1,updated_at=NOW() WHERE id=$1 AND restaurant_id=$2 RETURNING *",
          [
            sopId,
            restaurantId,
            next.title,
            next.category,
            next.body,
            next.is_published,
          ],
        );
        await client.query(
          "INSERT INTO restaurant_sop_versions(sop_id,version,title,body) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING",
          [sopId, after.version, after.title, after.body],
        );
        await audit(client, req, restaurant, "restaurant_sops", before, after);
        return after;
      },
      "restaurant_sop_update",
    );
    res.json({ sop });
  } catch (error) {
    next(error);
  }
};

exports.deleteSop = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    const sopId = parsePositiveInt(req.params.sopId);
    const restaurant = await requireRestaurantAccess(req.user.id, restaurantId);
    await assertManage(restaurant, req.user.id);
    const { rowCount } = await auditedQuery(
      req,
      restaurant,
      "restaurant_sops",
      sopId,
      `UPDATE restaurant_sops SET archived_at=NOW(),is_published=FALSE WHERE id = $1 AND restaurant_id = $2 RETURNING *`,
      [sopId, restaurantId],
    );
    if (!rowCount) throw new AppError("SOP not found", 404, "sop_not_found");
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
};

exports.listOperatingStores = async (req, res, next) => {
  try {
    const r = await attachScope(
      await requireRestaurantAccess(
        req.user.id,
        parsePositiveInt(req.params.restaurantId),
      ),
      req.user.id,
    );
    const params = [r.id];
    let filter = "";
    if (r.locationScope.mode === "assigned") {
      params.push(r.locationScope.location_ids);
      filter = " AND id=ANY($2::bigint[])";
    }
    const { rows } = await pool.query(
      `SELECT id,name,timezone,is_primary FROM restaurant_locations WHERE restaurant_id=$1 AND status <> 'archived'${filter} ORDER BY is_primary DESC,id`,
      params,
    );
    res.json({
      stores: rows,
      brandAccess: r.locationScope.mode !== "assigned",
    });
  } catch (error) {
    next(error);
  }
};
