'use strict';

const pool = require('../db');
const { AppError } = require('../middleware/errorHandler');

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

const MANAGE_ROLES = new Set(['owner', 'manager']);
const URGENCIES = new Set(['Low', 'Medium', 'High']);
const STATUSES = new Set(['open', 'in_progress', 'resolved']);

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

exports.listHelpRequests = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    await requireRestaurantAccess(req.user.id, restaurantId);

    const { rows } = await pool.query(
      `SELECT *
         FROM restaurant_help_requests
        WHERE restaurant_id = $1
        ORDER BY created_at DESC, id DESC`,
      [restaurantId]
    );

    res.json({ helpRequests: rows });
  } catch (err) {
    next(err);
  }
};

exports.createHelpRequest = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    const restaurant = await requireRestaurantAccess(req.user.id, restaurantId);
    assertManage(restaurant);

    const title = normalizeString(req.body.title, 200);
    const detail = normalizeString(req.body.detail, 4000);
    if (!title) throw new AppError('Validation failed', 400, 'validation_failed', { title: 'Title is required' });
    if (!detail) throw new AppError('Validation failed', 400, 'validation_failed', { detail: 'Detail is required' });

    const urgency = URGENCIES.has(req.body.urgency) ? req.body.urgency : 'High';
    const linkedLocation = normalizeString(req.body.linkedLocation, 200);

    const { rows: [helpRequest] } = await pool.query(
      `INSERT INTO restaurant_help_requests
         (restaurant_id, title, detail, urgency, linked_location, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $6)
       RETURNING *`,
      [restaurantId, title, detail, urgency, linkedLocation, req.user.id]
    );

    res.status(201).json({ helpRequest });
  } catch (err) {
    next(err);
  }
};

exports.updateHelpRequest = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    const helpRequestId = parsePositiveInt(req.params.helpRequestId);
    const restaurant = await requireRestaurantAccess(req.user.id, restaurantId);
    assertManage(restaurant);

    const sets = [];
    const values = [];
    let index = 1;

    if (req.body.title !== undefined) {
      const title = normalizeString(req.body.title, 200);
      if (!title) throw new AppError('Validation failed', 400, 'validation_failed', { title: 'Title is required' });
      sets.push(`title = $${index++}`);
      values.push(title);
    }
    if (req.body.detail !== undefined) {
      const detail = normalizeString(req.body.detail, 4000);
      if (!detail) throw new AppError('Validation failed', 400, 'validation_failed', { detail: 'Detail is required' });
      sets.push(`detail = $${index++}`);
      values.push(detail);
    }
    if (req.body.urgency !== undefined) {
      if (!URGENCIES.has(req.body.urgency)) {
        throw new AppError('Validation failed', 400, 'validation_failed', { urgency: 'Urgency must be Low, Medium, or High' });
      }
      sets.push(`urgency = $${index++}`);
      values.push(req.body.urgency);
    }
    if (req.body.status !== undefined) {
      if (!STATUSES.has(req.body.status)) {
        throw new AppError('Validation failed', 400, 'validation_failed', { status: 'Status must be open, in_progress, or resolved' });
      }
      sets.push(`status = $${index++}`);
      values.push(req.body.status);
    }
    if (req.body.linkedLocation !== undefined) {
      sets.push(`linked_location = $${index++}`);
      values.push(normalizeString(req.body.linkedLocation, 200));
    }
    if (req.body.resolutionNote !== undefined) {
      sets.push(`resolution_note = $${index++}`);
      values.push(normalizeString(req.body.resolutionNote, 4000));
    }
    if (!sets.length) {
      throw new AppError('No updatable fields provided', 400, 'validation_failed', { body: 'No updatable fields provided' });
    }

    sets.push(`updated_by = $${index++}`);
    values.push(req.user.id);
    sets.push('updated_at = NOW()');

    const { rows: [helpRequest] } = await pool.query(
      `UPDATE restaurant_help_requests
          SET ${sets.join(', ')}
        WHERE id = $${index++}
          AND restaurant_id = $${index}
        RETURNING *`,
      [...values, helpRequestId, restaurantId]
    );

    if (!helpRequest) {
      throw new AppError('Help request not found', 404, 'help_request_not_found');
    }

    res.json({ helpRequest });
  } catch (err) {
    next(err);
  }
};
