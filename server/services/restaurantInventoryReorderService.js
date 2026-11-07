'use strict';

// Phase 6 (gap 14): auto-reorder drafts from par levels. When an active
// inventory item falls below its reorder_point, a purchase request is
// drafted (status 'pending', source 'auto_reorder') for the shortfall
// against par_level. Drafts only: nothing is ever auto-ordered or
// auto-approved, and an item with an already-open request is skipped so a
// repeated run cannot stack duplicate drafts. The draft quantity tops the
// item back up to par_level (or covers the reorder shortfall when no par
// level is set), measured against available stock (on hand minus reserved).
// This is a manual trigger (POST .../inventory/auto-reorder) rather than a
// scheduled sweep: there is no per-restaurant auto-reorder opt-in, so an
// unsolicited global job would draft into restaurants that never asked.

const { AppError } = require('../middleware/errorHandler');
const { logInventoryAudit } = require('./restaurantInventoryAuditService');

const OPEN_REQUEST_STATUSES = ['pending', 'approved', 'ordered'];

async function draftAutoReorderRequests(db, { restaurantId, locationIds = null, actorUserId = null }) {
  const { rows: [restaurant] } = await db.query(
    'SELECT id, business_id FROM food_restaurants WHERE id = $1',
    [restaurantId]
  );
  if (!restaurant) throw new AppError('Restaurant not found', 404, 'restaurant_not_found');
  const params = [restaurantId];
  let locationFilter = '';
  if (locationIds) {
    params.push(locationIds);
    locationFilter = ' AND i.location_id = ANY($2::bigint[])';
  }
  const { rows: items } = await db.query(
    `SELECT i.id, i.name, i.unit, i.supplier_name, i.location_id,
            i.quantity, i.reorder_point, i.par_level,
            GREATEST(0, i.quantity - COALESCE(reserved.quantity, 0)) AS available_quantity
       FROM restaurant_inventory_items i
       LEFT JOIN (
         SELECT inventory_item_id, SUM(quantity) AS quantity
           FROM restaurant_inventory_order_reservations
          WHERE restaurant_id = $1 AND status = 'reserved'
            AND (expires_at IS NULL OR expires_at > NOW())
          GROUP BY inventory_item_id
       ) reserved ON reserved.inventory_item_id = i.id
      WHERE i.restaurant_id = $1 AND i.is_active = TRUE
        AND i.reorder_point > 0
        AND GREATEST(0, i.quantity - COALESCE(reserved.quantity, 0)) < i.reorder_point${locationFilter}
      ORDER BY i.name ASC`,
    params
  );
  const created = [];
  const skipped = [];
  for (const item of items) {
    const available = Number(item.available_quantity) || 0;
    const parLevel = Number(item.par_level) || 0;
    const reorderPoint = Number(item.reorder_point) || 0;
    const needed = parLevel > available
      ? parLevel - available
      : reorderPoint - available;
    const requestedQuantity = Math.max(Math.round(needed * 1000) / 1000, 0.001);
    const autoReorderKey = `auto:${restaurantId}:${item.id}:${item.location_id == null ? 'all' : item.location_id}`;
    const { rows: [existing] } = await db.query(
      `SELECT id, status, source FROM restaurant_inventory_purchase_requests
        WHERE restaurant_id = $1 AND inventory_item_id = $2
          AND status = ANY($3::varchar[])
        ORDER BY created_at DESC LIMIT 1`,
      [restaurantId, item.id, OPEN_REQUEST_STATUSES]
    );
    if (existing) {
      skipped.push({
        inventory_item_id: Number(item.id),
        name: item.name,
        reason: 'open_request_exists',
        open_request_id: Number(existing.id),
        open_request_status: existing.status,
      });
      continue;
    }
    const { rows: [request] } = await db.query(
      `INSERT INTO restaurant_inventory_purchase_requests
         (restaurant_id, location_id, item_name, requested_quantity, unit,
          supplier_name, status, requested_by, source, inventory_item_id,
          auto_reorder_key)
       VALUES ($1,$2,$3,$4,$5,$6,'pending',$7,'auto_reorder',$8,$9)
       ON CONFLICT (restaurant_id, auto_reorder_key)
         WHERE auto_reorder_key IS NOT NULL DO NOTHING
       RETURNING *`,
      [
        restaurantId,
        item.location_id,
        item.name,
        requestedQuantity,
        item.unit || 'units',
        item.supplier_name,
        actorUserId,
        item.id,
        autoReorderKey,
      ]
    );
    if (!request) {
      // Lost a race with another draft run for the same item.
      skipped.push({
        inventory_item_id: Number(item.id),
        name: item.name,
        reason: 'draft_already_exists',
      });
      continue;
    }
    await logInventoryAudit(db, {
      restaurantId: Number(restaurantId),
      businessId: restaurant.business_id,
      eventType: 'purchase_request_auto_drafted',
      entityType: 'purchase_request',
      entityId: request.id,
      actorUserId,
      locationId: item.location_id,
      metadata: {
        itemName: request.item_name,
        inventoryItemId: Number(item.id),
        requestedQuantity: Number(request.requested_quantity),
        unit: request.unit,
        availableQuantity: available,
        reorderPoint,
        parLevel,
      },
    });
    created.push(request);
  }
  return { created, skipped };
}

module.exports = { draftAutoReorderRequests };
