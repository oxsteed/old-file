"use strict";
const pool = require("../db");
const AppError = require("../utils/appError");
const { withTransaction } = require("../utils/transaction");

function positive(value, nullable = false) {
  if (nullable && (value === undefined || value === null || value === ""))
    return null;
  if (
    !/^\d+$/.test(String(value)) ||
    !Number.isSafeInteger(Number(value)) ||
    Number(value) < 1
  )
    throw new AppError("Invalid screen scope", 400, "screen_invalid_scope");
  return Number(value);
}
function cursor(value = 0) {
  if (!/^\d+$/.test(String(value)) || !Number.isSafeInteger(Number(value)))
    throw new AppError("Invalid screen cursor", 400, "screen_invalid_cursor");
  return Number(value);
}
function deviceHealth(device, now = Date.now()) {
  if (device.status !== "paired") return device.status;
  const age = now - new Date(device.last_seen_at || 0).getTime();
  return !Number.isFinite(age) || age >= 60000
    ? "offline"
    : age >= 45000
      ? "degraded"
      : "online";
}
async function changes(scope, after, limit = 250) {
  const since = cursor(after),
    count = Math.max(1, Math.min(Number(limit) || 250, 500));
  const {
    rows: [head],
  } = await pool.query(
    "SELECT revision FROM restaurant_screen_streams WHERE restaurant_id=$1",
    [scope.restaurantId],
  );
  const high = Number(head?.revision || 0);
  if (since > high)
    return { resetRequired: true, cursor: high, events: [], hasMore: false };
  // Scan before filtering so a location never gets stuck behind invisible events.
  const { rows } = await pool.query(
    "SELECT revision,location_id,kind,entity_id FROM restaurant_screen_events WHERE restaurant_id=$1 AND revision>$2 AND revision<=$3 ORDER BY revision LIMIT $4",
    [scope.restaurantId, since, high, count],
  );
  if (
    (!rows.length && since < high) ||
    (rows.length && Number(rows[0].revision) > since + 1)
  )
    return { resetRequired: true, cursor: high, events: [], hasMore: false };
  return {
    cursor: rows.length ? Number(rows.at(-1).revision) : high,
    hasMore: rows.length === count,
    events: rows
      .filter(
        (e) =>
          scope.allLocations ||
          e.location_id === null ||
          String(e.location_id) === String(scope.locationId),
      )
      .map((e) =>
        scope.readOrders === false
          ? { revision: Number(e.revision) }
          : {
              revision: Number(e.revision),
              kind: e.kind,
              entityId: e.entity_id,
            },
      ),
    serverTime: new Date().toISOString(),
  };
}
async function snapshot(scope, query = {}) {
  return withTransaction(
    pool,
    async (client) => {
      await client.query(
        "SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY",
      );
      const {
        rows: [restaurant],
      } = await client.query(
        "SELECT id,business_id,display_name,currency_code,screens_v2_enabled,accepts_in_store_orders,settings FROM food_restaurants WHERE id=$1",
        [scope.restaurantId],
      );
      if (!restaurant)
        throw new AppError("Restaurant not found", 404, "restaurant_not_found");
      const {
        rows: [head],
      } = await client.query(
        "SELECT revision FROM restaurant_screen_streams WHERE restaurant_id=$1",
        [scope.restaurantId],
      );
      const revision = Number(head?.revision || 0);
      if (
        query.snapshotCursor !== undefined &&
        cursor(query.snapshotCursor) !== revision
      )
        throw new AppError(
          "Snapshot changed; reload it",
          409,
          "screen_snapshot_changed",
        );
      const after = cursor(query.afterOrderId || 0);
      const { rows: orders } = scope.readOrders
        ? await client.query(
            `SELECT o.id,o.restaurant_id,o.location_id,o.queue_number,o.status,o.kitchen_stage,o.payment_status,o.screen_revision,o.fulfillment_type,o.created_at,o.preparation_started_at,o.promised_at,o.table_label,
     COALESCE((SELECT jsonb_agg(jsonb_build_object('id',i.id,'itemName',i.item_name,'quantity',i.quantity,'specialInstructions',i.special_instructions,'kitchenStatus',i.kitchen_status,'stationLabel',i.station_label,'screenRevision',i.screen_revision,'targetPrepSeconds',i.target_prep_seconds,'kitchenStartedAt',i.kitchen_started_at,'modifiers',COALESCE((SELECT jsonb_agg(m.modifier_name) FROM food_order_item_modifiers m WHERE m.order_item_id=i.id),'[]'::jsonb)) ORDER BY i.id) FROM food_order_items i WHERE i.order_id=o.id),'[]'::jsonb) AS items
    FROM food_orders o WHERE o.restaurant_id=$1 AND ($2::boolean OR o.location_id IS NOT DISTINCT FROM $3::bigint)
    AND o.id>$4 AND o.status IN ('received','accepted','preparing','ready') AND COALESCE(o.pos_ticket_state,'open') NOT IN ('held','voided') ORDER BY o.id LIMIT 251`,
            [scope.restaurantId, scope.allLocations, scope.locationId, after],
          )
        : { rows: [] };
      const page = orders.slice(0, 250);
      const { rows: publicOrders } = await client.query(
        `SELECT queue_number,status FROM food_orders WHERE restaurant_id=$1 AND ($2::boolean OR location_id IS NOT DISTINCT FROM $3::bigint) AND status IN ('received','accepted','preparing','ready') AND COALESCE(pos_ticket_state,'open') NOT IN ('held','voided') AND NOT(payment_status='requires_payment' AND COALESCE(metadata->>'paymentMode','')='pay_now') ORDER BY created_at`,
        [scope.restaurantId, scope.allLocations, scope.locationId],
      );
      const board = {
        restaurant: { display_name: restaurant.display_name },
        preparing: publicOrders
          .filter((o) => o.status !== "ready")
          .map((o) => o.queue_number),
        ready: publicOrders
          .filter((o) => o.status === "ready")
          .map((o) => o.queue_number),
      };
      const kitchen =
        restaurant.settings?.kitchenPrep ||
        restaurant.settings?.kitchen_prep ||
        {};
      return {
        enabled: restaurant.screens_v2_enabled,
        deviceConfigVersion: scope.device?.config_version || null,
        cursor: revision,
        serverTime: new Date().toISOString(),
        restaurant: {
          id: restaurant.id,
          businessId: restaurant.business_id,
          name: restaurant.display_name,
          currencyCode: restaurant.currency_code,
          acceptingOrders: restaurant.accepts_in_store_orders,
        },
        board,
        workflow: {
          requireQualityCheck:
            kitchen.requireQualityCheck !== false &&
            kitchen.require_quality_check !== false,
        },
        orders: page,
        hasMore: orders.length > 250,
        nextOrderId: page.at(-1)?.id || null,
      };
    },
    "restaurant_screen_snapshot",
  );
}
async function publishBatch() {
  const socketService = require("./socketService");
  return withTransaction(
    pool,
    async (client) => {
      const { rows } = await client.query(
        "SELECT restaurant_id,MAX(revision)::text AS revision FROM (SELECT restaurant_id,revision FROM restaurant_screen_events WHERE published_at IS NULL ORDER BY created_at LIMIT 2000 FOR UPDATE SKIP LOCKED) e GROUP BY restaurant_id",
      );
      for (const row of rows) {
        // Broadcast no tickets, customer data, or credentials to the public room.
        const sent = socketService.broadcastToRestaurantDisplay(
          row.restaurant_id,
          "food:display:changed",
          { restaurantId: row.restaurant_id, revision: Number(row.revision) },
        );
        if (sent === false)
          throw new Error("Restaurant display transport is unavailable");
        await client.query(
          "UPDATE restaurant_screen_events SET published_at=NOW() WHERE restaurant_id=$1 AND revision<=$2 AND published_at IS NULL",
          [row.restaurant_id, row.revision],
        );
      }
      return rows.length;
    },
    "restaurant_screen_outbox",
  );
}
module.exports = {
  positive,
  cursor,
  deviceHealth,
  changes,
  snapshot,
  publishBatch,
};
