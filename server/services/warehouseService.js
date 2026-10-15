'use strict';
const pool = require('../db');
const crypto = require('crypto');
const { logLogisticsAction } = require('./logisticsAuditService');
const { applyTransition } = require('./logisticsStateMachine');
const { registerLogisticsGuards } = require('./logisticsTransitionGuards');

// Load the funding/fulfillment gates (allocation release requires the
// buyer's final balance to be collected). Idempotent.
registerLogisticsGuards();

function svcError(message, status, code, details) {
  const err = new Error(message);
  err.status = status;
  err.statusCode = status;
  err.code = code;
  if (details !== undefined) err.details = details;
  return err;
}

// ─── Warehouses ───────────────────────────────────────────────

async function listWarehouses({ country, isActive = true, publicSafe = false } = {}) {
  const conditions = ['1=1'];
  const params = [];
  if (isActive !== null) { conditions.push(`w.is_active = $${params.push(isActive)}`); }
  if (country)           { conditions.push(`w.country = $${params.push(country)}`); }
  const warehouseFields = publicSafe
    ? `w.id, w.code, w.name, w.country, w.city, w.is_active, w.is_bonded`
    : 'w.*';
  const result = await pool.query(
    `SELECT ${warehouseFields},
            (SELECT COUNT(*) FROM inventory_receipts ir WHERE ir.warehouse_id = w.id AND ir.status NOT IN ('closed')) AS active_receipts
     FROM warehouses w
     WHERE ${conditions.join(' AND ')}
     ORDER BY w.name`,
    params
  );
  return result.rows;
}

async function createWarehouse(data, createdBy) {
  const { code, name, country, city, address, contact_name, contact_email, contact_phone, total_sqft, is_bonded, is_cold_storage, notes } = data;
  const result = await pool.query(
    `INSERT INTO warehouses (code,name,country,city,address,contact_name,contact_email,contact_phone,total_sqft,available_sqft,is_bonded,is_cold_storage,notes,created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9,$10,$11,$12,$13) RETURNING *`,
    [code,name,country,city,address,contact_name,contact_email,contact_phone,total_sqft,is_bonded||false,is_cold_storage||false,notes,createdBy]
  );
  return result.rows[0];
}

// ─── Inventory Receipts ───────────────────────────────────────

async function createInventoryReceipt(data, actorUserId) {
  const year = new Date().getFullYear();
  const reference = `IR-${year}-${crypto.randomBytes(8).toString('hex').toUpperCase()}`;

  const { shipment_id, purchase_order_id, pooled_order_id, warehouse_id, expected_qty, notes } = data;
  const result = await pool.query(
    `INSERT INTO inventory_receipts
       (reference,shipment_id,purchase_order_id,pooled_order_id,warehouse_id,expected_qty,notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [reference,shipment_id,purchase_order_id,pooled_order_id,warehouse_id,expected_qty,notes]
  );
  logLogisticsAction('inventory_receipt', result.rows[0].id, 'created', { actorUserId });
  return result.rows[0];
}

async function receiveInventory(id, { receivedQty, shortageQty, damagedQty, storageLocation, notes, actorUserId } = {}) {
  // Route the status change through the canonical inventory-receipt machine:
  // the current status is re-read with FOR UPDATE and the move to
  // receiving/discrepancy is validated atomically (previously the status was
  // written raw, so e.g. a closed receipt could be "received" again).
  const target = ((shortageQty || 0) > 0 || (damagedQty || 0) > 0) ? 'discrepancy' : 'receiving';
  const result = await applyTransition(pool, {
    entityType: 'inventory_receipt',
    id,
    to: target,
    actorUserId,
    set: {
      received_qty: receivedQty,
      shortage_qty: shortageQty || 0,
      damaged_qty: damagedQty || 0,
      storage_location: storageLocation ?? null,
      received_by: actorUserId,
      discrepancy_notes: notes ?? null,
    },
    nowColumns: ['received_at'],
  });
  if (!result.ok) {
    if (result.reason === 'not_found') {
      throw svcError('Inventory receipt not found', 404, 'inventory_receipt_not_found');
    }
    throw svcError(
      `Cannot receive inventory receipt from ${result.from || 'unknown'} state`,
      409,
      'invalid_transition',
      { from: result.from, to: target, allowed: result.allowed }
    );
  }
  logLogisticsAction('inventory_receipt', id, 'received', { actorUserId });
  return result.record;
}

async function reconcileReceipt(id, actorUserId, notes) {
  // Same enforcement: reconciling is only legal from receiving/discrepancy.
  const result = await applyTransition(pool, {
    entityType: 'inventory_receipt',
    id,
    to: 'reconciled',
    actorUserId,
    nowColumns: ['reconciled_at'],
    appendNotes: notes ? { column: 'discrepancy_notes', text: `\n${notes}` } : null,
  });
  if (!result.ok) {
    if (result.reason === 'not_found') {
      throw svcError('Inventory receipt not found', 404, 'inventory_receipt_not_found');
    }
    throw svcError(
      `Cannot reconcile inventory receipt from ${result.from || 'unknown'} state`,
      409,
      'invalid_transition',
      { from: result.from, to: 'reconciled', allowed: result.allowed }
    );
  }
  logLogisticsAction('inventory_receipt', id, 'reconciled', { actorUserId, notes });
  return result.record;
}

async function listInventoryReceipts({ warehouseId, status, limit = 50, offset = 0 } = {}) {
  const conditions = ['1=1'];
  const params = [];
  if (warehouseId) { conditions.push(`ir.warehouse_id = $${params.push(warehouseId)}`); }
  if (status)      { conditions.push(`ir.status = $${params.push(status)}`); }
  // Authoritative total for dashboard counts (additive; the row query is unchanged).
  const countRes = await pool.query(
    `SELECT COUNT(*) FROM inventory_receipts ir WHERE ${conditions.join(' AND ')}`,
    params
  );
  const result = await pool.query(
    `SELECT ir.*, w.name AS warehouse_name, w.country AS warehouse_country
     FROM inventory_receipts ir
     LEFT JOIN warehouses w ON w.id = ir.warehouse_id
     WHERE ${conditions.join(' AND ')}
     ORDER BY ir.created_at DESC
     LIMIT $${params.push(Math.min(limit,200))} OFFSET $${params.push(offset)}`,
    params
  );
  return { receipts: result.rows, total: parseInt(countRes.rows[0].count, 10) || 0 };
}

// ─── Allocations ──────────────────────────────────────────────

async function createAllocation(data, actorUserId) {
  const {
    inventory_receipt_id, pooled_order_id, participant_id,
    buyer_user_id, buyer_business_id, allocated_qty, release_method, notes,
  } = data;
  const result = await pool.query(
    `INSERT INTO inventory_allocations
       (inventory_receipt_id,pooled_order_id,participant_id,buyer_user_id,buyer_business_id,allocated_qty,release_method,notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [inventory_receipt_id,pooled_order_id,participant_id,buyer_user_id,buyer_business_id,allocated_qty,release_method||'warehouse_pickup',notes]
  );
  logLogisticsAction('inventory_allocation', result.rows[0].id, 'created', { actorUserId });
  return result.rows[0];
}

async function releaseAllocation(id, actorUserId) {
  // Route the release through the canonical inventory-allocation machine:
  // the current status is re-read with FOR UPDATE and the move to released
  // is validated atomically (previously the status was written raw).
  // A registered funding guard additionally requires the buyer's final
  // balance to be collected (final installment 'succeeded' on the linked
  // payment attempts); underfunded releases fail closed with a blocker.
  const result = await applyTransition(pool, {
    entityType: 'inventory_allocation',
    id,
    to: 'released',
    actorUserId,
    set: { released_by: actorUserId },
    nowColumns: ['released_at'],
  });
  if (!result.ok) {
    if (result.reason === 'not_found') {
      throw svcError('Inventory allocation not found', 404, 'inventory_allocation_not_found');
    }
    if (result.reason === 'guard_blocked') {
      throw svcError(
        result.blocker.message || 'Allocation release blocked by a funding gate',
        422,
        'transition_guard_blocked',
        { blocker: result.blocker, from: result.from, to: result.to }
      );
    }
    throw svcError(
      `Cannot release inventory allocation from ${result.from || 'unknown'} state`,
      409,
      'invalid_transition',
      { from: result.from, to: 'released', allowed: result.allowed }
    );
  }
  logLogisticsAction('inventory_allocation', id, 'released', { actorUserId });
  return result.record;
}

async function getAllocation(id, { userId = null, isAdmin = false } = {}) {
  // Ownership is enforced in the query (not just the route): non-staff
  // callers only match rows where they are the buyer, so cross-buyer reads
  // return null and surface as 404 without leaking existence.
  const conditions = ['ia.id = $1'];
  const params = [id];
  if (!isAdmin && userId != null) {
    conditions.push(`ia.buyer_user_id = $${params.push(userId)}`);
  }
  const result = await pool.query(
    `SELECT ia.*, ir.reference AS receipt_ref, w.name AS warehouse_name,
            u.first_name || ' ' || u.last_name AS buyer_name
     FROM inventory_allocations ia
     LEFT JOIN inventory_receipts ir ON ir.id = ia.inventory_receipt_id
     LEFT JOIN warehouses w ON w.id = ir.warehouse_id
     LEFT JOIN users u ON u.id = ia.buyer_user_id
     WHERE ${conditions.join(' AND ')}`,
    params
  );
  return result.rows[0] || null;
}

async function listAllocations({ warehouseId, status, pooledOrderId, buyerUserId, limit = 100 } = {}) {
  const conditions = ['1=1'];
  const params = [];
  if (warehouseId)   { conditions.push(`ir.warehouse_id = $${params.push(warehouseId)}`); }
  if (status)        { conditions.push(`ia.status = $${params.push(status)}`); }
  if (pooledOrderId) { conditions.push(`ia.pooled_order_id = $${params.push(pooledOrderId)}`); }
  if (buyerUserId)   { conditions.push(`ia.buyer_user_id = $${params.push(buyerUserId)}`); }

  // Authoritative total for dashboard counts (additive; the row query is unchanged).
  const countRes = await pool.query(
    `SELECT COUNT(*) FROM inventory_allocations ia
     LEFT JOIN inventory_receipts ir ON ir.id = ia.inventory_receipt_id
     WHERE ${conditions.join(' AND ')}`, params
  );
  const result = await pool.query(
    `SELECT ia.*, ir.reference AS receipt_ref, w.name AS warehouse_name,
            u.first_name || ' ' || u.last_name AS buyer_name
     FROM inventory_allocations ia
     LEFT JOIN inventory_receipts ir ON ir.id = ia.inventory_receipt_id
     LEFT JOIN warehouses w ON w.id = ir.warehouse_id
     LEFT JOIN users u ON u.id = ia.buyer_user_id
     WHERE ${conditions.join(' AND ')}
     ORDER BY ia.created_at DESC
     LIMIT $${params.push(Math.min(limit,500))}`,
    params
  );
  return { allocations: result.rows, total: parseInt(countRes.rows[0].count, 10) || 0 };
}

// ─── Delivery Orders ──────────────────────────────────────────

async function createDeliveryOrder(data, actorUserId) {
  const reference = `DO-${new Date().getFullYear()}-${crypto.randomBytes(8).toString('hex').toUpperCase()}`;
  const {
    allocation_id, shipment_id, recipient_user_id, recipient_name, recipient_phone,
    delivery_address, delivery_country, delivery_city, method, scheduled_date, delivery_notes,
  } = data;
  const result = await pool.query(
    `INSERT INTO delivery_orders
       (reference,allocation_id,shipment_id,recipient_user_id,recipient_name,recipient_phone,
        delivery_address,delivery_country,delivery_city,method,scheduled_date,delivery_notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
    [reference,allocation_id,shipment_id,recipient_user_id,recipient_name,recipient_phone,
     delivery_address,delivery_country,delivery_city,method||'local_pickup',scheduled_date,delivery_notes]
  );
  logLogisticsAction('delivery_order', result.rows[0].id, 'created', { actorUserId });
  return result.rows[0];
}

async function getDeliveryOrder(id, { userId = null, isAdmin = false } = {}) {
  // Ownership is enforced in the query (not just the route): non-staff
  // callers only match rows where they are the recipient, so cross-buyer
  // reads return null and surface as 404 without leaking existence.
  const conditions = ['d.id = $1'];
  const params = [id];
  if (!isAdmin && userId != null) {
    conditions.push(`d.recipient_user_id = $${params.push(userId)}`);
  }
  const result = await pool.query(
    `SELECT d.*,
            u.first_name || ' ' || u.last_name AS recipient_name_full
     FROM delivery_orders d
     LEFT JOIN users u ON u.id = d.recipient_user_id
     WHERE ${conditions.join(' AND ')}`,
    params
  );
  return result.rows[0] || null;
}

async function transitionDeliveryOrder(id, toStatus, actorUserId, {
  notes, carrier, trackingNumber, assignedTo,
} = {}) {
  // Route every delivery status change through the canonical delivery-order
  // machine (previously no server path changed delivery status at all).
  const set = {};
  if (carrier !== undefined)       set.carrier = carrier;
  if (trackingNumber !== undefined) set.tracking_number = trackingNumber;
  if (assignedTo !== undefined)     set.assigned_to = assignedTo;
  const nowColumns = [];
  if (toStatus === 'delivered') nowColumns.push('delivered_at');

  const result = await applyTransition(pool, {
    entityType: 'delivery_order',
    id,
    to: toStatus,
    actorUserId,
    set,
    nowColumns,
    appendNotes: notes ? { column: 'delivery_notes', text: `\n${notes}` } : null,
  });
  if (!result.ok) {
    if (result.reason === 'not_found') {
      throw svcError('Delivery order not found', 404, 'delivery_order_not_found');
    }
    throw svcError(
      `Cannot transition delivery order from ${result.from || 'unknown'} to ${toStatus}`,
      409,
      'invalid_transition',
      { from: result.from, to: toStatus, allowed: result.allowed }
    );
  }
  logLogisticsAction('delivery_order', id, `status_to_${toStatus}`, {
    actorUserId,
    beforeState: { status: result.from },
    afterState: { status: toStatus },
    notes,
  });
  return result.record;
}

module.exports = {
  listWarehouses, createWarehouse,
  createInventoryReceipt, receiveInventory, reconcileReceipt, listInventoryReceipts,
  createAllocation, releaseAllocation, listAllocations, getAllocation,
  createDeliveryOrder, getDeliveryOrder, transitionDeliveryOrder,
};
