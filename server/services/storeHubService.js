'use strict';

// F-08: in-store hub service.
//
// The hub is a designated device per store (migration 99923) that relays
// POS/KDS/printer traffic over the LAN while the internet is down and syncs
// with the cloud through the managed-screens revision journal
// (restaurant_screen_streams / restaurant_screen_events, migration 887).
// Offline cash sales are queued here (migration 99924) and replayed idempotently
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
const {
  reserveInventoryForOrder,
  consumeInventoryForOrder,
} = require('./restaurantInventoryOrderService');
const { designateHubDevice } = require('./unifiedDeviceService');

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

async function listHubs(client, restaurantId, locationIds = null) {
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
      WHERE h.restaurant_id = $1 AND ($2::bigint[] IS NULL OR h.location_id=ANY($2::bigint[]))
      ORDER BY l.name ASC, h.id ASC`,
    [restaurantId,locationIds]
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
    const created = await designateHubDevice(client, {
      restaurantId, locationId: location, name: hubName, actorUserId,
    });
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
    if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 999) {
      throw new AppError(`items[${index}].quantity must be an integer between 1 and 999`, 400, 'validation_failed');
    }
    const unitPriceCents = Number(line.unitPriceCents ?? line.unit_price_cents);
    if (!Number.isSafeInteger(unitPriceCents) || unitPriceCents < 0) {
      throw new AppError(`items[${index}].unitPriceCents must be a non-negative integer`, 400, 'validation_failed');
    }
    return { menuItemId, quantity, unitPriceCents, name: String(line.name || '').slice(0, 160) || null };
  });
  for (const field of ['subtotalCents', 'taxCents', 'tipCents', 'discountCents', 'totalCents', 'cashTenderedCents']) {
    const value = Number(input[field] ?? input[field.replace(/([A-Z])/g, (m) => `_${m.toLowerCase()}`)] ?? 0);
    if (!Number.isSafeInteger(value) || value < 0) throw new AppError(`${field} must be a non-negative integer`, 400, 'validation_failed');
  }
  const subtotalCents = Number(input.subtotalCents ?? input.subtotal_cents ?? 0);
  const taxCents = Number(input.taxCents ?? input.tax_cents ?? 0);
  const tipCents = Number(input.tipCents ?? input.tip_cents ?? 0);
  const discountCents = Number(input.discountCents ?? input.discount_cents ?? 0);
  const totalCents = Number(input.totalCents ?? input.total_cents);
  const cashTenderedCents = Number(input.cashTenderedCents ?? input.cash_tendered_cents);
  if (!Number.isSafeInteger(totalCents) || totalCents < 0) throw new AppError('totalCents must be a non-negative integer', 400, 'validation_failed');
  if (!Number.isSafeInteger(cashTenderedCents) || cashTenderedCents < totalCents) {
    throw new AppError('cashTenderedCents must cover totalCents', 400, 'validation_failed');
  }
  const computedSubtotal = lines.reduce((sum, line) => sum + line.quantity * line.unitPriceCents, 0);
  if (computedSubtotal !== subtotalCents) throw new AppError('subtotalCents does not match the item lines', 400, 'totals_mismatch');
  const taxIncluded = input.taxIncluded === true;
  if (subtotalCents + (taxIncluded ? 0 : taxCents) + tipCents - discountCents !== totalCents) {
    throw new AppError('totalCents does not match subtotal + tax + tip - discount', 400, 'totals_mismatch');
  }
  return {
    hubSaleUuid, idempotencyKey, shiftId, lines,
    subtotalCents, taxCents, taxIncluded, tipCents, discountCents, totalCents, cashTenderedCents,
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
        JSON.stringify({ lines: sale.lines, subtotalCents: sale.subtotalCents, taxCents: sale.taxCents, taxIncluded: sale.taxIncluded, tipCents: sale.tipCents, discountCents: sale.discountCents, note: sale.note }),
        sale.totalCents, sale.cashTenderedCents, sale.currencyCode,
      ]
    );
    if (row) queued.push({ id: Number(row.id), idempotencyKey: sale.idempotencyKey, status: row.status });
    else {
      const { rows: [existing] } = await client.query(
        `SELECT * FROM store_hub_offline_sales WHERE restaurant_id = $1 AND idempotency_key = $2`,
        [restaurantId, sale.idempotencyKey]
      );
      if (!existing || Number(existing.hub_id)!==Number(hubId)
        || Number(existing.location_id)!==Number(hub.location_id)
        || String(existing.hub_sale_uuid)!==sale.hubSaleUuid
        || Number(existing.shift_id)!==sale.shiftId || Number(existing.total_cents)!==sale.totalCents
        || Number(existing.cash_tendered_cents)!==sale.cashTenderedCents
        || String(existing.currency_code).trim()!==sale.currencyCode
        || JSON.stringify((existing.payload?.lines||[]).map(l=>[l.menuItemId,l.quantity,l.unitPriceCents,l.name||null]))
          !==JSON.stringify(sale.lines.map(l=>[l.menuItemId,l.quantity,l.unitPriceCents,l.name||null]))
        || Number(existing.payload?.taxCents)!==sale.taxCents
        || Boolean(existing.payload?.taxIncluded)!==sale.taxIncluded
        || Number(existing.payload?.tipCents)!==sale.tipCents
        || Number(existing.payload?.discountCents)!==sale.discountCents
        || (existing.payload?.note||null)!==sale.note)
        throw new AppError('Offline sale identity was already used for a different sale',409,'hub_sale_idempotency_conflict');
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
      JSON.stringify({ offline_replay: true, hub_sale_uuid: sale.hub_sale_uuid, hub_id: sale.hub_id, taxCalculation: {mode: payload.taxIncluded ? 'inclusive' : 'exclusive', totalTaxCents: payload.taxCents}, note: payload.note || null }),
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
  const createdOrderItems = [];
  for (const line of lines) {
    const { rows: [orderItem] } = await client.query(
      `INSERT INTO food_order_items
         (order_id, menu_item_id, item_name, quantity,
          unit_price_cents, line_total_cents, kitchen_status)
       VALUES ($1,$2,$3,$4,$5,$6,'queued')
       RETURNING id`,
      [
        order.id, line.menuItemId,
        line.name || names.get(Number(line.menuItemId)) || 'Item',
        line.quantity, line.unitPriceCents, line.quantity * line.unitPriceCents,
      ]
    );
    createdOrderItems.push({
      id: Number(orderItem.id),
      menuItemId: Number(line.menuItemId),
      quantity: Number(line.quantity),
    });
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
  // Decrement inventory like the online POS path (reserve at order time,
  // consume at completion). The replayed order is created already paid and
  // completed, so reserve then consume immediately. Money fails closed: the
  // cash was tendered offline, so an inventory shortfall must NOT lose the
  // money record — the order and payment still post, and the shortfall is
  // flagged in replay_metadata for manager review.
  let inventoryShortfall = null;
  try {
    await reserveInventoryForOrder(client, {
      restaurantId: sale.restaurant_id,
      orderId: order.id,
      orderItems: createdOrderItems,
      locationId: sale.location_id,
    });
    await consumeInventoryForOrder(client, {
      restaurantId: sale.restaurant_id,
      orderId: order.id,
      locationId: sale.location_id,
      actorUserId,
    });
  } catch (error) {
    if (error && typeof error.code === 'string' && error.code.startsWith('inventory')) {
      inventoryShortfall = String(error.message || error.code).slice(0, 300);
    } else {
      throw error;
    }
  }
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
            replayed_at = NOW(), replay_error = NULL,
            replay_metadata = CASE WHEN $4::text IS NULL THEN replay_metadata
                                   ELSE jsonb_build_object('inventory_shortfall', $4::text) END,
            updated_at = NOW()
      WHERE id = $1`,
    [sale.id, order.id, paymentId, inventoryShortfall]
  );
  return {
    saleId: Number(sale.id), status: 'replayed',
    orderId: Number(order.id), paymentId: Number(paymentId),
    inventoryShortfall,
  };
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
      ORDER BY id ASC LIMIT 50
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

// Resolve a held or failed offline sale explicitly. Money fails closed:
//   - 'requeue' only flips the status back to 'queued'. The money is NOT
//     posted here; the next replay re-verifies the referenced shift is still
//     open at the same store before posting anything.
//   - 'void' abandons the sale (e.g. the cash was already counted in the
//     drawer close). The row is kept for the paper trail and the decision
//     must be audit-logged by the caller.
// Only 'held'/'failed' sales can be resolved; replayed/voided sales are
// immutable and queued sales need no resolution.
async function resolveOfflineSale(client, { restaurantId, hubId, saleId, action, note = null }) {
  const id = normalizeId(saleId, 'sale');
  if (!['requeue', 'void'].includes(action)) {
    throw new AppError("Action must be 'requeue' or 'void'", 400, 'validation_failed');
  }
  const cleanNote = String(note || '').trim().slice(0, 500) || null;
  const { rows: [sale] } = await client.query(
    `SELECT id, status, total_cents, cash_tendered_cents, shift_id
       FROM store_hub_offline_sales
      WHERE id = $1 AND restaurant_id = $2 AND hub_id = $3
      FOR UPDATE`,
    [id, restaurantId, hubId]
  );
  if (!sale) throw new AppError('Offline sale not found', 404, 'offline_sale_not_found');
  if (!['held', 'failed'].includes(sale.status)) {
    throw new AppError(
      `Only held or failed sales can be resolved (status: ${sale.status})`,
      409,
      'sale_not_resolvable'
    );
  }
  const nextStatus = action === 'requeue' ? 'queued' : 'voided';
  const resolutionNote = action === 'void'
    ? (cleanNote ? `Voided by manager: ${cleanNote}` : 'Voided by manager')
    : null;
  const { rows: [updated] } = await client.query(
    `UPDATE store_hub_offline_sales
        SET status = $2::text,
            replay_error = $3::text,
            replay_metadata = CASE WHEN $2::text = 'queued' THEN '{}'::jsonb
                                   ELSE replay_metadata || jsonb_build_object('void_note', $3::text) END,
            replayed_at = CASE WHEN $2::text = 'queued' THEN NULL ELSE replayed_at END,
            updated_at = NOW()
      WHERE id = $1
      RETURNING id, status, total_cents, cash_tendered_cents, shift_id`,
    [id, nextStatus, resolutionNote]
  );
  return {
    id: Number(updated.id),
    status: updated.status,
    totalCents: Number(updated.total_cents),
    cashTenderedCents: Number(updated.cash_tendered_cents),
    shiftId: updated.shift_id == null ? null : Number(updated.shift_id),
    action,
  };
}

async function listOfflineSales(client, { restaurantId, hubId, status = null, limit = 100 }) {
  await getHub(client, restaurantId, hubId);
  const { rows } = await client.query(
    `SELECT id, hub_sale_uuid, idempotency_key, shift_id, total_cents,
            cash_tendered_cents, currency_code, status, food_order_id,
            pos_payment_id, replay_error, replay_metadata, replayed_at, created_at
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
  resolveOfflineSale,
  listOfflineSales,
};
