'use strict';

const { AppError } = require('../middleware/errorHandler');
const { syncMappedMenuAvailability } = require('./restaurantInventoryAvailabilityService');

function asPositiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function uniquePositiveIds(values) {
  return [...new Set(values.map((value) => Number(value)).filter((value) => Number.isInteger(value) && value > 0))];
}

function unavailableError(row, requestedQuantity, availableQuantity) {
  return new AppError(
    'One or more menu items are temporarily unavailable',
    409,
    'inventory_unavailable',
    {
      menuItemId: Number(row.menu_item_id),
      inventoryItemId: row.inventory_item_id ? Number(row.inventory_item_id) : null,
      inventoryItemName: row.inventory_item_name || null,
      requestedQuantity,
      availableQuantity: Math.max(0, availableQuantity),
    }
  );
}

async function lockMappedInventory(client, restaurantId, menuItemIds) {
  await client.query(
    `SELECT rii.id
       FROM restaurant_inventory_items rii
       JOIN restaurant_inventory_item_mappings rim
         ON rim.inventory_item_id = rii.id
        AND rim.restaurant_id = rii.restaurant_id
      WHERE rii.restaurant_id = $1
        AND rii.is_active = TRUE
        AND rim.auto_manage = TRUE
        AND rim.menu_item_id = ANY($2::bigint[])
      ORDER BY rii.id
      FOR UPDATE OF rii`,
    [restaurantId, menuItemIds]
  );
}

async function loadMappings(client, restaurantId, menuItemIds) {
  const { rows } = await client.query(
    `SELECT rim.inventory_item_id,
            rim.menu_item_id,
            rim.required_quantity,
            rii.id AS active_inventory_item_id,
            rii.name AS inventory_item_name,
            rii.quantity AS on_hand_quantity,
            COALESCE(reserved.quantity, 0) AS reserved_quantity
       FROM restaurant_inventory_item_mappings rim
       LEFT JOIN restaurant_inventory_items rii
         ON rii.id = rim.inventory_item_id
        AND rii.restaurant_id = rim.restaurant_id
        AND rii.is_active = TRUE
       LEFT JOIN (
         SELECT inventory_item_id, SUM(quantity) AS quantity
           FROM restaurant_inventory_order_reservations
          WHERE restaurant_id = $1 AND status = 'reserved'
          GROUP BY inventory_item_id
       ) reserved ON reserved.inventory_item_id = rim.inventory_item_id
      WHERE rim.restaurant_id = $1
        AND rim.auto_manage = TRUE
        AND rim.menu_item_id = ANY($2::bigint[])
      ORDER BY rim.inventory_item_id, rim.menu_item_id`,
    [restaurantId, menuItemIds]
  );
  return rows;
}

async function refreshMenuAvailability(client, restaurantId, inventoryItemIds) {
  await Promise.all(
    uniquePositiveIds(inventoryItemIds).map((inventoryItemId) => syncMappedMenuAvailability(client, restaurantId, {
      inventoryItemId,
      apply: true,
    }))
  );
}

async function reserveInventoryForOrder(client, { restaurantId, orderId, orderItems }) {
  const items = (Array.isArray(orderItems) ? orderItems : [])
    .map((item) => ({
      id: Number(item.id),
      menuItemId: Number(item.menuItemId || item.menu_item_id),
      quantity: asPositiveNumber(item.quantity),
    }))
    .filter((item) => Number.isInteger(item.id) && item.id > 0
      && Number.isInteger(item.menuItemId) && item.menuItemId > 0
      && item.quantity > 0);
  if (!items.length) return { reservations: [] };

  const menuItemIds = uniquePositiveIds(items.map((item) => item.menuItemId));
  await lockMappedInventory(client, restaurantId, menuItemIds);
  const mappings = await loadMappings(client, restaurantId, menuItemIds);
  if (!mappings.length) return { reservations: [] };

  const mappingsByMenuItem = new Map();
  for (const mapping of mappings) {
    const list = mappingsByMenuItem.get(Number(mapping.menu_item_id)) || [];
    list.push(mapping);
    mappingsByMenuItem.set(Number(mapping.menu_item_id), list);
  }

  const demandByInventoryItem = new Map();
  for (const item of items) {
    for (const mapping of mappingsByMenuItem.get(item.menuItemId) || []) {
      const requiredQuantity = asPositiveNumber(mapping.required_quantity);
      if (!requiredQuantity) continue;
      const demand = item.quantity * requiredQuantity;
      demandByInventoryItem.set(
        Number(mapping.inventory_item_id),
        (demandByInventoryItem.get(Number(mapping.inventory_item_id)) || 0) + demand
      );
    }
  }

  for (const mapping of mappings) {
    const inventoryItemId = Number(mapping.inventory_item_id);
    const requiredDemand = demandByInventoryItem.get(inventoryItemId) || 0;
    if (!requiredDemand) continue;
    if (!mapping.active_inventory_item_id) {
      throw unavailableError(mapping, requiredDemand, 0);
    }
    const available = Number(mapping.on_hand_quantity || 0) - Number(mapping.reserved_quantity || 0);
    if (available < requiredDemand) {
      throw unavailableError(mapping, requiredDemand, available);
    }
  }

  const createdReservations = [];
  for (const item of items) {
    for (const mapping of mappingsByMenuItem.get(item.menuItemId) || []) {
      const requiredQuantity = asPositiveNumber(mapping.required_quantity);
      const quantity = item.quantity * requiredQuantity;
      if (!quantity) continue;
      const { rows: [reservation] } = await client.query(
        `INSERT INTO restaurant_inventory_order_reservations
           (restaurant_id, food_order_id, food_order_item_id, inventory_item_id, menu_item_id, quantity)
         VALUES ($1,$2,$3,$4,$5,$6)
         RETURNING *`,
        [restaurantId, orderId, item.id, mapping.inventory_item_id, item.menuItemId, quantity]
      );
      createdReservations.push(reservation);
    }
  }
  await refreshMenuAvailability(client, restaurantId, mappings.map((mapping) => mapping.inventory_item_id));
  return { reservations: createdReservations };
}

async function releaseInventoryForOrder(client, { restaurantId, orderId }) {
  const { rows } = await client.query(
    `UPDATE restaurant_inventory_order_reservations
        SET status = 'released', released_at = COALESCE(released_at, NOW())
      WHERE restaurant_id = $1 AND food_order_id = $2 AND status = 'reserved'
      RETURNING inventory_item_id`,
    [restaurantId, orderId]
  );
  await refreshMenuAvailability(client, restaurantId, rows.map((row) => row.inventory_item_id));
  return { released: rows.length };
}

async function consumeInventoryForOrder(client, { restaurantId, orderId, actorUserId = null }) {
  const { rows: reservations } = await client.query(
    `SELECT r.id, r.inventory_item_id, r.quantity, rii.name AS inventory_item_name,
            rii.quantity AS on_hand_quantity
       FROM restaurant_inventory_order_reservations r
       JOIN restaurant_inventory_items rii
         ON rii.id = r.inventory_item_id AND rii.restaurant_id = r.restaurant_id
      WHERE r.restaurant_id = $1 AND r.food_order_id = $2 AND r.status = 'reserved'
      ORDER BY r.inventory_item_id, r.id
      FOR UPDATE OF r, rii`,
    [restaurantId, orderId]
  );
  if (!reservations.length) return { consumed: 0 };

  const consumedInventoryItemIds = [];
  for (const reservation of reservations) {
    const quantity = Number(reservation.quantity);
    const onHand = Number(reservation.on_hand_quantity);
    if (onHand < quantity) {
      throw new AppError(
        'Inventory changed before this order could be completed',
        409,
        'inventory_consistency_conflict',
        { inventoryItemId: Number(reservation.inventory_item_id), inventoryItemName: reservation.inventory_item_name }
      );
    }
    const { rows: [updatedItem] } = await client.query(
      `UPDATE restaurant_inventory_items
          SET quantity = quantity - $1, updated_at = NOW()
        WHERE id = $2 AND restaurant_id = $3
        RETURNING quantity`,
      [quantity, reservation.inventory_item_id, restaurantId]
    );
    await client.query(
      `INSERT INTO restaurant_inventory_adjustments
         (restaurant_id, item_id, item_name, adjustment_type, quantity_delta, quantity_after,
          note, adjusted_by, source_type, source_id)
       VALUES ($1,$2,$3,'usage',$4,$5,$6,$7,'food_order',$8)`,
      [
        restaurantId,
        reservation.inventory_item_id,
        reservation.inventory_item_name,
        -quantity,
        updatedItem.quantity,
        `Consumed for food order #${orderId}`,
        actorUserId,
        orderId,
      ]
    );
    await client.query(
      `UPDATE restaurant_inventory_order_reservations
          SET status = 'consumed', consumed_at = COALESCE(consumed_at, NOW())
        WHERE id = $1 AND status = 'reserved'`,
      [reservation.id]
    );
    consumedInventoryItemIds.push(reservation.inventory_item_id);
  }
  await refreshMenuAvailability(client, restaurantId, consumedInventoryItemIds);
  return { consumed: reservations.length };
}

module.exports = {
  reserveInventoryForOrder,
  releaseInventoryForOrder,
  consumeInventoryForOrder,
};
