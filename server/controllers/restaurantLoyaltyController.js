'use strict';

// Restaurant-scoped CRM segment definitions. This surface returns aggregate
// audience counts only: it never exposes customer IDs, names, or contact data.
// Campaign delivery is intentionally not wired to this contract yet.
const pool = require('../db');
const AppError = require('../utils/appError');
const { resolveRestaurantAccess } = require('../services/scopeModel');
const permissions = require('../services/permissionsService');
const { logBusinessAction } = require('../services/businessAuditLog');
const { withTransaction } = require('../utils/transaction');
const campaignService = require('../services/restaurantLoyaltyCampaignService');

const MAX_NAME_LENGTH = 120;
const MAX_SEGMENTS = 200;

async function access(req) {
  const restaurantId = Number.parseInt(req.params.restaurantId, 10);
  if (!Number.isSafeInteger(restaurantId) || restaurantId <= 0) {
    throw new AppError('Restaurant not found', 404, 'restaurant_not_found');
  }
  const restaurant = await resolveRestaurantAccess(req.user.id, restaurantId);
  if (!(await permissions.hasRestaurantPermission(restaurant, req.user.id, ['analytics.view_financial']))) {
    throw new AppError('You do not have permission to manage CRM segments', 403, 'forbidden');
  }
  return restaurant;
}

function positiveInt(value, field, { max = 1000000000, allowZero = true } = {}) {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  if (!Number.isSafeInteger(n) || (allowZero ? n < 0 : n <= 0) || n > max) {
    throw new AppError('Invalid CRM segment criteria', 400, 'validation_failed', { [field]: 'Must be a bounded integer' });
  }
  return n;
}

function normalizeName(value) {
  const name = String(value || '').trim();
  if (!name || name.length > MAX_NAME_LENGTH) {
    throw new AppError('Segment name is required', 400, 'validation_failed', { name: 'Required, max 120 characters' });
  }
  return name;
}

function normalizeActive(value) {
  if (typeof value === 'boolean') return value;
  if (value === 'true' || value === '1' || value === 1) return true;
  if (value === 'false' || value === '0' || value === 0) return false;
  throw new AppError('isActive must be a boolean', 400, 'validation_failed', { isActive: 'Invalid active flag' });
}

function normalizeCriteria(value) {
  if (value == null) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AppError('Criteria must be an object', 400, 'validation_failed', { criteria: 'Object required' });
  }
  const criteria = {};
  const minLifetimePoints = positiveInt(value.minLifetimePoints ?? value.min_lifetime_points, 'minLifetimePoints');
  const minOrders = positiveInt(value.minOrders ?? value.min_orders, 'minOrders');
  const daysSinceLastOrder = positiveInt(value.daysSinceLastOrder ?? value.days_since_last_order, 'daysSinceLastOrder', { max: 3650 });
  const locationId = positiveInt(value.locationId ?? value.location_id, 'locationId', { allowZero: false });
  if (minLifetimePoints !== null) criteria.min_lifetime_points = minLifetimePoints;
  if (minOrders !== null) criteria.min_orders = minOrders;
  if (daysSinceLastOrder !== null) criteria.days_since_last_order = daysSinceLastOrder;
  if (locationId !== null) criteria.location_id = locationId;
  const unknown = Object.keys(value).filter((key) => ![
    'minLifetimePoints', 'min_lifetime_points', 'minOrders', 'min_orders',
    'daysSinceLastOrder', 'days_since_last_order', 'locationId', 'location_id',
  ].includes(key));
  if (unknown.length) {
    throw new AppError('Unsupported CRM segment criteria', 400, 'validation_failed', { criteria: `Unknown field: ${unknown[0]}` });
  }
  return criteria;
}

function shape(row, audience = null) {
  return {
    id: Number(row.id),
    restaurantId: Number(row.restaurant_id),
    name: row.name,
    criteria: row.criteria || {},
    isActive: Boolean(row.is_active),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(audience ? { audience } : {}),
  };
}

function audienceWhere(criteria) {
  const clauses = [];
  const params = [];
  if (criteria.min_lifetime_points != null) {
    params.push(criteria.min_lifetime_points);
    clauses.push(`lifetime_points >= $${params.length}`);
  }
  if (criteria.min_orders != null) {
    params.push(criteria.min_orders);
    clauses.push(`paid_orders >= $${params.length}`);
  }
  if (criteria.days_since_last_order != null) {
    params.push(criteria.days_since_last_order);
    clauses.push(`(last_paid_order_at IS NULL OR last_paid_order_at <= NOW() - ($${params.length}::int * INTERVAL '1 day'))`);
  }
  if (criteria.location_id != null) {
    params.push(criteria.location_id);
    clauses.push(`has_location_order = TRUE`);
  }
  return { clauses, params };
}

async function audienceFor(restaurantId, criteria) {
  const { clauses, params } = audienceWhere(criteria);
  const locationParam = criteria.location_id != null ? params[params.length - 1] : null;
  const queryParams = [restaurantId, ...params];
  const locationPredicate = criteria.location_id != null ? `
          BOOL_OR(fo.location_id = $${queryParams.length}) AS has_location_order,` : '          FALSE AS has_location_order,';
  const { rows: [row] } = await pool.query(
    `WITH customer_rollup AS (
       SELECT fla.customer_id,
              fla.lifetime_points,
              COUNT(DISTINCT fo.id) FILTER (
                WHERE fo.payment_status = 'paid' AND fo.status NOT IN ('cancelled', 'refunded')
              )::int AS paid_orders,
              MAX(fo.created_at) FILTER (
                WHERE fo.payment_status = 'paid' AND fo.status NOT IN ('cancelled', 'refunded')
              ) AS last_paid_order_at,
              ${locationPredicate}
              COUNT(*) OVER ()::int AS total_customers
         FROM food_loyalty_accounts fla
         LEFT JOIN food_orders fo ON fo.restaurant_id = fla.restaurant_id AND fo.customer_id = fla.customer_id
        WHERE fla.restaurant_id = $1
        GROUP BY fla.customer_id, fla.lifetime_points
     )
     SELECT COALESCE(MAX(total_customers), 0)::int AS total_customers,
            COUNT(*) FILTER (WHERE ${clauses.length ? clauses.join(' AND ') : 'TRUE'})::int AS matching_customers
       FROM customer_rollup`,
    queryParams
  );
  // Keep the location value in the parameter list explicit for query review;
  // the generated SQL references the same last parameter used by BOOL_OR.
  void locationParam;
  return {
    totalCustomers: Number(row?.total_customers || 0),
    matchingCustomers: Number(row?.matching_customers || 0),
    customerIds: 'excluded',
  };
}

exports.listSegments = async (req, res, next) => {
  try {
    const restaurant = await access(req);
    const { rows } = await pool.query(
      `SELECT id, restaurant_id, name, criteria, is_active, created_at, updated_at
         FROM restaurant_loyalty_segments
        WHERE restaurant_id = $1
        ORDER BY is_active DESC, name ASC, id ASC
        LIMIT $2`,
      [restaurant.id, MAX_SEGMENTS]
    );
    const segments = await Promise.all(rows.map(async (row) => shape(row, await audienceFor(restaurant.id, row.criteria || {}))));
    res.json({ segments, campaignDeliveryEnabled: false });
  } catch (err) { next(err); }
};

exports.createSegment = async (req, res, next) => {
  try {
    const restaurant = await access(req);
    const name = normalizeName(req.body?.name);
    const criteria = normalizeCriteria(req.body?.criteria);
    const { rows: [row] } = await pool.query(
      `INSERT INTO restaurant_loyalty_segments (restaurant_id, name, criteria, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $4)
       RETURNING id, restaurant_id, name, criteria, is_active, created_at, updated_at`,
      [restaurant.id, name, JSON.stringify(criteria), req.user.id]
    );
    await logBusinessAction(req, {
      business_id: restaurant.business_id,
      actor_role: restaurant.effective_role,
      action: 'restaurant.loyalty_segment.created',
      target_type: 'restaurant_loyalty_segment',
      target_id: row.id,
      before_state: {},
      after_state: row,
      metadata: { campaign_delivery_enabled: false },
      throwOnError: true,
    });
    res.status(201).json({ segment: shape(row, await audienceFor(restaurant.id, criteria)), campaignDeliveryEnabled: false });
  } catch (err) {
    if (err?.code === '23505') return next(new AppError('That segment name already exists', 409, 'loyalty_segment_exists'));
    next(err);
  }
};

exports.updateSegment = async (req, res, next) => {
  try {
    const restaurant = await access(req);
    const id = positiveInt(req.params.segmentId, 'segmentId', { allowZero: false });
    if (!id) throw new AppError('Segment not found', 404, 'loyalty_segment_not_found');
    const { rows: [before] } = await pool.query('SELECT * FROM restaurant_loyalty_segments WHERE id = $1 AND restaurant_id = $2', [id, restaurant.id]);
    if (!before) throw new AppError('Segment not found', 404, 'loyalty_segment_not_found');
    const name = req.body?.name === undefined ? before.name : normalizeName(req.body.name);
    const criteria = req.body?.criteria === undefined ? (before.criteria || {}) : normalizeCriteria(req.body.criteria);
    const isActive = req.body?.isActive === undefined && req.body?.is_active === undefined
      ? Boolean(before.is_active) : normalizeActive(req.body.isActive ?? req.body.is_active);
    const { rows: [row] } = await pool.query(
      `UPDATE restaurant_loyalty_segments
          SET name = $3, criteria = $4, is_active = $5, updated_by = $6, updated_at = NOW()
        WHERE id = $1 AND restaurant_id = $2
       RETURNING id, restaurant_id, name, criteria, is_active, created_at, updated_at`,
      [id, restaurant.id, name, JSON.stringify(criteria), isActive, req.user.id]
    );
    await logBusinessAction(req, {
      business_id: restaurant.business_id,
      actor_role: restaurant.effective_role,
      action: 'restaurant.loyalty_segment.updated',
      target_type: 'restaurant_loyalty_segment',
      target_id: id,
      before_state: before,
      after_state: row,
      metadata: { campaign_delivery_enabled: false },
      throwOnError: true,
    });
    res.json({ segment: shape(row, await audienceFor(restaurant.id, criteria)), campaignDeliveryEnabled: false });
  } catch (err) {
    if (err?.code === '23505') return next(new AppError('That segment name already exists', 409, 'loyalty_segment_exists'));
    next(err);
  }
};

exports.deleteSegment = async (req, res, next) => {
  try {
    const restaurant = await access(req);
    const id = positiveInt(req.params.segmentId, 'segmentId', { allowZero: false });
    if (!id) throw new AppError('Segment not found', 404, 'loyalty_segment_not_found');
    const { rows: [before] } = await pool.query(
      'SELECT * FROM restaurant_loyalty_segments WHERE id = $1 AND restaurant_id = $2',
      [id, restaurant.id]
    );
    if (!before) throw new AppError('Segment not found', 404, 'loyalty_segment_not_found');
    const result = await pool.query('DELETE FROM restaurant_loyalty_segments WHERE id = $1 AND restaurant_id = $2', [id, restaurant.id]);
    if (!result.rowCount) throw new AppError('Segment not found', 404, 'loyalty_segment_not_found');
    await logBusinessAction(req, {
      business_id: restaurant.business_id,
      actor_role: restaurant.effective_role,
      action: 'restaurant.loyalty_segment.deleted',
      target_type: 'restaurant_loyalty_segment',
      target_id: id,
      before_state: before,
      after_state: {},
      metadata: {},
      throwOnError: true,
    });
    res.status(204).end();
  } catch (err) { next(err); }
};

exports.previewSegment = async (req, res, next) => {
  try {
    const restaurant = await access(req);
    const id = positiveInt(req.params.segmentId, 'segmentId', { allowZero: false });
    if (!id) throw new AppError('Segment not found', 404, 'loyalty_segment_not_found');
    const { rows: [segment] } = await pool.query('SELECT * FROM restaurant_loyalty_segments WHERE id = $1 AND restaurant_id = $2 AND is_active = TRUE', [id, restaurant.id]);
    if (!segment) throw new AppError('Segment not found', 404, 'loyalty_segment_not_found');
    res.json({ segment: shape(segment, await audienceFor(restaurant.id, segment.criteria || {})), campaignDeliveryEnabled: false });
  } catch (err) { next(err); }
};

exports.listCampaigns = async (req, res, next) => {
  try {
    const restaurant = await access(req);
    const { rows } = await pool.query(
      `SELECT c.*,
              COUNT(d.id)::int AS delivery_count,
              COUNT(d.id) FILTER (WHERE d.status = 'sent')::int AS sent_count,
              COUNT(d.id) FILTER (WHERE d.status = 'failed')::int AS failed_count
         FROM restaurant_loyalty_campaigns c
         LEFT JOIN restaurant_loyalty_campaign_deliveries d ON d.campaign_id = c.id
        WHERE c.restaurant_id = $1
        GROUP BY c.id
        ORDER BY c.created_at DESC, c.id DESC
        LIMIT 200`,
      [restaurant.id]
    );
    res.json({
      campaigns: rows.map((row) => campaignService.shape(row, {
        deliveryCount: Number(row.delivery_count || 0),
        sentCount: Number(row.sent_count || 0),
        failedCount: Number(row.failed_count || 0),
      })),
      campaignDeliveryEnabled: true,
    });
  } catch (err) { next(err); }
};

exports.createCampaign = async (req, res, next) => {
  try {
    const restaurant = await access(req);
    const segmentId = positiveInt(req.body?.segmentId ?? req.body?.segment_id, 'segmentId', { allowZero: false });
    const campaign = await withTransaction(pool, (client) => campaignService.createCampaign(client, {
      restaurantId: restaurant.id, segmentId, actorUserId: req.user.id, input: req.body || {},
    }), 'restaurant_loyalty_campaign_create');
    await logBusinessAction(req, {
      business_id: restaurant.business_id, actor_role: restaurant.effective_role,
      action: 'restaurant.loyalty_campaign.created', target_type: 'restaurant_loyalty_campaign',
      target_id: campaign.id, before_state: {}, after_state: campaign, metadata: { status: campaign.status }, throwOnError: true,
    });
    res.status(201).json({ campaign, campaignDeliveryEnabled: true });
  } catch (err) {
    if (err?.code === '23505') return next(new AppError('That campaign name already exists', 409, 'loyalty_campaign_exists'));
    next(err);
  }
};

exports.approveCampaign = async (req, res, next) => {
  try {
    const restaurant = await access(req);
    const campaignId = positiveInt(req.params.campaignId, 'campaignId', { allowZero: false });
    const campaign = await withTransaction(pool, (client) => campaignService.approveCampaign(client, {
      restaurantId: restaurant.id, campaignId, actorUserId: req.user.id,
    }), 'restaurant_loyalty_campaign_approve');
    await logBusinessAction(req, {
      business_id: restaurant.business_id, actor_role: restaurant.effective_role,
      action: 'restaurant.loyalty_campaign.approved', target_type: 'restaurant_loyalty_campaign',
      target_id: campaign.id, before_state: { status: 'draft' }, after_state: campaign, metadata: {}, throwOnError: true,
    });
    res.json({ campaign, campaignDeliveryEnabled: true });
  } catch (err) { next(err); }
};

exports.queueCampaign = async (req, res, next) => {
  try {
    const restaurant = await access(req);
    const campaignId = positiveInt(req.params.campaignId, 'campaignId', { allowZero: false });
    const result = await withTransaction(pool, (client) => campaignService.queueCampaign(client, {
      restaurantId: restaurant.id, campaignId, actorUserId: req.user.id,
    }), 'restaurant_loyalty_campaign_queue');
    await logBusinessAction(req, {
      business_id: restaurant.business_id, actor_role: restaurant.effective_role,
      action: 'restaurant.loyalty_campaign.queued', target_type: 'restaurant_loyalty_campaign',
      target_id: result.campaign.id, before_state: { status: 'approved' }, after_state: result.campaign,
      metadata: { queued_recipients: result.queuedRecipients }, throwOnError: true,
    });
    res.json({ ...result, campaignDeliveryEnabled: true });
  } catch (err) { next(err); }
};

exports._normalize = { normalizeName, normalizeCriteria, normalizeActive, positiveInt, audienceWhere };
