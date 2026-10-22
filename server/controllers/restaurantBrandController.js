'use strict';

// F-02 phase 2: brand HQ console controllers.
// A brand is read through the restaurants the caller can already access; every
// endpoint below reuses the canonical restaurant gate per restaurant, so a
// caller never sees a restaurant (or store) outside their own access.

const pool = require('../db');
const AppError = require('../utils/appError');
const { resolveRestaurantAccess } = require('../services/scopeModel');
const permissions = require('../services/permissionsService');
const brand = require('../services/restaurantBrandService');
const { getLocationScope } = require('../services/restaurantLocationAccessService');
const { withTransaction } = require('../utils/transaction');
const { logBusinessAction } = require('../services/businessAuditLog');

function brandIdParam(req) {
  const brandId = Number.parseInt(req.params.brandId, 10);
  if (!Number.isSafeInteger(brandId) || brandId <= 0) throw new AppError('Brand not found', 404, 'brand_not_found');
  return brandId;
}

function dateRange(req) {
  const to = req.query?.to ? new Date(`${req.query.to}T00:00:00.000Z`) : new Date();
  const from = req.query?.from ? new Date(`${req.query.from}T00:00:00.000Z`) : new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from >= to) throw new AppError('Invalid HQ report date range', 400, 'validation_failed');
  return { from: from.toISOString(), to: to.toISOString() };
}

// Resolve every restaurant in the brand through the canonical gate; callers
// only ever see the subset they can access. Throws 404 when the brand is
// empty for this caller (indistinguishable from a missing brand).
async function loadBrandRestaurants(req, brandId, { permission = 'settings.view' } = {}) {
  const rows = await brand.listBrandRestaurants(pool, brandId);
  const accessible = [];
  for (const row of rows) {
    try {
      const restaurant = await resolveRestaurantAccess(req.user.id, Number(row.id));
      if (await permissions.hasRestaurantPermission(restaurant, req.user.id, [permission])) {
        const scope = await getLocationScope(restaurant, req.user.id);
        accessible.push({ restaurant, scope });
      }
    } catch (error) {
      if (error?.statusCode === 404 || error?.code === 'restaurant_not_found') continue;
      throw error;
    }
  }
  if (!accessible.length) throw new AppError('Brand not found', 404, 'brand_not_found');
  return accessible;
}

function filterStoresByScope(payload, accessible) {
  const scopeByRestaurant = new Map(accessible.map((entry) => [Number(entry.restaurant.id), entry.scope]));
  const filterStores = (stores, restaurantId) => {
    const scope = scopeByRestaurant.get(Number(restaurantId));
    if (!scope || scope.mode !== 'assigned') return stores;
    return (stores || []).filter((store) => scope.location_ids.includes(Number(store.id)));
  };
  if (payload.restaurants) {
    return {
      ...payload,
      restaurants: payload.restaurants
        .map((entry) => ({ ...entry, stores: filterStores(entry.stores, entry.restaurant?.id ?? entry.id) }))
        .filter((entry) => entry.stores.length > 0),
    };
  }
  return payload;
}

exports.listBrands = async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT DISTINCT rb.id, rb.name, rb.slug, rb.status, rb.logo_url
         FROM restaurant_brands rb
         JOIN food_restaurants fr ON fr.brand_id = rb.id
        ORDER BY rb.name ASC, rb.id ASC`
    );
    const mine = [];
    for (const row of rows) {
      try {
        const accessible = await loadBrandRestaurants(req, Number(row.id));
        mine.push({
          id: Number(row.id), name: row.name, slug: row.slug, status: row.status,
          logoUrl: row.logo_url || null, restaurantCount: accessible.length,
        });
      } catch (error) {
        if (error?.statusCode === 404) continue;
        throw error;
      }
    }
    res.json({ brands: mine });
  } catch (error) { next(error); }
};

exports.getOverview = async (req, res, next) => {
  try {
    const brandId = brandIdParam(req);
    const accessible = await loadBrandRestaurants(req, brandId);
    const overview = await brand.getBrandOverview(pool, { brandId });
    const allowed = new Set(accessible.map((entry) => Number(entry.restaurant.id)));
    overview.restaurants = overview.restaurants.filter((entry) => allowed.has(Number(entry.id)));
    res.json(filterStoresByScope(overview, accessible));
  } catch (error) { next(error); }
};

exports.getStoreComparison = async (req, res, next) => {
  try {
    const brandId = brandIdParam(req);
    const accessible = await loadBrandRestaurants(req, brandId);
    const range = dateRange(req);
    const comparison = await brand.getStoreComparison(pool, { brandId, ...range });
    const allowed = new Set(accessible.map((entry) => Number(entry.restaurant.id)));
    comparison.restaurants = comparison.restaurants.filter((entry) => allowed.has(Number(entry.restaurant.id)));
    const filtered = filterStoresByScope(comparison, accessible);
    filtered.ranked = (filtered.ranked || []).filter((store) => allowed.has(Number(store.restaurantId)));
    res.json(filtered);
  } catch (error) { next(error); }
};

exports.getCompliance = async (req, res, next) => {
  try {
    const brandId = brandIdParam(req);
    const accessible = await loadBrandRestaurants(req, brandId);
    const range = dateRange(req);
    const rollup = await brand.getComplianceRollup(pool, { brandId, ...range });
    const scopeByRestaurant = new Map(accessible.map((entry) => [Number(entry.restaurant.id), entry.scope]));
    rollup.stores = (rollup.stores || []).filter((store) => {
      const scope = scopeByRestaurant.get(Number(store.restaurantId));
      if (!scope) return false;
      return scope.mode !== 'assigned' || scope.location_ids.includes(Number(store.id));
    });
    res.json(rollup);
  } catch (error) { next(error); }
};

exports.publishMenu = async (req, res, next) => {
  try {
    const brandId = brandIdParam(req);
    const accessible = await loadBrandRestaurants(req, brandId, { permission: 'menu.manage' });
    const request = brand.normalizePublishRequest(req.body || {});
    const byId = new Map(accessible.map((entry) => [Number(entry.restaurant.id), entry]));
    const source = byId.get(request.sourceRestaurantId);
    if (!source) throw new AppError('You do not have menu-management access to the source restaurant', 403, 'forbidden');
    for (const targetId of request.targetRestaurantIds) {
      if (!byId.has(targetId)) {
        throw new AppError('You do not have menu-management access to every target restaurant', 403, 'forbidden');
      }
    }
    // Brand publishing is an HQ-level action: location-scoped staff cannot
    // publish across stores they cannot see.
    for (const entry of accessible) {
      if (entry.scope.mode === 'assigned') {
        throw new AppError('Brand menu publishing requires all-store access', 403, 'location_scope_forbidden');
      }
    }
    const result = await withTransaction(pool, async (client) => {
      const published = await brand.publishBrandMenu(client, { brandId, ...request, actorUserId: req.user.id });
      await logBusinessAction(req, {
        business_id: source.restaurant.business_id,
        actor_role: source.restaurant.effective_role,
        action: 'restaurant.brand_menu.published',
        target_type: 'restaurant_brand',
        target_id: brandId,
        metadata: {
          source_restaurant_id: published.sourceRestaurantId,
          item_count: published.itemCount,
          target_store_count: published.targetStoreCount,
          synced: published.synced,
          failed: published.failed,
          idempotency_key: request.idempotencyKey,
          idempotent_replay: published.idempotentReplay,
        },
        client,
        throwOnError: true,
      });
      return published;
    }, 'restaurant_brand_menu_publish');
    res.status(result.idempotentReplay ? 200 : 201).json({ ...result, published: true });
  } catch (error) { next(error); }
};

exports.attachRestaurant = async (req, res, next) => {
  try {
    const brandId = brandIdParam(req);
    const restaurantId = Number.parseInt(req.body?.restaurantId, 10);
    if (!Number.isSafeInteger(restaurantId) || restaurantId <= 0) throw new AppError('A valid restaurant is required', 400, 'validation_failed');
    const restaurant = await resolveRestaurantAccess(req.user.id, restaurantId);
    if (!(await permissions.hasRestaurantPermission(restaurant, req.user.id, ['settings.manage']))) {
      throw new AppError('You do not have permission to move this restaurant', 403, 'forbidden');
    }
    // Caller must already belong to the destination brand.
    await loadBrandRestaurants(req, brandId);
    const { rows: [updated] } = await pool.query(
      `UPDATE food_restaurants SET brand_id = $2, updated_at = NOW()
        WHERE id = $1 RETURNING id, brand_id`,
      [restaurantId, brandId]
    );
    await logBusinessAction(req, {
      business_id: restaurant.business_id,
      actor_role: restaurant.effective_role,
      action: 'restaurant.brand.attached',
      target_type: 'restaurant_brand',
      target_id: brandId,
      metadata: { restaurant_id: restaurantId },
      throwOnError: true,
    });
    res.json({ restaurantId: Number(updated.id), brandId: Number(updated.brand_id) });
  } catch (error) { next(error); }
};

exports.detachRestaurant = async (req, res, next) => {
  try {
    const brandId = brandIdParam(req);
    const restaurantId = Number.parseInt(req.params.restaurantId, 10);
    if (!Number.isSafeInteger(restaurantId) || restaurantId <= 0) throw new AppError('A valid restaurant is required', 400, 'validation_failed');
    const restaurant = await resolveRestaurantAccess(req.user.id, restaurantId);
    if (Number(restaurant.brand_id) !== brandId) throw new AppError('Restaurant is not in this brand', 404, 'brand_not_found');
    if (!(await permissions.hasRestaurantPermission(restaurant, req.user.id, ['settings.manage']))) {
      throw new AppError('You do not have permission to move this restaurant', 403, 'forbidden');
    }
    const { rows: [count] } = await pool.query(
      `SELECT COUNT(*)::int AS n FROM food_restaurants WHERE brand_id = $1`, [brandId]
    );
    if (count.n <= 1) throw new AppError('A brand must keep at least one restaurant', 409, 'brand_last_restaurant');
    // Detaching spawns a single-restaurant brand so the invariant
    // "every restaurant belongs to exactly one brand" holds.
    const { rows: [spawned] } = await withTransaction(pool, async (client) => {
      const { rows: [nb] } = await client.query(
        `INSERT INTO restaurant_brands (name, slug, owner_user_id, created_by)
         VALUES ($1, $2, $3, $3) RETURNING id`,
        [`${restaurant.display_name} Group`, `brand-split-${restaurantId}-${Date.now()}`, req.user.id]
      );
      await client.query(`UPDATE food_restaurants SET brand_id = $2, updated_at = NOW() WHERE id = $1`, [restaurantId, nb.id]);
      return [nb];
    }, 'restaurant_brand_detach');
    await logBusinessAction(req, {
      business_id: restaurant.business_id,
      actor_role: restaurant.effective_role,
      action: 'restaurant.brand.detached',
      target_type: 'restaurant_brand',
      target_id: brandId,
      metadata: { restaurant_id: restaurantId, new_brand_id: spawned.id },
      throwOnError: true,
    });
    res.json({ restaurantId, brandId: Number(spawned.id) });
  } catch (error) { next(error); }
};
