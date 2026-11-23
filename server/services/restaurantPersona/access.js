'use strict';
// Group 8 (items 351-450): restaurant persona access. Live restaurant role,
// catalog permissions and the store boundary (getLocationScope) are resolved
// server-side on every call; persona labels grant nothing.
const pool = require('../../db');
const AppError = require('../../utils/appError');
const { resolveRestaurantAccess } = require('../scopeModel');
const { getEffectivePermissions } = require('../permissionsService');
const { getLocationScope, assertLocationAccess } = require('../restaurantLocationAccessService');

const fail = (status, code, message) => { throw new AppError(message || code, status, code); };
const invalid = (field) => fail(400, 'validation_failed', field ? `Invalid ${field}` : 'Invalid input');
const posInt = (v, field) => { const n = Number(v); if (!Number.isSafeInteger(n) || n <= 0) invalid(field); return n; };
const optInt = (v, field, { min = 0, max = 1e9 } = {}) => { if (v == null || v === '') return null; const n = Number(v); if (!Number.isSafeInteger(n) || n < min || n > max) invalid(field); return n; };
function str(v, max, { required = true } = {}) {
  if (v == null || v === '') { if (required) invalid(); return null; }
  if (typeof v !== 'string') invalid();
  const s = v.trim(); if (!s && required) invalid(); if (s.length > max) invalid();
  return s || null;
}
const oneOf = (v, list, field, dflt) => { if (v == null || v === '') { if (dflt !== undefined) return dflt; invalid(field); } if (!list.includes(v)) invalid(field); return v; };
const iso = (v, field) => { if (typeof v !== 'string' || !Number.isFinite(Date.parse(v))) invalid(field); return new Date(v).toISOString(); };

async function rctx(userId, restaurantIdRaw) {
  const id = posInt(restaurantIdRaw, 'restaurantId');
  const restaurant = await resolveRestaurantAccess(userId, id);
  let perms = new Set();
  try {
    ({ permissions: perms } = await getEffectivePermissions({ businessId: restaurant.business_id, userId, role: restaurant.effective_role, membershipId: restaurant.effective_membership_id || null }));
  } catch { perms = new Set(); }
  const scope = await getLocationScope(restaurant, userId);
  return { userId, restaurant, restaurantId: Number(restaurant.id), role: restaurant.effective_role, perms, scope };
}
const can = (c, code) => c.role === 'owner' || c.perms.has('*') || c.perms.has(code);
const need = (c, code) => { if (!can(c, code)) fail(403, 'permission_required', `Requires ${code}`); };
// Store filter for SQL: null = all stores, array = assigned stores only.
const storeIds = c => (c.scope.mode === 'assigned' ? c.scope.location_ids : null);
async function location(c, locationId, db = pool) {
  const id = posInt(locationId, 'location_id');
  const { rows: [l] } = await db.query('SELECT * FROM restaurant_locations WHERE id=$1 AND restaurant_id=$2', [id, c.restaurantId]);
  if (!l) fail(404, 'location_not_found');
  await assertLocationAccess(c.restaurant, c.userId, id, db);
  return l;
}
async function order(c, orderId, db = pool, { lock = false } = {}) {
  const id = posInt(orderId, 'order_id');
  const { rows: [o] } = await db.query(`SELECT * FROM food_orders WHERE id=$1 AND restaurant_id=$2 ${lock ? 'FOR UPDATE' : ''}`, [id, c.restaurantId]);
  if (!o) fail(404, 'order_not_found');
  if (o.location_id) await assertLocationAccess(c.restaurant, c.userId, o.location_id, db).catch(() => fail(404, 'order_not_found'));
  return o;
}
// Managers for a store: owner + members whose role (or store role override) is manager.
async function storeManagers(c, locationId, db = pool) {
  const { rows } = await db.query(`SELECT b.user_id FROM businesses b WHERE b.id=$1
    UNION SELECT bm.member_id FROM business_members bm
      LEFT JOIN restaurant_location_memberships lm ON lm.membership_id=bm.id AND lm.restaurant_id=$2 AND lm.status='active' AND ($3::bigint IS NULL OR lm.location_id=$3)
     WHERE bm.business_id=$1 AND bm.status='active' AND bm.member_id IS NOT NULL AND COALESCE(lm.role_override, bm.role) IN ('manager','owner')
       AND ($3::bigint IS NULL OR lm.id IS NOT NULL OR NOT EXISTS (SELECT 1 FROM restaurant_location_memberships x WHERE x.membership_id=bm.id AND x.status='active'))`,
  [c.restaurant.business_id, c.restaurantId, locationId || null]);
  return rows.map(r => r.user_id).filter(Boolean);
}
const { notify } = require('../businessOwner/common');
module.exports = { fail, invalid, posInt, optInt, str, oneOf, iso, rctx, can, need, storeIds, location, order, storeManagers, notify };
