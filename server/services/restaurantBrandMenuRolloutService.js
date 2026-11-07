'use strict';

// Phase 8 Track D — staged brand menu rollout (baseline gap 18:
// "no staged rollout / canary per store").
//
// A rollout publishes a brand menu in two stages instead of all at
// once: pilot restaurants first, then every remaining target. Each
// stage reuses the existing brand publish (publishBrandMenu) with a
// stage-scoped idempotency key, so retrying a stage replays instead
// of re-publishing. The rollout row records one result entry per
// stage, so HQ can see exactly what the pilot got before advancing.
//
// One open rollout per brand at a time (partial unique index): two
// staged publishes to the same brand would race each other's pilot
// results.

const AppError = require('../utils/appError');
const brandService = require('./restaurantBrandService');

function normalizeId(value, field = 'id') {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) throw new AppError(`A valid ${field} is required`, 400, 'validation_failed');
  return id;
}

function normalizeIdList(value, field) {
  if (!Array.isArray(value) || !value.length || value.length > 50) {
    throw new AppError(`At least one and at most 50 ${field} are required`, 400, 'validation_failed');
  }
  const ids = [...new Set(value.map((entry) => normalizeId(entry, field)))];
  if (ids.length !== value.length) throw new AppError(`${field} must be unique`, 400, 'validation_failed');
  return ids;
}

function rolloutShape(row) {
  if (!row) return null;
  const stages = Array.isArray(row.stage_results) ? row.stage_results : [];
  return {
    id: Number(row.id),
    brandId: Number(row.brand_id),
    sourceRestaurantId: Number(row.source_restaurant_id),
    status: row.status,
    pilotRestaurantIds: (row.pilot_restaurant_ids || []).map((id) => Number(id)),
    targetRestaurantIds: (row.target_restaurant_ids || []).map((id) => Number(id)),
    sourceMenuItemIds: row.source_menu_item_ids == null ? null : row.source_menu_item_ids.map((id) => Number(id)),
    priceCents: row.price_cents,
    isAvailable: row.is_available,
    idempotencyKey: row.idempotency_key,
    stageResults: stages,
    // Derived stage: created (no stage published yet), pilot
    // (pilot published, full rollout pending), rolled_out, cancelled.
    stage: row.status === 'rolled_out'
      ? 'rolled_out'
      : row.status === 'cancelled'
        ? 'cancelled'
        : stages.some((stage) => stage.stage === 'pilot')
          ? 'pilot_published'
          : 'created',
    createdBy: row.created_by,
    updatedBy: row.updated_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function createRollout(client, {
  brandId,
  sourceRestaurantId,
  pilotRestaurantIds,
  targetRestaurantIds,
  sourceMenuItemIds = null,
  priceCents = null,
  isAvailable = null,
  idempotencyKey,
  actorUserId = null,
}) {
  const brand = normalizeId(brandId, 'brand');
  const source = normalizeId(sourceRestaurantId, 'source restaurant');
  const pilot = normalizeIdList(pilotRestaurantIds, 'pilot restaurants');
  const targets = normalizeIdList(targetRestaurantIds, 'target restaurants');
  if (targets.includes(source)) throw new AppError('The source restaurant cannot be a target', 400, 'validation_failed');
  if (!pilot.every((id) => targets.includes(id))) {
    throw new AppError('Every pilot restaurant must also be a target restaurant', 400, 'validation_failed');
  }
  let itemIds = null;
  if (sourceMenuItemIds != null) {
    itemIds = normalizeIdList(sourceMenuItemIds, 'source menu items');
    if (itemIds.length > 200) throw new AppError('At most 200 source menu items are allowed', 400, 'validation_failed');
  }
  if (priceCents != null && (!Number.isInteger(priceCents) || priceCents < 0)) {
    throw new AppError('A price override must be a non-negative integer number of cents', 400, 'validation_failed');
  }
  if (isAvailable != null && typeof isAvailable !== 'boolean') {
    throw new AppError('An availability override must be a boolean', 400, 'validation_failed');
  }
  const key = String(idempotencyKey || '').trim();
  if (key.length < 8 || key.length > 200) {
    throw new AppError('An idempotency key of 8-200 characters is required', 400, 'validation_failed');
  }
  // Tenancy: source and every target must belong to this brand.
  const restaurants = await brandService.listBrandRestaurants(client, brand);
  const brandIds = new Set(restaurants.map((row) => Number(row.id)));
  if (!brandIds.has(source) || !targets.every((id) => brandIds.has(id))) {
    throw new AppError('Source and target restaurants must belong to this brand', 403, 'brand_tenancy');
  }
  // Pre-check the open rollout so the common case never raises a
  // SQL error. The partial unique index stays as the race backstop;
  // the savepoint below keeps a lost race from poisoning the
  // caller's transaction (any Postgres error aborts the whole
  // transaction, so the insert runs behind a savepoint).
  const { rows: [open] } = await client.query(
    `SELECT id FROM restaurant_brand_menu_rollouts
      WHERE brand_id = $1 AND status = 'pilot' LIMIT 1`,
    [brand]
  );
  if (open) {
    throw new AppError('This brand already has an open staged rollout; finish or cancel it first', 409, 'rollout_already_open');
  }
  await client.query('SAVEPOINT rollout_create');
  try {
    const { rows: [row] } = await client.query(
      `INSERT INTO restaurant_brand_menu_rollouts
         (brand_id, source_restaurant_id, status, pilot_restaurant_ids,
          target_restaurant_ids, source_menu_item_ids, price_cents,
          is_available, idempotency_key, created_by, updated_by)
       VALUES ($1, $2, 'pilot', $3::bigint[], $4::bigint[], $5::bigint[], $6, $7, $8, $9, $9)
       RETURNING *`,
      [brand, source, pilot, targets, itemIds, priceCents, isAvailable, key, actorUserId || null]
    );
    await client.query('RELEASE SAVEPOINT rollout_create');
    return row;
  } catch (error) {
    await client.query('ROLLBACK TO SAVEPOINT rollout_create');
    if (error?.code === '23505') {
      throw new AppError('This brand already has an open staged rollout; finish or cancel it first', 409, 'rollout_already_open');
    }
    throw error;
  }
}

async function getRollout(client, { rolloutId, brandId = null }) {
  const id = normalizeId(rolloutId, 'rollout');
  const params = [id];
  let brandFilter = '';
  if (brandId != null) {
    params.push(normalizeId(brandId, 'brand'));
    brandFilter = ' AND brand_id = $2';
  }
  const { rows: [row] } = await client.query(
    `SELECT * FROM restaurant_brand_menu_rollouts WHERE id = $1${brandFilter}`,
    params
  );
  return row || null;
}

async function listRollouts(client, { brandId, limit = 50, offset = 0 } = {}) {
  const { rows } = await client.query(
    `SELECT * FROM restaurant_brand_menu_rollouts
      WHERE brand_id = $1
      ORDER BY created_at DESC, id DESC
      LIMIT $2 OFFSET $3`,
    [normalizeId(brandId, 'brand'), Math.min(Math.max(Number(limit) || 50, 1), 100), Math.max(Number(offset) || 0, 0)]
  );
  return rows.map(rolloutShape);
}

// Advance one stage. Stage 1 publishes to the pilot restaurants;
// stage 2 publishes to every remaining target and closes the
// rollout. Re-advancing a closed rollout 409s; each stage's publish
// is idempotent on its own key, so a retried advance replays.
async function advanceRollout(client, { rolloutId, actorUserId = null }) {
  const id = normalizeId(rolloutId, 'rollout');
  const { rows: [existing] } = await client.query(
    'SELECT * FROM restaurant_brand_menu_rollouts WHERE id = $1 FOR UPDATE',
    [id]
  );
  if (!existing) throw new AppError('Rollout not found', 404, 'rollout_not_found');
  if (existing.status === 'cancelled') throw new AppError('A cancelled rollout cannot advance', 409, 'rollout_cancelled');
  if (existing.status === 'rolled_out') throw new AppError('This rollout already reached every target', 409, 'rollout_complete');
  const stages = Array.isArray(existing.stage_results) ? existing.stage_results : [];
  const pilotDone = stages.some((stage) => stage.stage === 'pilot');
  const stage = pilotDone ? 'full' : 'pilot';
  const pilotIds = (existing.pilot_restaurant_ids || []).map((entry) => Number(entry));
  const targetIds = (existing.target_restaurant_ids || []).map((entry) => Number(entry));
  const stageTargets = stage === 'pilot' ? pilotIds : targetIds.filter((entry) => !pilotIds.includes(entry));
  if (!stageTargets.length) {
    throw new AppError('There are no remaining target restaurants for this stage', 409, 'rollout_no_targets');
  }
  const published = await brandService.publishBrandMenu(client, {
    brandId: Number(existing.brand_id),
    sourceRestaurantId: Number(existing.source_restaurant_id),
    sourceMenuItemIds: existing.source_menu_item_ids,
    targetRestaurantIds: stageTargets,
    priceCents: existing.price_cents,
    isAvailable: existing.is_available,
    idempotencyKey: `${existing.idempotency_key}:${stage}`,
    actorUserId,
  });
  const stageResult = {
    stage,
    restaurantIds: stageTargets,
    publishedAt: new Date().toISOString(),
    itemCount: published.itemCount,
    targetStoreCount: published.targetStoreCount,
    synced: published.synced,
    failed: published.failed,
    idempotentReplay: !!published.idempotentReplay,
  };
  const nextStatus = stage === 'full' ? 'rolled_out' : 'pilot';
  const { rows: [updated] } = await client.query(
    `UPDATE restaurant_brand_menu_rollouts
        SET stage_results = stage_results || $2::jsonb,
            status = $3, updated_by = $4, updated_at = NOW()
      WHERE id = $1
      RETURNING *`,
    [id, JSON.stringify(stageResult), nextStatus, actorUserId || null]
  );
  return updated;
}

async function cancelRollout(client, { rolloutId, actorUserId = null }) {
  const id = normalizeId(rolloutId, 'rollout');
  const { rows: [updated] } = await client.query(
    `UPDATE restaurant_brand_menu_rollouts
        SET status = 'cancelled', updated_by = $2, updated_at = NOW()
      WHERE id = $1 AND status = 'pilot'
      RETURNING *`,
    [id, actorUserId || null]
  );
  if (!updated) {
    const { rows: [existing] } = await client.query(
      'SELECT id FROM restaurant_brand_menu_rollouts WHERE id = $1',
      [id]
    );
    if (!existing) throw new AppError('Rollout not found', 404, 'rollout_not_found');
    throw new AppError('Only an open rollout can be cancelled', 409, 'rollout_not_open');
  }
  return updated;
}

module.exports = {
  createRollout,
  getRollout,
  listRollouts,
  advanceRollout,
  cancelRollout,
  rolloutShape,
};
