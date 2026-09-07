'use strict';

const pool = require('../db');
const { AppError } = require('../middleware/errorHandler');
const { withTransaction } = require('../utils/transaction');
const socketService = require('../services/socketService');
const { consumeInventoryForOrder } = require('../services/restaurantInventoryOrderService');

function emitDeliveryHandoff(restaurantId, order) {
  if (!order) return;
  try {
    socketService.broadcastToRestaurantDisplay(restaurantId, 'food:display:changed', {
      restaurantId: String(restaurantId),
      queueNumber: order.queue_number ?? null,
      status: order.status,
    });
  } catch (_) {
    // Polling remains the fallback when realtime delivery is unavailable.
  }
}

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
  if (value === 'true' || value === '1' || value === 1) return true;
  if (value === 'false' || value === '0' || value === 0) return false;
  return fallback;
}

function parseAmount(value, field = 'amount') {
  if (value === undefined || value === null || value === '') return 0;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) {
    throw new AppError('Validation failed', 400, 'validation_failed', { [field]: 'Must be a non-negative number' });
  }
  return Math.round(n * 100) / 100;
}

const MANAGE_ROLES = new Set(['owner', 'manager']);
const TASK_TYPES = new Set(['Delivery', 'Customer pickup', 'Catering', 'Logistics', 'Supplier return']);
const TASK_STATUSES = new Set(['Queued', 'Assigned', 'Ready', 'Picked up', 'En route', 'Completed', 'Issue', 'Cancelled']);
const TASK_INITIAL_STATUSES = new Set(['Queued', 'Assigned', 'Ready']);
const TASK_TRANSITIONS = {
  Queued: new Set(['Assigned', 'Cancelled']),
  Assigned: new Set(['Ready', 'Issue', 'Cancelled']),
  Ready: new Set(['Picked up', 'Issue', 'Cancelled']),
  'Picked up': new Set(['En route', 'Issue']),
  'En route': new Set(['Completed', 'Issue']),
  Issue: new Set(['Assigned', 'Ready', 'Picked up', 'En route', 'Cancelled']),
  Completed: new Set(),
  Cancelled: new Set(),
};

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

async function assertTask(restaurantId, taskId) {
  const { rows } = await pool.query(
    `SELECT * FROM restaurant_runner_tasks WHERE restaurant_id = $1 AND id = $2`,
    [restaurantId, taskId]
  );
  const task = rows[0];
  if (!task) throw new AppError('Runner task not found', 404, 'runner_task_not_found');
  return task;
}

function assertTaskActor(restaurant, task, userId) {
  if (MANAGE_ROLES.has(restaurant.effective_role)) return true;
  if (!task.assigned_to || String(task.assigned_to) !== String(userId)) {
    throw new AppError('This runner task is assigned to another user', 403, 'runner_task_not_assigned');
  }
  return false;
}

exports.getDashboard = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    await requireRestaurantAccess(req.user.id, restaurantId);

    const [{ rows: tasks }, { rows: contactRules }, { rows: proofs }, { rows: issues }, { rows: paymentNotes }] = await Promise.all([
      pool.query(
        `SELECT * FROM restaurant_runner_tasks
          WHERE restaurant_id = $1
          ORDER BY
            CASE status
              WHEN 'Ready' THEN 0
              WHEN 'Assigned' THEN 1
              WHEN 'Queued' THEN 2
              WHEN 'Picked up' THEN 3
              WHEN 'En route' THEN 4
              WHEN 'Issue' THEN 5
              WHEN 'Completed' THEN 6
              ELSE 7
            END,
            created_at DESC`,
        [restaurantId]
      ),
      pool.query(
        `SELECT * FROM restaurant_runner_contact_rules
          WHERE restaurant_id = $1 AND is_active = TRUE
          ORDER BY sort_order ASC, id ASC`,
        [restaurantId]
      ),
      pool.query(
        `SELECT p.*, t.order_reference, t.stop_name
           FROM restaurant_runner_proofs p
           JOIN restaurant_runner_tasks t ON t.id = p.task_id
          WHERE p.restaurant_id = $1
          ORDER BY p.created_at DESC
          LIMIT 50`,
        [restaurantId]
      ),
      pool.query(
        `SELECT i.*, t.order_reference, t.stop_name
           FROM restaurant_runner_issue_reports i
           JOIN restaurant_runner_tasks t ON t.id = i.task_id
          WHERE i.restaurant_id = $1
          ORDER BY i.created_at DESC
          LIMIT 50`,
        [restaurantId]
      ),
      pool.query(
        `SELECT p.*, t.order_reference
           FROM restaurant_runner_payment_notes p
           JOIN restaurant_runner_tasks t ON t.id = p.task_id
          WHERE p.restaurant_id = $1
          ORDER BY p.created_at DESC
          LIMIT 50`,
        [restaurantId]
      ),
    ]);

    res.json({ tasks, contactRules, proofs, issues, paymentNotes });
  } catch (err) {
    next(err);
  }
};

exports.createTask = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    const restaurant = await requireRestaurantAccess(req.user.id, restaurantId);
    assertManage(restaurant);

    const orderReference = normalizeString(req.body.orderReference, 80);
    const stopName = normalizeString(req.body.stopName, 200);
    if (!orderReference || !stopName) {
      throw new AppError('Validation failed', 400, 'validation_failed', {
        orderReference: 'Order reference is required',
        stopName: 'Stop name is required',
      });
    }
    const taskType = TASK_TYPES.has(req.body.taskType) ? req.body.taskType : 'Delivery';
    const foodOrderId = parsePositiveInt(req.body.foodOrderId);
    const assignedTo = req.body.assignedTo || null;
    if (foodOrderId) {
      const { rows: [order] } = await pool.query(
        `SELECT id, fulfillment_type FROM food_orders WHERE id = $1 AND restaurant_id = $2`,
        [foodOrderId, restaurantId]
      );
      if (!order) throw new AppError('Order not found', 404, 'order_not_found');
      if (taskType === 'Delivery' && order.fulfillment_type !== 'delivery') {
        throw new AppError('Delivery tasks must reference a delivery order', 409, 'runner_order_not_delivery');
      }
    }
    if (assignedTo) {
      try {
        await requireRestaurantAccess(assignedTo, restaurantId);
      } catch (err) {
        throw new AppError('Validation failed', 400, 'validation_failed', {
          assignedTo: 'Assigned runner must be active at this restaurant',
        });
      }
    }
    if (req.body.status && !TASK_INITIAL_STATUSES.has(req.body.status)) {
      throw new AppError('Validation failed', 400, 'validation_failed', {
        status: 'A new runner task must start as Queued, Assigned, or Ready',
      });
    }
    let status = TASK_INITIAL_STATUSES.has(req.body.status) ? req.body.status : (assignedTo ? 'Assigned' : 'Queued');
    if (status === 'Assigned' && !assignedTo) status = 'Queued';
    if (status === 'Queued' && assignedTo) status = 'Assigned';

    const { rows: [task] } = await pool.query(
      `INSERT INTO restaurant_runner_tasks
         (restaurant_id, food_order_id, order_reference, stop_name, task_type, status,
          route_window, customer_contact_rule, requires_proof, cash_collection_required,
          notes, assigned_to, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       RETURNING *`,
      [
        restaurantId,
        foodOrderId,
        orderReference,
        stopName,
        taskType,
        status,
        normalizeString(req.body.routeWindow, 80),
        normalizeString(req.body.customerContactRule, 2000),
        taskType === 'Delivery' ? true : asBool(req.body.requiresProof),
        asBool(req.body.cashCollectionRequired),
        normalizeString(req.body.notes, 2000),
        assignedTo,
        req.user.id,
      ]
    );
    res.status(201).json({ task });
  } catch (err) {
    next(err);
  }
};

exports.createContactRule = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    const restaurant = await requireRestaurantAccess(req.user.id, restaurantId);
    assertManage(restaurant);

    const title = normalizeString(req.body.title, 160);
    const detail = normalizeString(req.body.detail, 2000);
    if (!title || !detail) {
      throw new AppError('Validation failed', 400, 'validation_failed', {
        title: 'Title is required',
        detail: 'Detail is required',
      });
    }

    const { rows: [rule] } = await pool.query(
      `INSERT INTO restaurant_runner_contact_rules
         (restaurant_id, title, detail, sort_order, created_by)
       VALUES ($1,$2,$3,$4,$5)
       RETURNING *`,
      [restaurantId, title, detail, Number.parseInt(req.body.sortOrder, 10) || 0, req.user.id]
    );
    res.status(201).json({ contactRule: rule });
  } catch (err) {
    next(err);
  }
};

exports.updateTaskStatus = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    const taskId = parsePositiveInt(req.params.taskId);
    const restaurant = await requireRestaurantAccess(req.user.id, restaurantId);
    const currentTask = await assertTask(restaurantId, taskId);
    assertTaskActor(restaurant, currentTask, req.user.id);

    const status = TASK_STATUSES.has(req.body.status) ? req.body.status : null;
    if (!status) {
      throw new AppError('Validation failed', 400, 'validation_failed', { status: 'Unsupported status' });
    }
    if (status !== currentTask.status && !TASK_TRANSITIONS[currentTask.status]?.has(status)) {
      throw new AppError(
        `Runner task cannot move from ${currentTask.status} to ${status}`,
        409,
        'illegal_runner_status_transition'
      );
    }
    if (status === 'Completed' && currentTask.requires_proof) {
      const { rows: [proof] } = await pool.query(
        `SELECT 1 FROM restaurant_runner_proofs WHERE restaurant_id = $1 AND task_id = $2 LIMIT 1`,
        [restaurantId, taskId]
      );
      if (!proof) throw new AppError('Handoff proof is required before completion', 409, 'runner_proof_required');
    }

    const { rows: [task] } = await pool.query(
      `UPDATE restaurant_runner_tasks
          SET status = $1,
              picked_up_at = CASE WHEN $1 = 'Picked up' AND picked_up_at IS NULL THEN NOW() ELSE picked_up_at END,
              completed_at = CASE WHEN $1 = 'Completed' THEN NOW() ELSE completed_at END,
              handoff_at = CASE WHEN $1 = 'Completed' THEN COALESCE(handoff_at, NOW()) ELSE handoff_at END,
              updated_at = NOW()
        WHERE restaurant_id = $2 AND id = $3
        RETURNING *`,
      [status, restaurantId, taskId]
    );
    if (status === 'Completed' && task.food_order_id) {
      const { rows: [completedOrder] } = await pool.query(
        `UPDATE food_orders
            SET status = 'completed',
                kitchen_stage = 'handed_off',
                completed_at = COALESCE(completed_at, NOW()),
                handed_off_at = COALESCE(handed_off_at, NOW()),
                handed_off_by = COALESCE(handed_off_by, $3),
                updated_at = NOW()
          WHERE id = $1 AND restaurant_id = $2 AND fulfillment_type = 'delivery'
            AND status IN ('accepted','preparing','ready')
          RETURNING *`,
        [task.food_order_id, restaurantId, req.user.id]
      );
      if (completedOrder) {
        await consumeInventoryForOrder(pool, {
          restaurantId,
          orderId: completedOrder.id,
          actorUserId: req.user.id,
        });
        await pool.query(
          `INSERT INTO restaurant_kitchen_events
             (restaurant_id, food_order_id, event_type, from_status, to_status, reason, metadata, created_by)
           VALUES ($1,$2,'order_delivery_handoff','ready','completed',$3,$4::jsonb,$5)`,
          [restaurantId, completedOrder.id, normalizeString(req.body.note, 1000), JSON.stringify({ runnerTaskId: task.id }), req.user.id]
        );
        emitDeliveryHandoff(restaurantId, completedOrder);
      }
    }
    res.json({ task });
  } catch (err) {
    next(err);
  }
};

exports.logProof = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    const taskId = parsePositiveInt(req.params.taskId);
    const restaurant = await requireRestaurantAccess(req.user.id, restaurantId);
    const task = await assertTask(restaurantId, taskId);
    assertTaskActor(restaurant, task, req.user.id);
    if (!['Picked up', 'En route', 'Issue'].includes(task.status)) {
      throw new AppError('Proof can only complete an active handoff', 409, 'runner_proof_not_allowed');
    }
    const result = await withTransaction(pool, async (client) => {
      const { rows: [proof] } = await client.query(
        `INSERT INTO restaurant_runner_proofs
           (restaurant_id, task_id, method, note, created_by)
         VALUES ($1,$2,$3,$4,$5)
         RETURNING *`,
        [restaurantId, taskId, normalizeString(req.body.method, 40) || 'Photo / signature',
          normalizeString(req.body.note, 2000), req.user.id]
      );
      const { rows: [updatedTask] } = await client.query(
        `UPDATE restaurant_runner_tasks
            SET status = 'Completed', completed_at = NOW(), handoff_at = COALESCE(handoff_at, NOW()), updated_at = NOW()
          WHERE restaurant_id = $1 AND id = $2 AND status = $3
          RETURNING *`,
        [restaurantId, taskId, task.status]
      );
      if (!updatedTask) throw new AppError('Runner task changed before proof was submitted', 409, 'runner_task_conflict');
      if (updatedTask.food_order_id) {
        const { rows: [completedOrder] } = await client.query(
          `UPDATE food_orders
              SET status = 'completed',
                  kitchen_stage = 'handed_off',
                  completed_at = COALESCE(completed_at, NOW()),
                  handed_off_at = COALESCE(handed_off_at, NOW()),
                  handed_off_by = COALESCE(handed_off_by, $3),
                  updated_at = NOW()
            WHERE id = $1 AND restaurant_id = $2 AND fulfillment_type = 'delivery'
              AND status IN ('accepted','preparing','ready')
            RETURNING *`,
          [updatedTask.food_order_id, restaurantId, req.user.id]
        );
        if (completedOrder) {
          await consumeInventoryForOrder(client, {
            restaurantId,
            orderId: completedOrder.id,
            actorUserId: req.user.id,
          });
          await client.query(
            `INSERT INTO restaurant_kitchen_events
               (restaurant_id, food_order_id, event_type, from_status, to_status, reason, metadata, created_by)
             VALUES ($1,$2,'order_delivery_handoff','ready','completed',$3,$4::jsonb,$5)`,
            [restaurantId, completedOrder.id, normalizeString(req.body.note, 1000), JSON.stringify({ runnerTaskId: updatedTask.id, proofId: proof.id }), req.user.id]
          );
        }
        return { proof, task: updatedTask, order: completedOrder || null };
      }
      return { proof, task: updatedTask, order: null };
    });
    emitDeliveryHandoff(restaurantId, result.order);
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
};

exports.reportIssue = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    const taskId = parsePositiveInt(req.params.taskId);
    const restaurant = await requireRestaurantAccess(req.user.id, restaurantId);
    const task = await assertTask(restaurantId, taskId);
    assertTaskActor(restaurant, task, req.user.id);
    if (['Completed', 'Cancelled'].includes(task.status)) {
      throw new AppError('A terminal runner task cannot report a new issue', 409, 'runner_task_terminal');
    }

    const note = normalizeString(req.body.note, 2000);
    if (!note) throw new AppError('Validation failed', 400, 'validation_failed', { note: 'Issue note is required' });

    const { rows: [issue] } = await pool.query(
      `INSERT INTO restaurant_runner_issue_reports
         (restaurant_id, task_id, severity, note, created_by)
       VALUES ($1,$2,$3,$4,$5)
       RETURNING *`,
      [
        restaurantId,
        taskId,
        normalizeString(req.body.severity, 40) || 'Needs follow-up',
        note,
        req.user.id,
      ]
    );
    await pool.query(
      `UPDATE restaurant_runner_tasks
          SET status = 'Issue', updated_at = NOW()
        WHERE restaurant_id = $1 AND id = $2`,
      [restaurantId, taskId]
    );
    res.status(201).json({ issue });
  } catch (err) {
    next(err);
  }
};

exports.logPaymentNote = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    const taskId = parsePositiveInt(req.params.taskId);
    const restaurant = await requireRestaurantAccess(req.user.id, restaurantId);
    const task = await assertTask(restaurantId, taskId);
    assertTaskActor(restaurant, task, req.user.id);

    const { rows: [paymentNote] } = await pool.query(
      `INSERT INTO restaurant_runner_payment_notes
         (restaurant_id, task_id, amount, note, created_by)
       VALUES ($1,$2,$3,$4,$5)
       RETURNING *`,
      [restaurantId, taskId, parseAmount(req.body.amount), normalizeString(req.body.note, 2000), req.user.id]
    );
    res.status(201).json({ paymentNote });
  } catch (err) {
    next(err);
  }
};
