'use strict';

// F-08: in-store hub service.
//
// The hub is a designated device per store (migration 997) that relays
// POS/KDS/printer traffic over the LAN while the internet is down and syncs
// with the cloud through the managed-screens revision journal
// (restaurant_screen_streams / restaurant_screen_events, migration 887).
// Offline cash sales are queued here (migration 998) and replayed idempotently
// on reconnect. Money fails closed:
//   - (restaurant_id, idempotency_key) is unique: a retried upload or replay
//     can never double-post;
//   - replay requires the referenced drawer shift to still be OPEN at the same
//     store; a sale whose shift closed first is marked 'held' for manager
//     review, never posted to a different shift;
//   - totals are recomputed server-side from the payload and must match;
//   - one bad sale rolls back to a savepoint, never the whole batch.

const AppError = require('../utils/appError');
const { nextQueueNumber } = require('./restaurantQueueCounter');

function normalizeId(value, field = 'id') {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) throw new AppError(`A valid ${field} is required`, 400, 'validation_failed');
  return id;
}

function normalizeHubName(value) {
  const name = String(value || '').trim();
  if (name.length < 2 || name.length > 160) throw new AppError('Hub name must be between 2 and 160 characters', 400, 'validation_failed');
  return name;
}

async function getHub(client, restaurantId, hubId) {
  const { rows: [hub] } = await client.query(
    `SELECT h.*, d.device_role, d.status AS device_status, d.source_app_device_id
       FROM store_hubs h
       LEFT JOIN restaurant_devices d ON d.id = h.device_id
      WHERE h.id = $1 AND h.restaurant_id = $2`,
    [hubId, restaurantId]
  );
  if (!hub) throw new AppError('Hub not found', 404, 'hub_not_found');
  return hub;
}

async function listHubs(client, restaurantId) {
  const { rows } = await client.query(
    `SELECT h.id, h.restaurant_id, h.location_id, l.name AS location_name,
            h.device_id, h.name, h.status, h.last_heartbeat_at,
            h.last_pull_revision, h.config, h.created_at, h.updated_at,
            (SELECT COUNT(*)::int FROM store_hub_offline_sales s
              WHERE s.hub_id = h.id AND s.status = 'queued') AS queued_sales,
            (SELECT COUNT(*)::int FROM store_hub_offline_sales s
              WHERE s.hub_id = h.id AND s.status = 'held') AS held_sales
       FROM store_hubs h
       JOIN restaurant_locations l
         ON l.restaurant_id = h.restaurant_id AND l.id = h.location_id
      WHERE h.restaurant_id = $1
      ORDER BY l.name ASC, h.id ASC`,
    [restaurantId]
  );
  return rows;
}

async function registerHub(client, { restaurantId, locationId, name, deviceId = null, actorUserId = null }) {
  const location = normalizeId(locationId, 'store');
  const hubName = normalizeHubName(name);
  const { rows: [store] } = await client.query(
    `SELECT id, timezone FROM restaurant_locations WHERE restaurant_id = $1 AND id = $2`,
    [restaurantId, location]
  );
  if (!store) throw new AppError('Store not found', 404, 'location_not_found');

  let registryId = deviceId == null ? null : normalizeId(deviceId, 'device');
  if (registryId == null) {
    // Designate a fresh hub identity in the unified registry (F-26). The
    // physical pairing still flows through the standard device pairing
    // endpoints; this row is the hub designation, not a credential.
    const { rows: [created] } = await client.query(
      `INSERT INTO restaurant_devices
         (restaurant_id, location_id, device_role, capabilities, pairing_source, source_key, created_by)
       VALUES ($1, $2, 'hub', $3, 'manual', $4, $5)
       RETURNING id`,
      [restaurantId, location, JSON.stringify({ hub: true }), `hub:${restaurantId}:${location}:${Date.now()}`, actorUserId]
    );
    registryId = created.id;
  } else {
    const { rows: [device] } = await client.query(
      `SELECT id, restaurant_id, location_id, device_role, status
         FROM restaurant_devices WHERE id = $1 AND restaurant_id = $2`,
      [registryId, restaurantId]
    );
    if (!device) throw new AppError('Device not found', 404, 'device_not_found');
    if (device.device_role !== 'hub') throw new AppError('Designated hub device must have the hub role', 400, 'device_role_mismatch');
    if (device.status === 'disabled') throw new AppError('Designated hub device is disabled', 409, 'device_disabled');
    if (device.location_id != null && Number(device.location_id) !== location) {
      throw new AppError('Designated hub device is assigned to a different store', 400, 'device_store_mismatch');
    }
  }

  const { rows: [hub] } = await client.query(
    `INSERT INTO store_hubs (restaurant_id, location_id, device_id, name, created_by, updated_by)
     VALUES ($1, $2, $3, $4, $5, $5)
     ON CONFLICT (restaurant_id, location_id)
     DO UPDATE SET device_id = EXCLUDED.device_id, name = EXCLUDED.name,
                   status = 'active', updated_by = EXCLUDED.updated_by, updated_at = NOW()
     RETURNING *`,
    [restaurantId, location, registryId, hubName, actorUserId]
  );
  return hub;
}

async function heartbeat(client, { restaurantId, hubId, pullRevision = null }) {
  const hub = await getHub(client, restaurantId, hubId);
  if (hub.status !== 'active') throw new AppError('Hub is disabled', 409, 'hub_disabled');
  const { rows: [updated] } = await client.query(
    `UPDATE store_hubs
        SET last_heartbeat_at = NOW(),
            last_pull_revision = COALESCE($3, last_pull_revision),
            updated_at = NOW()
      WHERE id = $1 AND restaurant_id = $2
      RETURNING id, last_heartbeat_at, last_pull_revision`,
    [hubId, restaurantId, pullRevision == null ? null : Number(pullRevision)]
  );
  await client.query(`UPDATE restaurant_devices SET last_seen_at = NOW() WHERE id = $1`, [hub.device_id]);
  return updated;
}

// Pull the revision-journal events for the hub's store since a revision. The
// hub relays these over the LAN to POS/KDS/printer screens while offline.
async function pullChanges(client, { restaurantId, hubId, sinceRevision = 0, limit = 500 }) {
  const hub = await getHub(client, restaurantId, hubId);
  if (hub.status !== 'active') throw new AppError('Hub is disabled', 409, 'hub_disabled');
  const since = Number(sinceRevision) || 0;
  const capped = Math.min(Math.max(Number(limit) || 500, 1), 1000);
  const { rows: events } = await client.query(
    `SELECT revision, location_id, kind, entity_id
       FROM restaurant_screen_events
      WHERE restaurant_id = $1
        AND revision > $2
        AND (location_id IS NULL OR location_id = $3)
      ORDER BY revision ASC
      LIMIT $4`,
    [restaurantId, since, hub.location_id, capped]
  );
  const { rows: [stream] } = await client.query(
    `SELECT revision AS latest_revision FROM restaurant_screen_streams WHERE restaurant_id = $1`,
    [restaurantId]
  );
  return {
    hubId: Number(hubId),
    locationId: Number(hub.location_id),
    sinceRevision: since,
    latestRevision: stream ? Number(stream.latest_revision) : since,
    events: events.map((e) => ({
      revision: Number(e.revision),
      locationId: e.location_id == null ? null : Number(e.location_id),
      kind: e.kind,
      entityId: e.entity_id,
    })),
  };
}

function normalizeOfflineSale(input) {
  const hubSaleUuid = String(input.hubSaleUuid || input.hub_sale_uuid || '').trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(hubSaleUuid)) {
    throw new AppError('hubSaleUuid must be a UUID', 400, 'validation_failed');
  }
  const idempotencyKey = String(input.idempotencyKey || input.idempotency_key || '').trim();
  if (idempotencyKey.length < 8 || idempotencyKey.length > 200) {
    throw new AppError('idempotencyKey must be 8-200 characters', 400, 'validation_failed');
  }
  const shiftId = normalizeId(input.shiftId ?? input.shift_id, 'shift');
  const items = input.items;
  if (!Array.isArray(items) || items.length < 1 || items.length > 100) {
    throw new AppError('items must be a non-empty array of at most 100 lines', 400, 'validation_failed');
  }
  const lines = items.map((line, index) => {
    const menuItemId = normalizeId(line.menuItemId ?? line.menu_item_id, `items[${index}].menuItemId`);
    const quantity = Number(line.quantity);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 999) {
      throw new AppError(`items[${index}].quantity must be an integer between 1 and 999`, 400, 'validation_failed');
    }
    const unitPriceCents = Number(line.unitPriceCents ?? line.unit_price_cents);
    if (!Number.isInteger(unitPriceCents) || unitPriceCents < 0) {
      throw new AppError(`items[${index}].unitPriceCents must be a non-negative integer`, 400, 'validation_failed');
    }
    return { menuItemId, quantity, unitPriceCents, name: String(line.name || '').slice(0, 160) || null };
  });
  for (const field of ['subtotalCents', 'taxCents', 'tipCents', 'discountCents', 'totalCents', 'cashTenderedCents']) {
    const value = Number(input[field] ?? input[field.replace(/([A-Z])/g, (m) => `_${m.toLowerCase()}`)] ?? 0);
    if (!Number.isInteger(value) || value < 0) throw new AppError(`${field} must be a non-negative integer`, 400, 'validation_failed');
  }
  const subtotalCents = Number(input.subtotalCents ?? input.subtotal_cents ?? 0);
  const taxCents = Number(input.taxCents ?? input.tax_cents ?? 0);
  const tipCents = Number(input.tipCents ?? input.tip_cents ?? 0);
  const discountCents = Number(input.discountCents ?? input.discount_cents ?? 0);
  const totalCents = Number(input.totalCents ?? input.total_cents);
  const cashTenderedCents = Number(input.cashTenderedCents ?? input.cash_tendered_cents);
  if (!Number.isInteger(totalCents) || totalCents < 0) throw new AppError('totalCents must be a non-negative integer', 400, 'validation_failed');
  if (!Number.isInteger(cashTenderedCents) || cashTenderedCents < totalCents) {
    throw new AppError('cashTenderedCents must cover totalCents', 400, 'validation_failed');
  }
  const computedSubtotal = lines.reduce((sum, line) => sum + line.quantity * line.unitPriceCents, 0);
  if (computedSubtotal !== subtotalCents) throw new AppError('subtotalCents does not match the item lines', 400, 'totals_mismatch');
  if (subtotalCents + taxCents + tipCents - discountCents !== totalCents) {
    throw new AppError('totalCents does not match subtotal + tax + tip - discount', 400, 'totals_mismatch');
  }
  return {
    hubSaleUuid, idempotencyKey, shiftId, lines,
    subtotalCents, taxCents, tipCents, discountCents, totalCents, cashTenderedCents,
    currencyCode: String(input.currencyCode || input.currency_code || 'USD').slice(0, 3).toUpperCase(),
    note: String(input.note || '').slice(0, 500) || null,
  };
}

// Queue offline cash sales from the hub. Safe to retry: the unique
// (restaurant_id, idempotency_key) key makes re-uploads a no-op.
async function queueOfflineSales(client, { restaurantId, hubId, sales }) {
  const hub = await getHub(client, restaurantId, hubId);
  if (hub.status !== 'active') throw new AppError('Hub is disabled', 409, 'hub_disabled');
  if (!Array.isArray(sales) || sales.length < 1 || sales.length > 200) {
    throw new AppError('sales must be a non-empty array of at most 200 entries', 400, 'validation_failed');
  }
  const queued = [];
  for (const raw of sales) {
    const sale = normalizeOfflineSale(raw);
    // The shift must exist and belong to this store; whether it is still
    // open is decided at replay time (fail closed there).
    const { rows: [shift] } = await client.query(
      `SELECT id, status FROM restaurant_pos_shifts WHERE id = $1 AND restaurant_id = $2 AND location_id = $3`,
      [sale.shiftId, restaurantId, hub.location_id]
    );
    if (!shift) throw new AppError(`Shift ${sale.shiftId} was not found at this store`, 404, 'shift_not_found');
    const { rows: [row] } = await client.query(
      `INSERT INTO store_hub_offline_sales
         (restaurant_id, location_id, hub_id, hub_sale_uuid, idempotency_key,
          shift_id, payload, total_cents, cash_tendered_cents, currency_code)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (restaurant_id, idempotency_key) DO NOTHING
       RETURNING id, status`,
      [
        restaurantId, hub.location_id, hubId, sale.hubSaleUuid, sale.idempotencyKey,
        sale.shiftId,
        JSON.stringify({ lines: sale.lines, subtotalCents: sale.subtotalCents, taxCents: sale.taxCents, tipCents: sale.tipCents, discountCents: sale.discountCents, note: sale.note }),
        sale.totalCents, sale.cashTenderedCents, sale.currencyCode,
      ]
    );
    if (row) queued.push({ id: Number(row.id), idempotencyKey: sale.idempotencyKey, status: row.status });
    else {
      const { rows: [existing] } = await client.query(
        `SELECT id, status FROM store_hub_offline_sales WHERE restaurant_id = $1 AND idempotency_key = $2`,
        [restaurantId, sale.idempotencyKey]
      );
      queued.push({ id: Number(existing.id), idempotencyKey: sale.idempotencyKey, status: existing.status, duplicate: true });
    }
  }
  return { hubId: Number(hubId), queued };
}

async function replayOneSale(client, { sale, restaurant, timezone, actorUserId }) {
  // Re-check the shift inside the replay: it must still be open at the same
  // store. A closed shift means the money was already counted; the sale is
  // held for manager review instead of being posted anywhere else.
  const { rows: [shift] } = await client.query(
    `SELECT id, status, location_id FROM restaurant_pos_shifts
      WHERE id = $1 AND restaurant_id = $2 FOR UPDATE`,
    [sale.shift_id, sale.restaurant_id]
  );
  if (!shift || shift.status !== 'open' || Number(shift.location_id) !== Number(sale.location_id)) {
    await client.query(
      `UPDATE store_hub_offline_sales
          SET status = 'held',
              replay_error = 'Drawer shift is closed or moved; manager review required before posting.',
              updated_at = NOW()
        WHERE id = $1`,
      [sale.id]
    );
    return { saleId: Number(sale.id), status: 'held' };
  }
  const payload = sale.payload || {};
  const lines = Array.isArray(payload.lines) ? payload.lines : [];
  // Tenant check: every line's menu item must belong to this restaurant.
  const menuItemIds = [...new Set(lines.map((line) => Number(line.menuItemId)))];
  const { rows: items } = await client.query(
    `SELECT id, name FROM food_menu_items WHERE restaurant_id = $1 AND id = ANY($2::bigint[])`,
    [sale.restaurant_id, menuItemIds]
  );
  if (items.length !== menuItemIds.length) {
    throw new AppError('One or more menu items do not belong to this restaurant', 400, 'menu_item_tenancy');
  }
  const names = new Map(items.map((item) => [Number(item.id), item.name]));
  const queueNumber = await nextQueueNumber(client, sale.restaurant_id, timezone, new Date(), sale.location_id);
  const clientOrderId = `hub:${sale.hub_sale_uuid}`;
  const { rows: [order] } = await client.query(
    `INSERT INTO food_orders
       (restaurant_id, business_id, location_id, order_source, fulfillment_type,
        status, payment_status, pos_ticket_state, kitchen_stage,
        subtotal_cents, tax_cents, tip_cents, discount_cents, total_cents,
        currency_code, queue_number, client_order_id, metadata)
     VALUES ($1,$2,$3,'counter','pickup',
             'completed','paid','closed','new',
             $4,$5,$6,$7,$8,
             $9,$10,$11,$12)
     ON CONFLICT (restaurant_id, client_order_id) WHERE client_order_id IS NOT NULL
     DO NOTHING
     RETURNING id`,
    [
      sale.restaurant_id, restaurant.business_id, sale.location_id,
      payload.subtotalCents || 0, payload.taxCents || 0, payload.tipCents || 0,
      payload.discountCents || 0, sale.total_cents, sale.currency_code,
      queueNumber, clientOrderId,
      JSON.stringify({ offline_replay: true, hub_sale_uuid: sale.hub_sale_uuid, hub_id: sale.hub_id, note: payload.note || null }),
    ]
  );
  if (!order) {
    // Another replay already posted this sale (client_order_id unique).
    const { rows: [existing] } = await client.query(
      `SELECT id FROM food_orders WHERE restaurant_id = $1 AND client_order_id = $2`,
      [sale.restaurant_id, clientOrderId]
    );
    await client.query(
      `UPDATE store_hub_offline_sales
          SET status = 'replayed', food_order_id = $2, replayed_at = COALESCE(replayed_at, NOW()),
              replay_error = NULL, updated_at = NOW()
        WHERE id = $1`,
      [sale.id, existing.id]
    );
    return { saleId: Number(sale.id), status: 'replayed', orderId: Number(existing.id), duplicate: true };
  }
  for (const line of lines) {
    await client.query(
      `INSERT INTO food_order_items
         (order_id, menu_item_id, item_name, quantity,
          unit_price_cents, line_total_cents, kitchen_status)
       VALUES ($1,$2,$3,$4,$5,$6,'queued')`,
      [
        order.id, line.menuItemId,
        line.name || names.get(Number(line.menuItemId)) || 'Item',
        line.quantity, line.unitPriceCents, line.quantity * line.unitPriceCents,
      ]
    );
  }
  const { rows: [payment] } = await client.query(
    `INSERT INTO restaurant_pos_payments
       (restaurant_id, food_order_id, location_id, payment_type, amount_cents,
        status, idempotency_key, shift_id, metadata)
     VALUES ($1,$2,$3,'cash',$4,'recorded',$5,$6,$7)
     ON CONFLICT (restaurant_id, idempotency_key) WHERE idempotency_key IS NOT NULL
     DO NOTHING
     RETURNING id`,
    [
      sale.restaurant_id, order.id, sale.location_id, sale.total_cents,
      sale.idempotency_key, sale.shift_id,
      JSON.stringify({ offline_replay: true, hub_sale_uuid: sale.hub_sale_uuid, cash_tendered_cents: sale.cash_tendered_cents }),
    ]
  );
  const paymentId = payment ? payment.id : (await client.query(
    `SELECT id FROM restaurant_pos_payments WHERE restaurant_id = $1 AND idempotency_key = $2`,
    [sale.restaurant_id, sale.idempotency_key]
  )).rows[0].id;
  // The in-store print agent claims this on reconnect; nothing is dialed
  // from the server (F-05/F-26: the job queue is the only print path).
  await client.query(
    `INSERT INTO restaurant_printer_jobs
       (restaurant_id, location_id, food_order_id, job_type, payload, created_by)
     VALUES ($1,$2,$3,'receipt',$4,$5)`,
    [
      sale.restaurant_id, sale.location_id, order.id,
      JSON.stringify({ order_id: order.id, queue_number: queueNumber, offline_replay: true }),
      actorUserId,
    ]
  );
  await client.query(`SELECT restaurant_screen_record_change($1, $2, 'order', $3::text)`, [
    sale.restaurant_id, sale.location_id, String(order.id),
  ]);
  await client.query(
    `UPDATE store_hub_offline_sales
        SET status = 'replayed', food_order_id = $2, pos_payment_id = $3,
            replayed_at = NOW(), replay_error = NULL, updated_at = NOW()
      WHERE id = $1`,
    [sale.id, order.id, paymentId]
  );
  return { saleId: Number(sale.id), status: 'replayed', orderId: Number(order.id), paymentId: Number(paymentId) };
}

// Replay every queued sale for the hub's store. Idempotent: already-replayed
// sales are skipped, and the per-sale savepoint keeps one bad sale from
// aborting the batch.
async function replaySales(client, { restaurantId, hubId, actorUserId = null }) {
  const hub = await getHub(client, restaurantId, hubId);
  const { rows: [restaurant] } = await client.query(
    `SELECT id, business_id, timezone FROM food_restaurants WHERE id = $1`,
    [restaurantId]
  );
  if (!restaurant) throw new AppError('Restaurant not found', 404, 'restaurant_not_found');
  const { rows: [locked] } = await client.query(
    `SELECT id FROM store_hubs WHERE id = $1 AND restaurant_id = $2 FOR UPDATE`,
    [hubId, restaurantId]
  );
  if (!locked) throw new AppError('Hub not found', 404, 'hub_not_found');
  const { rows: sales } = await client.query(
    `SELECT * FROM store_hub_offline_sales
      WHERE hub_id = $1 AND restaurant_id = $2 AND status = 'queued'
      ORDER BY id ASC
      FOR UPDATE SKIP LOCKED`,
    [hubId, restaurantId]
  );
  const results = [];
  for (const sale of sales) {
    await client.query('SAVEPOINT hub_replay_sale');
    try {
      results.push(await replayOneSale(client, { sale, restaurant, timezone: restaurant.timezone || 'UTC', actorUserId }));
      await client.query('RELEASE SAVEPOINT hub_replay_sale');
    } catch (error) {
      await client.query('ROLLBACK TO SAVEPOINT hub_replay_sale');
      await client.query(
        `UPDATE store_hub_offline_sales
            SET status = 'failed', replay_error = $2, updated_at = NOW()
          WHERE id = $1`,
        [sale.id, String(error?.message || error).slice(0, 500)]
      );
      results.push({ saleId: Number(sale.id), status: 'failed', error: String(error?.message || error).slice(0, 200) });
    }
  }
  return { hubId: Number(hubId), processed: results.length, results };
}

async function listOfflineSales(client, { restaurantId, hubId, status = null, limit = 100 }) {
  await getHub(client, restaurantId, hubId);
  const { rows } = await client.query(
    `SELECT id, hub_sale_uuid, idempotency_key, shift_id, total_cents,
            cash_tendered_cents, currency_code, status, food_order_id,
            pos_payment_id, replay_error, replayed_at, created_at
       FROM store_hub_offline_sales
      WHERE hub_id = $1 AND restaurant_id = $2
        AND ($3::text IS NULL OR status = $3)
      ORDER BY id DESC
      LIMIT $4`,
    [hubId, restaurantId, status, Math.min(Math.max(Number(limit) || 100, 1), 500)]
  );
  return rows;
}

module.exports = {
  normalizeId,
  normalizeHubName,
  normalizeOfflineSale,
  getHub,
  listHubs,
  registerHub,
  heartbeat,
  pullChanges,
  queueOfflineSales,
  replaySales,
  listOfflineSales,
};
