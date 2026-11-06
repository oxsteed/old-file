'use strict';

// Phase 8 Track D — staged brand menu rollout endpoints. Pilot
// restaurants first, then every remaining target; each stage is one
// advance call and records its own publish result.

const pool = require('../db');
const AppError = require('../utils/appError');
const { loadBrandRestaurants, brandIdParam } = require('./restaurantBrandController');
const { withTransaction } = require('../utils/transaction');
const { logBusinessAction } = require('../services/businessAuditLog');
const rollouts = require('../services/restaurantBrandMenuRolloutService');

async function requireMenuManage(req, brandId) {
  return loadBrandRestaurants(req, brandId, { permission: 'menu.manage' });
}

exports.listRollouts = async (req, res, next) => {
  try {
    const brandId = brandIdParam(req);
    await loadBrandRestaurants(req, brandId);
    const rows = await rollouts.listRollouts(pool, {
      brandId,
      limit: req.query?.limit,
      offset: req.query?.offset,
    });
    res.json({ rollouts: rows });
  } catch (error) { next(error); }
};

exports.getRollout = async (req, res, next) => {
  try {
    const brandId = brandIdParam(req);
    await loadBrandRestaurants(req, brandId);
    const row = await rollouts.getRollout(pool, { rolloutId: req.params.rolloutId, brandId });
    if (!row) throw new AppError('Rollout not found', 404, 'rollout_not_found');
    res.json({ rollout: rollouts.rolloutShape(row) });
  } catch (error) { next(error); }
};

exports.createRollout = async (req, res, next) => {
  try {
    const brandId = brandIdParam(req);
    const accessible = await requireMenuManage(req, brandId);
    const body = req.body || {};
    const byId = new Map(accessible.map((entry) => [Number(entry.restaurant.id), entry]));
    const sourceId = Number(body.sourceRestaurantId ?? body.source_restaurant_id);
    if (!byId.has(sourceId)) {
      throw new AppError('You do not have menu-management access to the source restaurant', 403, 'forbidden');
    }
    for (const targetId of [...(body.targetRestaurantIds || body.target_restaurant_ids || []), ...(body.pilotRestaurantIds || body.pilot_restaurant_ids || [])]) {
      if (!byId.has(Number(targetId))) {
        throw new AppError('You do not have menu-management access to every target restaurant', 403, 'forbidden');
      }
    }
    for (const entry of accessible) {
      if (entry.scope.mode === 'assigned') {
        throw new AppError('Brand menu publishing requires all-store access', 403, 'location_scope_forbidden');
      }
    }
    const row = await withTransaction(pool, async (client) => {
      const created = await rollouts.createRollout(client, {
        brandId,
        sourceRestaurantId: sourceId,
        pilotRestaurantIds: body.pilotRestaurantIds ?? body.pilot_restaurant_ids,
        targetRestaurantIds: body.targetRestaurantIds ?? body.target_restaurant_ids,
        sourceMenuItemIds: body.sourceMenuItemIds ?? body.source_menu_item_ids ?? null,
        priceCents: body.priceCents ?? body.price_cents ?? null,
        isAvailable: body.isAvailable ?? body.is_available ?? null,
        idempotencyKey: body.idempotencyKey ?? body.idempotency_key,
        actorUserId: req.user.id,
      });
      await logBusinessAction(req, {
        business_id: accessible[0].restaurant.business_id,
        actor_role: accessible[0].restaurant.effective_role,
        action: 'restaurant.brand_menu_rollout.created',
        target_type: 'restaurant_brand',
        target_id: brandId,
        metadata: {
          rollout_id: Number(created.id),
          source_restaurant_id: sourceId,
          pilot_restaurant_ids: created.pilot_restaurant_ids,
          target_restaurant_ids: created.target_restaurant_ids,
        },
        client,
        throwOnError: true,
      });
      return created;
    }, 'restaurant_brand_menu_rollout_create');
    res.status(201).json({ rollout: rollouts.rolloutShape(row) });
  } catch (error) { next(error); }
};

async function transition(req, res, next, action, fn) {
  try {
    const brandId = brandIdParam(req);
    const accessible = await requireMenuManage(req, brandId);
    const row = await withTransaction(pool, async (client) => {
      const updated = await fn(client, { rolloutId: req.params.rolloutId, actorUserId: req.user.id });
      await logBusinessAction(req, {
        business_id: accessible[0].restaurant.business_id,
        actor_role: accessible[0].restaurant.effective_role,
        action: `restaurant.brand_menu_rollout.${action}`,
        target_type: 'restaurant_brand',
        target_id: brandId,
        metadata: { rollout_id: Number(req.params.rolloutId), status: updated.status },
        client,
        throwOnError: true,
      });
      return updated;
    }, `restaurant_brand_menu_rollout_${action}`);
    res.json({ rollout: rollouts.rolloutShape(row) });
  } catch (error) { next(error); }
}

exports.advanceRollout = (req, res, next) =>
  transition(req, res, next, 'advanced', rollouts.advanceRollout);
exports.cancelRollout = (req, res, next) =>
  transition(req, res, next, 'cancelled', rollouts.cancelRollout);
