'use strict';

const { AppError } = require('../middleware/errorHandler');

function normalizeLocationId(value) {
  if (value === undefined || value === null || value === '') return null;
  const id = Number(value);
  if (!/^[1-9]\d*$/.test(String(value)) || !Number.isSafeInteger(id)) {
    throw new AppError('Invalid store', 400, 'invalid_location_id');
  }
  return id;
}

async function syncMappedMenuAvailability(db, restaurantId, {
  inventoryItemId = null,
  menuItemId = null,
  locationId = null,
  apply = true,
  createdBy = null,
} = {}) {
  const scopedLocationId = normalizeLocationId(locationId);
  const requiredStock = '(rim.required_quantity * rim.conversion_factor * 100.0 / NULLIF(rim.yield_percent, 0))';
  const params = [restaurantId, inventoryItemId, menuItemId];
  if (scopedLocationId) params.push(scopedLocationId);
  const locationParam = scopedLocationId ? `$${params.length}` : null;
  const reservationLocation = scopedLocationId ? ` AND location_id = ${locationParam}` : '';
  const inventoryLocation = scopedLocationId ? ` AND rii.location_id = ${locationParam}` : '';
  const mappingLocation = scopedLocationId
    ? ` AND EXISTS (
             SELECT 1 FROM restaurant_inventory_items mapped_item
              WHERE mapped_item.id = rim.inventory_item_id
                AND mapped_item.restaurant_id = rim.restaurant_id
                AND mapped_item.location_id = ${locationParam}
           )`
    : '';
  const impactedLocation = scopedLocationId
    ? ` AND EXISTS (
             SELECT 1 FROM restaurant_inventory_items impacted_item
              WHERE impacted_item.id = impacted.inventory_item_id
                AND impacted_item.restaurant_id = impacted.restaurant_id
                AND impacted_item.location_id = ${locationParam}
           )`
    : '';
  const overrideJoin = scopedLocationId
    ? `LEFT JOIN restaurant_store_menu_overrides sm
         ON sm.restaurant_id = fmi.restaurant_id
        AND sm.menu_item_id = fmi.id
        AND sm.location_id = ${locationParam}`
    : '';
  const storeManualAvailable = scopedLocationId
    ? '(sm.is_available IS DISTINCT FROM FALSE OR COALESCE(sm.available_again_at <= NOW(), FALSE))'
    : 'TRUE';
  const currentAvailable = scopedLocationId
    ? `(fmi.manual_available AND COALESCE(${storeManualAvailable}, FALSE)
        AND COALESCE(sm.inventory_available, fmi.inventory_available))`
    : 'fmi.is_available';
  const currentInventoryAvailable = scopedLocationId
    ? 'COALESCE(sm.inventory_available, fmi.inventory_available)'
    : 'fmi.inventory_available';
  const currentInventoryState = scopedLocationId
    ? 'COALESCE(sm.inventory_availability_state, fmi.inventory_availability_state)'
    : 'fmi.inventory_availability_state';
  const scopedGroup = scopedLocationId
    ? ', sm.is_available, sm.available_again_at, sm.inventory_available, sm.inventory_availability_state'
    : '';

  const { rows } = await db.query(
    `WITH active_reservations AS (
       SELECT inventory_item_id, SUM(quantity) AS reserved_quantity
         FROM restaurant_inventory_order_reservations
        WHERE restaurant_id = $1
          AND status = 'reserved'
          AND (expires_at IS NULL OR expires_at > NOW())${reservationLocation}
        GROUP BY inventory_item_id
     )
     SELECT fmi.id AS menu_item_id,
            fmi.name AS menu_item_name,
            ${currentAvailable} AS current_available,
            fmi.manual_available,
            ${currentInventoryAvailable} AS current_inventory_available,
            ${currentInventoryState} AS current_inventory_state,
            ${storeManualAvailable} AS store_manual_available,
            COALESCE(BOOL_OR(
              rim.auto_manage = TRUE
              AND (rii.id IS NULL OR GREATEST(0, rii.quantity - COALESCE(ar.reserved_quantity, 0)) < ${requiredStock})
            ), FALSE) AS blocked_by_stock,
            COALESCE(BOOL_OR(
              rim.auto_manage = TRUE
              AND rii.quantity >= ${requiredStock}
              AND GREATEST(0, rii.quantity - COALESCE(ar.reserved_quantity, 0))
                <= GREATEST(rii.low_stock_threshold, ${requiredStock})
            ), FALSE) AS limited_by_stock,
            ARRAY_AGG(rii.name ORDER BY rii.name)
              FILTER (WHERE rim.auto_manage = TRUE
                        AND (rii.id IS NULL OR GREATEST(0, rii.quantity - COALESCE(ar.reserved_quantity, 0)) < ${requiredStock})) AS blocking_items,
            ARRAY_AGG(rii.name ORDER BY rii.name)
              FILTER (WHERE rim.auto_manage = TRUE
                        AND rii.quantity >= ${requiredStock}
                        AND GREATEST(0, rii.quantity - COALESCE(ar.reserved_quantity, 0))
                          <= GREATEST(rii.low_stock_threshold, ${requiredStock})) AS limited_items,
            MIN(rii.id) FILTER (WHERE rim.auto_manage = TRUE
                                  AND GREATEST(0, rii.quantity - COALESCE(ar.reserved_quantity, 0)) < ${requiredStock}) AS blocking_inventory_item_id
       FROM food_menu_items fmi
       ${overrideJoin}
       LEFT JOIN restaurant_inventory_item_mappings rim
         ON rim.menu_item_id = fmi.id
        AND rim.restaurant_id = fmi.restaurant_id${mappingLocation}
       LEFT JOIN restaurant_inventory_items rii
         ON rii.id = rim.inventory_item_id
        AND rii.restaurant_id = rim.restaurant_id
        AND rii.is_active = TRUE${inventoryLocation}
       LEFT JOIN active_reservations ar ON ar.inventory_item_id = rii.id
      WHERE fmi.restaurant_id = $1
        AND (
          ($3::bigint IS NOT NULL AND fmi.id = $3)
          OR ($3::bigint IS NULL AND $2::bigint IS NULL)
          OR ($3::bigint IS NULL AND EXISTS (
            SELECT 1
              FROM restaurant_inventory_item_mappings impacted
             WHERE impacted.restaurant_id = fmi.restaurant_id
               AND impacted.menu_item_id = fmi.id
               AND impacted.inventory_item_id = $2${impactedLocation}
          ))
        )
      GROUP BY fmi.id, fmi.name, fmi.is_available, fmi.manual_available,
               fmi.inventory_available, fmi.inventory_availability_state${scopedGroup}
      ORDER BY fmi.name`,
    params
  );

  const changes = rows.map((row) => {
    const nextInventoryState = row.blocked_by_stock
      ? 'unavailable'
      : row.limited_by_stock
        ? 'limited'
        : 'available';
    const nextInventoryAvailable = nextInventoryState !== 'unavailable';
    const manualAvailable = row.manual_available !== false && row.store_manual_available !== false;
    return {
      ...row,
      next_inventory_state: nextInventoryState,
      next_inventory_available: nextInventoryAvailable,
      next_available: manualAvailable && nextInventoryAvailable,
      reason: row.blocked_by_stock
        ? `Insufficient or inactive stock: ${(row.blocking_items || []).filter(Boolean).join(', ') || 'mapped ingredient'}`
        : row.limited_by_stock
          ? `Limited stock: ${(row.limited_items || []).join(', ')}`
          : 'Mapped inventory is available',
    };
  }).filter((row) => row.current_inventory_available !== row.next_inventory_available
      || row.current_inventory_state !== row.next_inventory_state
      || row.current_available !== row.next_available);

  if (apply) {
    for (const change of changes) {
      if (scopedLocationId) {
        await db.query(
          `INSERT INTO restaurant_store_menu_overrides
             (restaurant_id, location_id, menu_item_id, inventory_available,
              inventory_availability_state, updated_by, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,NOW())
           ON CONFLICT (restaurant_id, location_id, menu_item_id)
           DO UPDATE SET inventory_available = EXCLUDED.inventory_available,
                         inventory_availability_state = EXCLUDED.inventory_availability_state,
                         updated_by = EXCLUDED.updated_by,
                         updated_at = NOW()`,
          [restaurantId, scopedLocationId, change.menu_item_id, change.next_inventory_available, change.next_inventory_state, createdBy]
        );
      } else {
        await db.query(
          `UPDATE food_menu_items
              SET inventory_available = $1,
                  inventory_availability_state = $2,
                  is_available = $3,
                  updated_at = NOW()
            WHERE id = $4 AND restaurant_id = $5`,
          [change.next_inventory_available, change.next_inventory_state, change.next_available, change.menu_item_id, restaurantId]
        );
      }
      await db.query(
        `INSERT INTO restaurant_inventory_availability_events
           (restaurant_id, location_id, inventory_item_id, menu_item_id, previous_available, next_available, reason, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          restaurantId,
          scopedLocationId,
          change.blocking_inventory_item_id || inventoryItemId,
          change.menu_item_id,
          change.current_available,
          change.next_available,
          change.reason,
          createdBy,
        ]
      );
    }
  }

  return { changes, applied: apply };
}

module.exports = { syncMappedMenuAvailability };
