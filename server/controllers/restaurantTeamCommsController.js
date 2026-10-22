'use strict';

// OxSteed Restaurants — Team communication (staff review S-17): restaurant
// announcements with per-staff acknowledgement, and the manager log book.
//
// Access model mirrors restaurantOpsController: any active member can read
// announcements and the log book and acknowledge announcements; only
// owner/manager can post announcements or write log book entries.
//
// Posting an announcement notifies every other active team member through
// notificationService. The notification carries type + params (S-19): the
// client translates `restaurant_announcement` from data.params instead of
// relying on the stored English title/body, which remain as the fallback
// for push/email and older clients.

const pool = require('../db');
const { AppError } = require('../middleware/errorHandler');
const { resolveRestaurantAccess } = require('../services/scopeModel');
const permissionsService = require('../services/permissionsService');
const { getLocationScope } = require('../services/restaurantLocationAccessService');
const { sendNotification } = require('../services/notificationService');
const logger = require('../utils/logger');

const MY_SHIFT_URL = '/restaurants/merchant?tab=myshift';

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

async function requireRestaurantAccess(userId, restaurantId) {
  if (!restaurantId) throw new AppError('Restaurant not found', 404, 'restaurant_not_found');
  return resolveRestaurantAccess(userId, restaurantId);
}

async function assertManage(restaurant, userId) {
  const allowed = await permissionsService.hasRestaurantPermission(restaurant, userId, ['restaurant.manage']);
  if (!allowed) {
    throw new AppError('You do not have permission to manage this restaurant', 403, 'forbidden');
  }
}

// Every user who should hear about team news for this restaurant: active
// business members plus the business owner, minus the author.
async function teamRecipientIds(restaurant, authorUserId) {
  const { rows } = await pool.query(
    `SELECT bm.member_id AS user_id
       FROM business_members bm
      WHERE bm.business_id = $1 AND bm.status = 'active' AND bm.member_id IS NOT NULL
     UNION
     SELECT b.user_id AS user_id
       FROM businesses b
      WHERE b.id = $1`,
    [restaurant.business_id]
  );
  return rows
    .map((r) => r.user_id)
    .filter((id) => id && String(id) !== String(authorUserId));
}

async function notifyTeam(restaurant, authorUserId, payload) {
  try {
    const recipients = await teamRecipientIds(restaurant, authorUserId);
    await Promise.all(recipients.map((userId) => sendNotification({ userId, ...payload })));
  } catch (err) {
    // Announcements are already saved; a notification fan-out failure must
    // not fail the request (sendNotification also never throws).
    logger.warn('[TeamComms] notification fan-out failed', { error: err.message });
  }
}

// ── Announcements ────────────────────────────────────────────────────────────
exports.listAnnouncements = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    await requireRestaurantAccess(req.user.id, restaurantId);
    const { rows } = await pool.query(
      `SELECT a.*,
              u.first_name AS author_first_name,
              u.last_name AS author_last_name,
              COUNT(ack.user_id)::int AS ack_count,
              BOOL_OR(ack.user_id = $2) AS acknowledged_by_me
         FROM restaurant_announcements a
         JOIN users u ON u.id = a.author_user_id
         LEFT JOIN restaurant_announcement_acks ack ON ack.announcement_id = a.id
        WHERE a.restaurant_id = $1
        GROUP BY a.id, u.first_name, u.last_name
        ORDER BY a.created_at DESC
        LIMIT 50`,
      [restaurantId, req.user.id]
    );
    res.json({
      announcements: rows.map((row) => ({
        ...row,
        ack_count: row.ack_count || 0,
        acknowledged_by_me: Boolean(row.acknowledged_by_me),
      })),
    });
  } catch (err) {
    next(err);
  }
};

exports.createAnnouncement = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    const restaurant = await requireRestaurantAccess(req.user.id, restaurantId);
    await assertManage(restaurant, req.user.id);
    const title = normalizeString(req.body.title, 200);
    if (!title) {
      throw new AppError('Validation failed', 400, 'validation_failed', { title: 'Title is required' });
    }
    const body = normalizeString(req.body.body, 4000) || '';
    const { rows: [announcement] } = await pool.query(
      `INSERT INTO restaurant_announcements (restaurant_id, author_user_id, title, body)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [restaurantId, req.user.id, title, body]
    );
    await notifyTeam(restaurant, req.user.id, {
      type: 'restaurant_announcement',
      title: `Announcement from ${restaurant.display_name}`,
      body: title,
      action_url: MY_SHIFT_URL,
      data: {
        restaurantId,
        announcementId: announcement.id,
        params: {
          restaurantName: restaurant.display_name,
          announcementTitle: title,
        },
      },
    });
    res.status(201).json({ announcement: { ...announcement, ack_count: 0, acknowledged_by_me: false } });
  } catch (err) {
    next(err);
  }
};

exports.acknowledgeAnnouncement = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    const announcementId = parsePositiveInt(req.params.announcementId);
    await requireRestaurantAccess(req.user.id, restaurantId);
    const { rows: [announcement] } = await pool.query(
      `SELECT id FROM restaurant_announcements WHERE id = $1 AND restaurant_id = $2`,
      [announcementId, restaurantId]
    );
    if (!announcement) throw new AppError('Announcement not found', 404, 'announcement_not_found');
    await pool.query(
      `INSERT INTO restaurant_announcement_acks (announcement_id, user_id)
       VALUES ($1, $2)
       ON CONFLICT (announcement_id, user_id) DO NOTHING`,
      [announcementId, req.user.id]
    );
    const { rows: [counts] } = await pool.query(
      `SELECT COUNT(*)::int AS ack_count FROM restaurant_announcement_acks WHERE announcement_id = $1`,
      [announcementId]
    );
    res.json({ acknowledged: true, ack_count: counts.ack_count });
  } catch (err) {
    next(err);
  }
};

// ── Manager log book ─────────────────────────────────────────────────────────
exports.listLogbook = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    const restaurant = await requireRestaurantAccess(req.user.id, restaurantId);
    const locationScope = await getLocationScope(restaurant, req.user.id);
    const params = locationScope.mode === 'assigned'
      ? [restaurantId, locationScope.location_ids]
      : [restaurantId];
    const locationFilter = locationScope.mode === 'assigned'
      ? ' AND (e.shift_id IS NULL OR s.location_id = ANY($2::bigint[]))'
      : '';
    const { rows } = await pool.query(
      `SELECT e.*,
              u.first_name AS author_first_name,
              u.last_name AS author_last_name,
              s.label AS shift_label
         FROM restaurant_logbook_entries e
         JOIN users u ON u.id = e.author_user_id
         LEFT JOIN restaurant_crew_shifts s ON s.id = e.shift_id
        WHERE e.restaurant_id = $1${locationFilter}
        ORDER BY e.created_at DESC
        LIMIT 50`,
      params
    );
    res.json({ entries: rows });
  } catch (err) {
    next(err);
  }
};

exports.createLogbookEntry = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    const restaurant = await requireRestaurantAccess(req.user.id, restaurantId);
    await assertManage(restaurant, req.user.id);
    const locationScope = await getLocationScope(restaurant, req.user.id);
    const body = normalizeString(req.body.body, 4000);
    if (!body) {
      throw new AppError('Validation failed', 400, 'validation_failed', { body: 'Note is required' });
    }
    const shiftId = parsePositiveInt(req.body.shiftId || req.body.shift_id);
    if (shiftId) {
      const { rows: [shift] } = await pool.query(
        `SELECT id, location_id FROM restaurant_crew_shifts WHERE id = $1 AND restaurant_id = $2${locationScope.mode === 'assigned' ? ' AND location_id = ANY($3::bigint[])' : ''}`,
        locationScope.mode === 'assigned' ? [shiftId, restaurantId, locationScope.location_ids] : [shiftId, restaurantId]
      );
      if (!shift) throw new AppError('Crew shift not found', 404, 'crew_shift_not_found');
    }
    const { rows: [entry] } = await pool.query(
      `INSERT INTO restaurant_logbook_entries (restaurant_id, author_user_id, shift_id, body)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [restaurantId, req.user.id, shiftId, body]
    );
    res.status(201).json({ entry });
  } catch (err) {
    next(err);
  }
};
