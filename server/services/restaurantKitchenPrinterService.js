'use strict';

async function enqueueKitchenPrinterJobs(client, {
  restaurantId,
  orderId,
  createdBy = null,
}) {  const { rows } = await client.query(
    `WITH default_station AS (
       SELECT id
         FROM restaurant_kitchen_stations
        WHERE restaurant_id = $1
          AND is_active = TRUE
          AND location_id = (SELECT location_id FROM food_orders WHERE id = $2 AND restaurant_id = $1)
        ORDER BY id ASC
        LIMIT 1
     )
     SELECT fo.id AS order_id, fo.queue_number, fo.guest_name, fo.fulfillment_type,
            fo.table_label, fo.notes AS order_notes, fo.promised_at,
            fo.location_id AS order_location_id,
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
        AND routed_station.location_id = fo.location_id
        AND routed_station.is_active = TRUE
       LEFT JOIN default_station ON TRUE
       LEFT JOIN restaurant_kitchen_stations station
         ON station.id = COALESCE(routed_station.id, default_station.id)
        AND station.restaurant_id = fo.restaurant_id
        AND station.location_id = fo.location_id
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
          locationId: row.order_location_id || null,
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
         (restaurant_id, station_id, food_order_id, job_type, payload, created_by, idempotency_key, location_id)
       VALUES ($1,$2,$3,'kitchen_ticket',$4,$5,$6,$7)
       ON CONFLICT (restaurant_id, idempotency_key) WHERE idempotency_key IS NOT NULL
       DO UPDATE SET payload = EXCLUDED.payload, location_id = EXCLUDED.location_id, updated_at = NOW()
       RETURNING *`,
      [restaurantId, group.stationId, orderId, JSON.stringify(group), createdBy, idempotencyKey, group.order.locationId]
    );
    jobs.push(job);
  }
  return jobs;
}

// Course hold/fire chits: when a whole course is held or fired from the KDS,
// each station holding items of that course gets a chit so the line knows to
// stop or start the course. Payload shape matches renderKitchenTicket in
// restaurantPrintBridge.js ({ stationName, order, items }).
async function enqueueCourseChitJobs(client, {
  restaurantId,
  orderId,
  courseNumber,
  action,
  eventId = null,
  items = [],
  order = null,
  createdBy = null,
}) {
  if (!items.length) return [];
  const banner = action === 'fire' ? 'FIRE' : 'HOLD';
  const byStation = new Map();
  for (const item of items) {
    const stationKey = item.station_label || 'KITCHEN';
    if (!byStation.has(stationKey)) {
      byStation.set(stationKey, {
        stationName: `${stationKey} · COURSE ${courseNumber} · ${banner}`,
        order: {
          id: orderId,
          queueNumber: order?.queue_number ?? null,
          guestName: order?.guest_name ?? null,
          fulfillmentType: order?.fulfillment_type ?? null,
          tableLabel: order?.table_label ?? null,
          notes: order?.notes ?? null,
          promisedAt: order?.promised_at ?? null,
          locationId: order?.location_id ?? null,
        },
        items: [],
      });
    }
    const seatLine = item.seat_number ? `Seat ${item.seat_number}` : null;
    const instructions = [seatLine, item.special_instructions].filter(Boolean).join(' — ');
    byStation.get(stationKey).items.push({
      id: item.id,
      quantity: item.quantity,
      name: item.item_name,
      specialInstructions: instructions || null,
    });
  }
  const jobs = [];
  for (const group of byStation.values()) {
    // One chit per course action (eventId), so hold -> fire -> hold prints
    // three chits; client idempotency dedupes retries of the same action.
    const idempotencyKey = `course:${orderId}:${courseNumber}:${action}:${eventId || 'na'}:${cryptoSafe(group.stationName)}`;
    const { rows: [job] } = await client.query(
      `INSERT INTO restaurant_printer_jobs
         (restaurant_id, station_id, food_order_id, job_type, payload, created_by, idempotency_key, location_id)
       VALUES ($1,NULL,$2,'kitchen_ticket',$3,$4,$5,$6)
       ON CONFLICT (restaurant_id, idempotency_key) WHERE idempotency_key IS NOT NULL
       DO UPDATE SET payload = EXCLUDED.payload, location_id = EXCLUDED.location_id, updated_at = NOW()
       RETURNING *`,
      [restaurantId, orderId, JSON.stringify(group), createdBy, idempotencyKey, group.order.locationId]
    );
    jobs.push(job);
  }
  return jobs;
}

function cryptoSafe(value) {
  return String(value || '').replace(/[^a-zA-Z0-9]+/g, '-').slice(0, 60);
}

module.exports = { enqueueKitchenPrinterJobs, enqueueCourseChitJobs };
