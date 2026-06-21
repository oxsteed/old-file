'use strict';

async function enqueueKitchenPrinterJobs(client, {
  restaurantId,
  orderId,
  createdBy = null,
}) {
  const { rows } = await client.query(
    `WITH default_station AS (
       SELECT id
         FROM restaurant_kitchen_stations
        WHERE restaurant_id = $1 AND is_active = TRUE
        ORDER BY id ASC
        LIMIT 1
     )
     SELECT fo.id AS order_id, fo.queue_number, fo.guest_name, fo.fulfillment_type,
            fo.table_label, fo.notes AS order_notes, fo.promised_at,
            foi.id AS order_item_id, foi.menu_item_id, foi.item_name, foi.quantity,
            foi.special_instructions,
            COALESCE(routed_station.id, default_station.id) AS station_id,
            station.name AS station_name,
            station.device_id
       FROM food_orders fo
       JOIN food_order_items foi ON foi.order_id = fo.id
       LEFT JOIN restaurant_menu_item_station_routes route
         ON route.restaurant_id = fo.restaurant_id
        AND route.menu_item_id = foi.menu_item_id
       LEFT JOIN restaurant_kitchen_stations routed_station
         ON routed_station.id = route.station_id
        AND routed_station.restaurant_id = fo.restaurant_id
        AND routed_station.is_active = TRUE
       LEFT JOIN default_station ON TRUE
       LEFT JOIN restaurant_kitchen_stations station
         ON station.id = COALESCE(routed_station.id, default_station.id)
        AND station.restaurant_id = fo.restaurant_id
        AND station.is_active = TRUE
      WHERE fo.restaurant_id = $1 AND fo.id = $2
      ORDER BY station.id, foi.id`,
    [restaurantId, orderId]
  );
  const grouped = new Map();
  for (const row of rows) {
    if (!row.station_id) continue;
    if (!grouped.has(String(row.station_id))) {
      grouped.set(String(row.station_id), {
        stationId: row.station_id,
        stationName: row.station_name,
        deviceId: row.device_id,
        order: {
          id: row.order_id,
          queueNumber: row.queue_number,
          guestName: row.guest_name,
          fulfillmentType: row.fulfillment_type,
          tableLabel: row.table_label,
          notes: row.order_notes,
          promisedAt: row.promised_at,
        },
        items: [],
      });
    }
    grouped.get(String(row.station_id)).items.push({
      id: row.order_item_id,
      menuItemId: row.menu_item_id,
      name: row.item_name,
      quantity: row.quantity,
      specialInstructions: row.special_instructions,
    });
  }
  const jobs = [];
  for (const group of grouped.values()) {
    await client.query(
      `UPDATE food_order_items foi
          SET station_label = COALESCE(foi.station_label, $1), updated_at = NOW()
        WHERE foi.order_id = $2
          AND foi.id = ANY($3::bigint[])`,
      [group.stationName, orderId, group.items.map((item) => item.id)]
    );
    const idempotencyKey = `order:${orderId}:station:${group.stationId}:kitchen_ticket`;
    const { rows: [job] } = await client.query(
      `INSERT INTO restaurant_printer_jobs
         (restaurant_id, station_id, food_order_id, job_type, payload, created_by, idempotency_key)
       VALUES ($1,$2,$3,'kitchen_ticket',$4,$5,$6)
       ON CONFLICT (restaurant_id, idempotency_key) WHERE idempotency_key IS NOT NULL
       DO UPDATE SET payload = EXCLUDED.payload, updated_at = NOW()
       RETURNING *`,
      [restaurantId, group.stationId, orderId, JSON.stringify(group), createdBy, idempotencyKey]
    );
    jobs.push(job);
  }
  return jobs;
}

module.exports = { enqueueKitchenPrinterJobs };
