'use strict';
// F-20: baseline audit for every successful restaurant write.
//
// Handlers that write a rich before/after entry (logBusinessAction) mark the
// request, and this middleware then stays silent. Every other successful
// POST/PUT/PATCH/DELETE under /restaurants/:restaurantId gets one entry with
// the route pattern, ids from the URL, store and status. Never the request
// body: bodies can hold card, contact or free-text personal data.
const pool = require('../db');
const logger = require('../utils/logger');
const { logBusinessAction } = require('../services/businessAuditLog');

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
// Machine traffic with no business meaning (liveness and delivery receipts).
const SKIP = [/\/heartbeat$/, /\/ack$/, /\/feed-ack$/];
const ID = /^[A-Za-z0-9_-]{1,64}$/;
const businessCache = new Map();

async function businessFor(restaurantId) {
  const hit = businessCache.get(restaurantId);
  if (hit && hit.at > Date.now() - 10 * 60 * 1000) return hit.id;
  const { rows: [row] } = await pool.query('SELECT business_id FROM food_restaurants WHERE id=$1', [restaurantId]);
  const id = row?.business_id || null;
  if (businessCache.size > 5000) businessCache.clear();
  businessCache.set(restaurantId, { id, at: Date.now() });
  return id;
}

function entryFor(req, statusCode, { include = null, exclude = [] } = {}) {
  const pattern = req.route?.path;
  if (!pattern || SKIP.some((re) => re.test(pattern))) return null;
  if (include && !include.test(pattern)) return null;
  if (exclude.some((re) => re.test(pattern))) return null;
  const params = {};
  for (const [k, v] of Object.entries(req.params || {})) if (ID.test(String(v))) params[k] = String(v);
  const restaurantId = Number(params.restaurantId || (/\/restaurants\/(\d+)\//.exec(req.originalUrl || '') || [])[1]);
  if (!Number.isSafeInteger(restaurantId) || restaurantId <= 0) return null;
  const rawLocation = params.locationId ?? req.body?.locationId ?? req.body?.location_id ?? req.query?.locationId;
  const location = Number(rawLocation);
  const parts = pattern.split('/').filter((s) => s && !s.startsWith(':'));
  const resource = (parts[0] === 'restaurants' ? parts[1] : parts[0]) || 'restaurant';
  return {
    restaurantId,
    action: `restaurant.${resource}.${req.method.toLowerCase()}`.slice(0, 80),
    target_type: 'restaurant_route',
    target_id: `${req.method} ${pattern}`.slice(0, 120),
    metadata: {
      params,
      status: statusCode,
      ...(Number.isSafeInteger(location) && location > 0 ? { location_id: String(location) } : {}),
      ...(req.user ? {} : { actor: 'device' }),
      source: 'request_audit',
    },
  };
}

function createRestaurantRequestAudit(options = {}) {
  return function restaurantRequestAudit(req, res, next) {
  if (!MUTATING.has(req.method)) return next();
  // Route unit tests script exact db mock sequences; they opt in explicitly.
  if (process.env.NODE_ENV === 'test' && process.env.RESTAURANT_REQUEST_AUDIT_IN_TESTS !== 'true') return next();
  res.on('finish', () => {
    if (res.statusCode >= 400 || req.auditRecorded) return;
    const entry = entryFor(req, res.statusCode, options);
    if (!entry) return;
    businessFor(entry.restaurantId)
      .then((businessId) => businessId && logBusinessAction(req, { ...entry, business_id: businessId, _baseline: true }))
      .catch((err) => logger.warn('restaurant request audit failed', { err: err && err.message }));
  });
  return next();
  };
}

const restaurantRequestAudit = createRestaurantRequestAudit();
// /api/food mixes customer and merchant routes; only merchant writes on a
// restaurant are business audit events.
const foodMerchantRequestAudit = createRestaurantRequestAudit({
  include: /^\/restaurants\/:restaurantId(\/|$)/,
  exclude: [/\/campaign-click$/, /\/orders\/quote$/, /\/messages$/, /\/reports$/],
});

module.exports = { restaurantRequestAudit, foodMerchantRequestAudit, createRestaurantRequestAudit, entryFor, _cache: businessCache };
