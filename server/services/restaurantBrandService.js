'use strict';

// F-02 phase 2: brand-level services above the restaurant.
// A brand groups one or more restaurants (concepts) across businesses; each
// restaurant keeps its own region -> store hierarchy (migrations 988, 963).
// This module owns brand access checks, the HQ console aggregates, and
// cross-restaurant menu publishing (migration 995).

const AppError = require('../utils/appError');
const hq = require('./restaurantHQService');

function normalizeId(value, field = 'id') {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) throw new AppError(`A valid ${field} is required`, 400, 'validation_failed');
  return id;
}

function normalizeIdempotencyKey(value) {
  const key = String(value || '').trim();
  if (key.length < 8 || key.length > 200) {
    throw new AppError('An idempotency key of 8-200 characters is required', 400, 'validation_failed');
  }
  return key;
}

function normalizePublishRequest({
  sourceRestaurantId,
  sourceMenuItemIds = null,
  targetRestaurantIds,
  targetLocationIds = null,
  priceCents = null,
  isAvailable = null,
  idempotencyKey,
}) {
  const source = normalizeId(sourceRestaurantId, 'source restaurant');
  if (!Array.isArray(targetRestaurantIds) || targetRestaurantIds.length < 1 || targetRestaurantIds.length > 50) {
    throw new AppError('At least one and at most 50 target restaurants are required', 400, 'validation_failed');
  }
  const targets = [...new Set(targetRestaurantIds.map((value) => normalizeId(value, 'target restaurant')))];
  if (targets.length !== targetRestaurantIds.length) throw new AppError('Target restaurants must be unique', 400, 'validation_failed');
  if (targets.includes(source)) throw new AppError('The source restaurant cannot be a target', 400, 'validation_failed');
  let itemIds = null;
  if (sourceMenuItemIds != null) {
    if (!Array.isArray(sourceMenuItemIds) || sourceMenuItemIds.length < 1 || sourceMenuItemIds.length > 200) {
      throw new AppError('At least one and at most 200 source menu items are required', 400, 'validation_failed');
    }
    itemIds = [...new Set(sourceMenuItemIds.map((value) => normalizeId(value, 'source menu item')))];
    if (itemIds.length !== sourceMenuItemIds.length) throw new AppError('Source menu items must be unique', 400, 'validation_failed');
  }
  let locationIds = null;
  if (targetLocationIds != null) {
    if (!Array.isArray(targetLocationIds) || targetLocationIds.length < 1 || targetLocationIds.length > 200) {
      throw new AppError('At least one and at most 200 target stores are required', 400, 'validation_failed');
    }
    locationIds = [...new Set(targetLocationIds.map((value) => normalizeId(value, 'target store')))];
    if (locationIds.length !== targetLocationIds.length) throw new AppError('Target stores must be unique', 400, 'validation_failed');
  }
  if (priceCents != null && (!Number.isInteger(priceCents) || priceCents < 0)) {
    throw new AppError('A price override must be a non-negative integer number of cents', 400, 'validation_failed');
  }
  if (isAvailable != null && typeof isAvailable !== 'boolean') {
    throw new AppError('An availability override must be a boolean', 400, 'validation_failed');
  }
  return {
    sourceRestaurantId: source,
    sourceMenuItemIds: itemIds,
    targetRestaurantIds: targets,
    targetLocationIds: locationIds,
    priceCents: priceCents == null ? null : priceCents,
    isAvailable: isAvailable == null ? null : isAvailable,
    idempotencyKey: normalizeIdempotencyKey(idempotencyKey),
  };
}

async function getBrand(client, brandId) {
  const { rows: [brand] } = await client.query(
    `SELECT id, name, slug, status, logo_url, owner_user_id, created_at, updated_at
       FROM restaurant_brands WHERE id = $1`,
    [brandId]
  );
  if (!brand) throw new AppError('Brand not found', 404, 'brand_not_found');
  return brand;
}

async function listBrandRestaurants(client, brandId) {
  const { rows } = await client.query(
    `SELECT fr.id, fr.business_id, fr.display_name, fr.status, fr.currency_code, fr.timezone
       FROM food_restaurants fr
      WHERE fr.brand_id = $1
      ORDER BY fr.display_name ASC, fr.id ASC`,
    [brandId]
  );
  return rows;
}

async function getBrandOverview(client, { brandId }) {
  const brand = await getBrand(client, brandId);
  const restaurants = await listBrandRestaurants(client, brandId);
  const { rows: stores } = await client.query(
    `SELECT l.id, l.restaurant_id, l.name, l.status, l.is_primary,
            l.region_id, r.name AS region_name,
            l.address_city, l.address_state, l.timezone
       FROM restaurant_locations l
       LEFT JOIN restaurant_regions r
         ON r.restaurant_id = l.restaurant_id AND r.id = l.region_id
      WHERE l.restaurant_id = ANY($1::bigint[])
      ORDER BY l.restaurant_id, l.is_primary DESC, l.name ASC, l.id ASC`,
    [restaurants.map((row) => row.id)]
  );
  const regionsByRestaurant = new Map();
  for (const restaurant of restaurants) {
    regionsByRestaurant.set(restaurant.id, await hq.listRegions(client, restaurant.id));
  }
  const storesByRestaurant = new Map(restaurants.map((row) => [row.id, []]));
  for (const store of stores) {
    storesByRestaurant.get(store.restaurant_id)?.push({
      id: Number(store.id),
      name: store.name,
      status: store.status,
      isPrimary: Boolean(store.is_primary),
      regionId: store.region_id == null ? null : Number(store.region_id),
      regionName: store.region_name || null,
      city: store.address_city || null,
      state: store.address_state || null,
      timezone: store.timezone,
    });
  }
  return {
    brand: { id: Number(brand.id), name: brand.name, slug: brand.slug, status: brand.status, logoUrl: brand.logo_url || null },
    restaurants: restaurants.map((row) => ({
      id: Number(row.id),
      displayName: row.display_name,
      status: row.status,
      currencyCode: row.currency_code,
      timezone: row.timezone,
      regions: regionsByRestaurant.get(row.id) || [],
      stores: storesByRestaurant.get(row.id) || [],
    })),
  };
}

function sumSales(sales) {
  const totals = new Map();
  for (const entry of sales || []) {
    const code = entry.currencyCode || 'USD';
    totals.set(code, (totals.get(code) || 0) + Number(entry.netCollectedCents || 0));
  }
  return [...totals.entries()].map(([currencyCode, netCollectedCents]) => ({ currencyCode, netCollectedCents }));
}

async function getStoreComparison(client, { brandId, from, to }) {
  const restaurants = await listBrandRestaurants(client, brandId);
  const perRestaurant = [];
  for (const restaurant of restaurants) {
    const { rows: stores } = await client.query(
      `SELECT id, restaurant_id, name AS display_name, region_id, region_name,
              address_city, address_state, timezone, status
         FROM (
           SELECT l.id, l.restaurant_id, l.name, l.region_id,
                  rr.name AS region_name, l.address_city, l.address_state,
                  l.timezone, l.status
             FROM restaurant_locations l
             LEFT JOIN restaurant_regions rr
               ON rr.restaurant_id = l.restaurant_id AND rr.id = l.region_id
            WHERE l.restaurant_id = $1
         ) s`,
      [restaurant.id]
    );
    const locationIds = stores.map((row) => Number(row.id));
    const { salesRows, healthRows, complianceRows } = locationIds.length
      ? await hq.rollupLocations(client, { restaurantId: restaurant.id, locationIds, from, to })
      : { salesRows: [], healthRows: [], complianceRows: [] };
    const salesByStore = new Map();
    for (const row of salesRows) {
      const key = Number(row.location_id);
      if (!salesByStore.has(key)) salesByStore.set(key, []);
      salesByStore.get(key).push(row);
    }
    const healthByStore = new Map(healthRows.map((row) => [Number(row.location_id), row]));
    const complianceByStore = new Map(complianceRows.map((row) => [Number(row.location_id), row]));
    perRestaurant.push({
      restaurant: { id: Number(restaurant.id), displayName: restaurant.display_name },
      stores: stores.map((row) => ({
        restaurantId: Number(restaurant.id),
        ...hq.storeShape(row, salesByStore.get(Number(row.id)) || [], {
        latestAuditScorePercent: healthByStore.get(Number(row.id))?.latest_audit_score_percent ?? null,
        openFindings: healthByStore.get(Number(row.id))?.open_findings ?? 0,
        checklistCompletionPercent: complianceByStore.get(Number(row.id))?.checklist_completion_percent ?? null,
        checklistRuns: complianceByStore.get(Number(row.id))?.checklist_runs ?? 0,
        trainingCompletionPercent: complianceByStore.get(Number(row.id))?.training_completion_percent ?? null,
        trainingAssignments: complianceByStore.get(Number(row.id))?.training_assignments ?? 0,
        overdueTraining: complianceByStore.get(Number(row.id))?.overdue_training ?? 0,
        }),
      })),
    });
  }
  const allStores = perRestaurant.flatMap((entry) =>
    entry.stores.map((store) => ({ ...store, restaurantId: entry.restaurant.id, restaurantName: entry.restaurant.displayName }))
  );
  const ranked = [...allStores].sort(
    (a, b) => sumSales(b.sales).reduce((sum, t) => sum + t.netCollectedCents, 0)
            - sumSales(a.sales).reduce((sum, t) => sum + t.netCollectedCents, 0)
  );
  return {
    brandId: Number(brandId),
    from, to,
    totals: sumSales(allStores.flatMap((store) => store.sales)),
    storeCount: allStores.length,
    restaurants: perRestaurant,
    ranked,
  };
}

async function getComplianceRollup(client, { brandId, from, to }) {
  const comparison = await getStoreComparison(client, { brandId, from, to });
  const stores = comparison.restaurants.flatMap((entry) => entry.stores);
  const checklistRuns = stores.reduce((sum, s) => sum + (s.compliance?.checklistRuns || 0), 0);
  const trainingAssignments = stores.reduce((sum, s) => sum + (s.compliance?.trainingAssignments || 0), 0);
  const weighted = (key) => {
    let num = 0; let den = 0;
    for (const s of stores) {
      const p = s.compliance?.[key];
      const w = key.startsWith('checklist') ? s.compliance?.checklistRuns || 0 : s.compliance?.trainingAssignments || 0;
      if (p != null && w > 0) { num += p * w; den += w; }
    }
    return den > 0 ? Math.round(num / den * 10) / 10 : null;
  };
  return {
    brandId: Number(brandId),
    from, to,
    storeCount: stores.length,
    checklistRuns,
    trainingAssignments,
    overdueTraining: stores.reduce((sum, s) => sum + (s.compliance?.overdueTraining || 0), 0),
    openFindings: stores.reduce((sum, s) => sum + (s.health?.openFindings || 0), 0),
    checklistCompletionPercent: weighted('checklistCompletionPercent'),
    trainingCompletionPercent: weighted('trainingCompletionPercent'),
    averageAuditScorePercent: (() => {
      const scores = stores.map((s) => s.health?.latestAuditScorePercent).filter((v) => v != null);
      return scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length * 10) / 10 : null;
    })(),
    stores: stores.map((s) => ({
      id: s.id, name: s.name, status: s.status,
      restaurantId: s.restaurantId,
      regionId: s.regionId, regionName: s.regionName,
      health: s.health, compliance: s.compliance,
    })),
  };
}

// --- Cross-restaurant menu publishing --------------------------------------

async function assertBrandTenancy(client, { brandId, sourceRestaurantId, targetRestaurantIds }) {
  const ids = [sourceRestaurantId, ...targetRestaurantIds];
  const { rows } = await client.query(
    `SELECT id, brand_id FROM food_restaurants WHERE id = ANY($1::bigint[])`,
    [ids]
  );
  if (rows.length !== ids.length) throw new AppError('One or more restaurants were not found', 404, 'restaurant_not_found');
  for (const row of rows) {
    if (Number(row.brand_id) !== Number(brandId)) {
      throw new AppError('All restaurants in a brand publish must belong to the same brand', 403, 'brand_tenancy_violation');
    }
  }
}

async function resolveTargetStores(client, { targetRestaurantIds, targetLocationIds }) {
  const { rows } = await client.query(
    `SELECT id, restaurant_id, name, status
       FROM restaurant_locations
      WHERE restaurant_id = ANY($1::bigint[])
        AND ($2::bigint[] IS NULL OR id = ANY($2::bigint[]))
        AND status = 'active'
      ORDER BY restaurant_id, id`,
    [targetRestaurantIds, targetLocationIds]
  );
  const byRestaurant = new Map(targetRestaurantIds.map((id) => [id, []]));
  for (const row of rows) byRestaurant.get(Number(row.restaurant_id))?.push(row);
  if (targetLocationIds) {
    const found = new Set(rows.map((row) => Number(row.id)));
    const missing = targetLocationIds.filter((id) => !found.has(id));
    if (missing.length) throw new AppError('One or more target stores were not found or are not active', 404, 'location_not_found');
    for (const [restaurantId, stores] of byRestaurant) {
      if (!stores.length) throw new AppError(`Restaurant ${restaurantId} has no matching active target stores`, 400, 'no_target_stores');
    }
  } else {
    for (const [restaurantId, stores] of byRestaurant) {
      if (!stores.length) throw new AppError(`Restaurant ${restaurantId} has no active stores to publish to`, 400, 'no_target_stores');
    }
  }
  return byRestaurant;
}

async function resolveSourceItems(client, { sourceRestaurantId, sourceMenuItemIds }) {
  const { rows } = await client.query(
    `SELECT i.id, i.restaurant_id, i.category_id, c.name AS category_name,
            i.name, i.description, i.image_url, i.price_cents, i.currency_code,
            i.is_available, i.sort_order, i.tags, i.allergens, i.nutrition,
            i.manual_available, i.tax_rate_bps, i.tax_exempt
       FROM food_menu_items i
       LEFT JOIN food_menu_categories c
         ON c.id = i.category_id AND c.restaurant_id = i.restaurant_id
      WHERE i.restaurant_id = $1
        AND ($2::bigint[] IS NULL OR i.id = ANY($2::bigint[]))
        AND i.publication_status = 'published'
        AND i.archived_at IS NULL
      ORDER BY i.id`,
    [sourceRestaurantId, sourceMenuItemIds]
  );
  if (sourceMenuItemIds && rows.length !== sourceMenuItemIds.length) {
    throw new AppError('One or more source menu items were not found or are not published', 404, 'menu_item_not_found');
  }
  if (!rows.length) throw new AppError('The source restaurant has no published menu items to publish', 400, 'no_source_items');
  return rows;
}

async function ensureTargetCategory(client, { targetRestaurantId, categoryName }) {
  if (!categoryName) return null;
  const { rows: [existing] } = await client.query(
    `SELECT id FROM food_menu_categories WHERE restaurant_id = $1 AND LOWER(name) = LOWER($2) LIMIT 1`,
    [targetRestaurantId, categoryName]
  );
  if (existing) return existing.id;
  const { rows: [created] } = await client.query(
    `INSERT INTO food_menu_categories (restaurant_id, name, sort_order, is_active)
     VALUES ($1, $2, 0, TRUE) RETURNING id`,
    [targetRestaurantId, categoryName]
  );
  return created.id;
}

async function syncPublication(client, { publication, sourceItem, priceCents, isAvailable, actorUserId }) {
  const categoryId = await ensureTargetCategory(client, {
    targetRestaurantId: publication.target_restaurant_id,
    categoryName: sourceItem.category_name,
  });
  const price = priceCents != null ? priceCents : sourceItem.price_cents;
  const { rows: [target] } = await client.query(
    `INSERT INTO food_menu_items
       (restaurant_id, category_id, name, description, image_url, price_cents,
        currency_code, is_available, sort_order, tags, allergens, nutrition,
        manual_available, tax_rate_bps, tax_exempt, publication_status,
        brand_source_item_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'published',$16)
     ON CONFLICT (restaurant_id, brand_source_item_id)
       WHERE brand_source_item_id IS NOT NULL
     DO UPDATE SET
       category_id = EXCLUDED.category_id,
       name = EXCLUDED.name,
       description = EXCLUDED.description,
       image_url = EXCLUDED.image_url,
       price_cents = EXCLUDED.price_cents,
       currency_code = EXCLUDED.currency_code,
       is_available = EXCLUDED.is_available,
       sort_order = EXCLUDED.sort_order,
       tags = EXCLUDED.tags,
       allergens = EXCLUDED.allergens,
       nutrition = EXCLUDED.nutrition,
       manual_available = EXCLUDED.manual_available,
       tax_rate_bps = EXCLUDED.tax_rate_bps,
       tax_exempt = EXCLUDED.tax_exempt,
       publication_status = 'published',
       archived_at = NULL,
       updated_at = NOW()
     RETURNING id`,
    [
      publication.target_restaurant_id, categoryId, sourceItem.name, sourceItem.description,
      sourceItem.image_url, price, sourceItem.currency_code,
      isAvailable != null ? isAvailable : sourceItem.is_available,
      sourceItem.sort_order, sourceItem.tags, sourceItem.allergens, sourceItem.nutrition,
      sourceItem.manual_available, sourceItem.tax_rate_bps, sourceItem.tax_exempt,
      sourceItem.id,
    ]
  );
  // Per-store overrides (migration 963) carry the publish-time price and
  // availability so each store can still diverge afterwards.
  await client.query(
    `INSERT INTO restaurant_store_menu_overrides
       (restaurant_id, location_id, menu_item_id, price_cents, is_available, updated_by)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (restaurant_id, location_id, menu_item_id)
     DO UPDATE SET price_cents = EXCLUDED.price_cents,
                   is_available = EXCLUDED.is_available,
                   available_again_at = NULL,
                   updated_by = EXCLUDED.updated_by,
                   updated_at = NOW()`,
    [
      publication.target_restaurant_id, publication.target_location_id, target.id,
      priceCents, isAvailable, actorUserId || null,
    ]
  );
  await client.query(
    `UPDATE brand_menu_publications
        SET status = 'synced', target_menu_item_id = $2, error_message = NULL, updated_at = NOW()
      WHERE id = $1`,
    [publication.id, target.id]
  );
  // Fan out to the store's screens through the revision journal (887).
  await client.query(`SELECT restaurant_screen_record_change($1, $2, 'store_menu', $3::text)`, [
    publication.target_restaurant_id, publication.target_location_id, String(target.id),
  ]);
  return target.id;
}

async function publishBrandMenu(client, {
  brandId, sourceRestaurantId, sourceMenuItemIds = null, targetRestaurantIds,
  targetLocationIds = null, priceCents = null, isAvailable = null,
  idempotencyKey, actorUserId = null,
}) {
  const request = normalizePublishRequest({
    sourceRestaurantId, sourceMenuItemIds, targetRestaurantIds, targetLocationIds,
    priceCents, isAvailable, idempotencyKey,
  });
  await getBrand(client, brandId);
  await assertBrandTenancy(client, {
    brandId, sourceRestaurantId: request.sourceRestaurantId, targetRestaurantIds: request.targetRestaurantIds,
  });
  const sourceItems = await resolveSourceItems(client, {
    sourceRestaurantId: request.sourceRestaurantId, sourceMenuItemIds: request.sourceMenuItemIds,
  });
  const storesByRestaurant = await resolveTargetStores(client, {
    targetRestaurantIds: request.targetRestaurantIds, targetLocationIds: request.targetLocationIds,
  });

  // Request-level idempotency: a retried POST with the same key returns the
  // stored result instead of re-fanning out.
  const { rows: [batch] } = await client.query(
    `INSERT INTO brand_menu_publish_batches
       (brand_id, source_restaurant_id, idempotency_key, created_by)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (brand_id, idempotency_key) DO NOTHING
     RETURNING id, result`,
    [brandId, request.sourceRestaurantId, request.idempotencyKey, actorUserId]
  );
  if (!batch) {
    const { rows: [existing] } = await client.query(
      `SELECT result FROM brand_menu_publish_batches WHERE brand_id = $1 AND idempotency_key = $2`,
      [brandId, request.idempotencyKey]
    );
    return { ...(existing?.result || {}), idempotentReplay: true };
  }

  const fanout = [];
  for (const targetRestaurantId of request.targetRestaurantIds) {
    for (const store of storesByRestaurant.get(targetRestaurantId) || []) {
      for (const item of sourceItems) {
        fanout.push({ targetRestaurantId, store, item });
      }
    }
  }
  let synced = 0;
  const failures = [];
  for (const entry of fanout) {
    const pubKey = `${request.idempotencyKey}:${entry.item.id}:${entry.targetRestaurantId}:${entry.store.id}`;
    const { rows: [publication] } = await client.query(
      `INSERT INTO brand_menu_publications
         (brand_id, batch_id, source_restaurant_id, source_menu_item_id,
          target_restaurant_id, target_location_id, idempotency_key,
          price_cents, is_available, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (source_menu_item_id, target_restaurant_id, target_location_id)
       DO UPDATE SET batch_id = EXCLUDED.batch_id,
                     price_cents = EXCLUDED.price_cents,
                     is_available = EXCLUDED.is_available,
                     status = 'pending',
                     error_message = NULL,
                     updated_at = NOW()
       RETURNING id, target_restaurant_id, target_location_id`,
      [
        brandId, batch.id, request.sourceRestaurantId, entry.item.id,
        entry.targetRestaurantId, entry.store.id, pubKey,
        request.priceCents, request.isAvailable, actorUserId,
      ]
    );
    // One bad item must not poison the batch: sync each publication inside a
    // savepoint so a constraint or data error rolls back only that item.
    await client.query('SAVEPOINT brand_pub_item');
    try {
      await syncPublication(client, {
        publication, sourceItem: entry.item,
        priceCents: request.priceCents, isAvailable: request.isAvailable, actorUserId,
      });
      await client.query('RELEASE SAVEPOINT brand_pub_item');
      synced += 1;
    } catch (error) {
      await client.query('ROLLBACK TO SAVEPOINT brand_pub_item');
      await client.query(
        `UPDATE brand_menu_publications SET status = 'failed', error_message = $2, updated_at = NOW() WHERE id = $1`,
        [publication.id, String(error?.message || error).slice(0, 500)]
      );
      failures.push({ itemId: entry.item.id, targetRestaurantId: entry.targetRestaurantId, storeId: entry.store.id, error: String(error?.message || error).slice(0, 200) });
    }
  }
  const result = {
    batchId: batch.id,
    sourceRestaurantId: request.sourceRestaurantId,
    itemCount: sourceItems.length,
    targetStoreCount: fanout.length ? new Set(fanout.map((f) => `${f.targetRestaurantId}:${f.store.id}`)).size : 0,
    synced,
    failed: failures.length,
    failures: failures.slice(0, 25),
    idempotentReplay: false,
  };
  await client.query(
    `UPDATE brand_menu_publish_batches
        SET target_count = $2, item_count = $3, result = $4::jsonb
      WHERE id = $1`,
    [batch.id, result.targetStoreCount, result.itemCount, JSON.stringify(result)]
  );
  return result;
}

module.exports = {
  normalizeId,
  normalizeIdempotencyKey,
  normalizePublishRequest,
  getBrand,
  listBrandRestaurants,
  getBrandOverview,
  getStoreComparison,
  getComplianceRollup,
  publishBrandMenu,
};
