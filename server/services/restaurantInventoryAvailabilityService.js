'use strict';

async function syncMappedMenuAvailability(db, restaurantId, {
  inventoryItemId = null,
  menuItemId = null,
  apply = true,
  createdBy = null,
} = {}) {
  const params = [restaurantId, inventoryItemId, menuItemId];

  const { rows } = await db.query(
    `SELECT fmi.id AS menu_item_id,
            fmi.name AS menu_item_name,
            fmi.is_available AS current_available,
            fmi.manual_available,
            fmi.inventory_available AS current_inventory_available,
            fmi.inventory_availability_state AS current_inventory_state,
            COALESCE(BOOL_OR(
              rim.auto_manage = TRUE
              AND (rii.id IS NULL OR rii.quantity < rim.required_quantity)
            ), FALSE) AS blocked_by_stock,
            COALESCE(BOOL_OR(
              rim.auto_manage = TRUE
              AND rii.quantity >= rim.required_quantity
              AND rii.quantity <= GREATEST(rii.low_stock_threshold, rim.required_quantity)
            ), FALSE) AS limited_by_stock,
            ARRAY_AGG(rii.name ORDER BY rii.name)
              FILTER (WHERE rim.auto_manage = TRUE
                        AND (rii.id IS NULL OR rii.quantity < rim.required_quantity)) AS blocking_items,
            ARRAY_AGG(rii.name ORDER BY rii.name)
              FILTER (WHERE rim.auto_manage = TRUE
                        AND rii.quantity >= rim.required_quantity
                        AND rii.quantity <= GREATEST(rii.low_stock_threshold, rim.required_quantity)) AS limited_items,
            MIN(rii.id) FILTER (WHERE rim.auto_manage = TRUE AND rii.quantity < rim.required_quantity) AS blocking_inventory_item_id
       FROM food_menu_items fmi
       LEFT JOIN restaurant_inventory_item_mappings rim
         ON rim.menu_item_id = fmi.id
        AND rim.restaurant_id = fmi.restaurant_id
       LEFT JOIN restaurant_inventory_items rii
         ON rii.id = rim.inventory_item_id
        AND rii.restaurant_id = rim.restaurant_id
        AND rii.is_active = TRUE
      WHERE fmi.restaurant_id = $1
        AND (
          ($3::bigint IS NOT NULL AND fmi.id = $3)
          OR ($3::bigint IS NULL AND $2::bigint IS NULL)
          OR ($3::bigint IS NULL AND EXISTS (
            SELECT 1
              FROM restaurant_inventory_item_mappings impacted
             WHERE impacted.restaurant_id = fmi.restaurant_id
               AND impacted.menu_item_id = fmi.id
               AND impacted.inventory_item_id = $2
          ))
        )
      GROUP BY fmi.id, fmi.name, fmi.is_available, fmi.manual_available,
               fmi.inventory_available, fmi.inventory_availability_state
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
    return {
      ...row,
      next_inventory_state: nextInventoryState,
      next_inventory_available: nextInventoryAvailable,
      next_available: row.manual_available && nextInventoryAvailable,
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
      await db.query(
        `UPDATE food_menu_items
            SET inventory_available = $1,
                inventory_availability_state = $2,
                is_available = $3,
                updated_at = NOW()
          WHERE id = $4 AND restaurant_id = $5`,
        [change.next_inventory_available, change.next_inventory_state, change.next_available, change.menu_item_id, restaurantId]
      );
      await db.query(
        `INSERT INTO restaurant_inventory_availability_events
           (restaurant_id, inventory_item_id, menu_item_id, previous_available, next_available, reason, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [
          restaurantId,
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
