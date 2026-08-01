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

function asBool(value, fallback = false) {
  if (value === undefined || value === null) return fallback;
  if (typeof value === 'boolean') return value;
  if (value === 'true' || value === '1' || value === 1) return true;
  if (value === 'false' || value === '0' || value === 0) return false;
  return fallback;
}

const MANAGE_ROLES = new Set(['owner', 'manager']);
const LANGUAGES = new Set(['English', 'Español', 'Français', 'Kreyol']);

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

async function loadKioskConfig(restaurantId) {
  const { rows: [config] } = await pool.query(
    `SELECT restaurant_id, preferred_language, locked_mode, auto_reset_seconds, updated_at
       FROM restaurant_kiosk_settings
      WHERE restaurant_id = $1`,
    [restaurantId]
  );
  return config || {
    restaurant_id: restaurantId,
    preferred_language: 'English',
    locked_mode: true,
    auto_reset_seconds: 8,
    updated_at: null,
  };
}

exports.getPublicKioskConfig = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    if (!restaurantId) throw new AppError('Restaurant not found', 404, 'restaurant_not_found');
    const { rows: restaurants } = await pool.query(
      `SELECT fr.id
         FROM food_restaurants fr
         JOIN businesses b ON b.id = fr.business_id
        WHERE fr.id = $1
          AND fr.status IN ('active', 'paused')
          AND b.is_active = TRUE
          AND b.deleted_at IS NULL`,
      [restaurantId]
    );
    if (!restaurants[0]) throw new AppError('Restaurant not found', 404, 'restaurant_not_found');
    res.json({ kioskConfig: await loadKioskConfig(restaurantId) });
  } catch (err) {
    next(err);
  }
};

exports.getKioskConfig = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    await requireRestaurantAccess(req.user.id, restaurantId);
    res.json({ kioskConfig: await loadKioskConfig(restaurantId) });
  } catch (err) {
    next(err);
  }
};

exports.upsertKioskConfig = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    const restaurant = await requireRestaurantAccess(req.user.id, restaurantId);
    assertManage(restaurant);

    const preferredLanguage = LANGUAGES.has(req.body.preferredLanguage || req.body.preferred_language)
      ? (req.body.preferredLanguage || req.body.preferred_language)
      : 'English';
    const lockedMode = asBool(req.body.lockedMode ?? req.body.locked_mode, true);
    const autoResetSeconds = Math.max(3, Math.min(60, Number.parseInt(req.body.autoResetSeconds ?? req.body.auto_reset_seconds, 10) || 8));

    const { rows: [kioskConfig] } = await pool.query(
      `INSERT INTO restaurant_kiosk_settings
         (restaurant_id, preferred_language, locked_mode, auto_reset_seconds, updated_by)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (restaurant_id) DO UPDATE
         SET preferred_language = EXCLUDED.preferred_language,
             locked_mode = EXCLUDED.locked_mode,
             auto_reset_seconds = EXCLUDED.auto_reset_seconds,
             updated_by = EXCLUDED.updated_by,
             updated_at = NOW()
       RETURNING restaurant_id, preferred_language, locked_mode, auto_reset_seconds, updated_at`,
      [restaurantId, preferredLanguage, lockedMode, autoResetSeconds, req.user.id]
    );

    res.json({ kioskConfig });
  } catch (err) {
    next(err);
  }
};
