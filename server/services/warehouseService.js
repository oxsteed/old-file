'use strict';
const pool = require('../db');
const crypto = require('crypto');
const { logLogisticsAction } = require('./logisticsAuditService');

// ─── Warehouses ───────────────────────────────────────────────

async function listWarehouses({ country, isActive = true } = {}) {
  const conditions = ['1=1'];
  const params = [];
  if (isActive !== null) { conditions.push(`w.is_active = $${params.push(isActive)}`); }
  if (country)           { conditions.push(`w.country = $${params.push(country)}`); }
  const result = await pool.query(
    `SELECT w.*,
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
  const result = await pool.query(
    `UPDATE inventory_receipts
     SET received_qty = $1, shortage_qty = $2, damaged_qty = $3,
         storage_location = $4, received_by = $5, received_at = NOW(),
         status = CASE WHEN ($2 > 0 OR $3 > 0) THEN 'discrepancy' ELSE 'receiving' END,
         discrepancy_notes = $6
     WHERE id = $7 RETURNING *`,
    [receivedQty, shortageQty||0, damagedQty||0, storageLocation, actorUserId, notes, id]
  );
  logLogisticsAction('inventory_receipt', id, 'received', { actorUserId });
  return result.rows[0];
}

async function reconcileReceipt(id, actorUserId, notes) {
  const result = await pool.query(
    `UPDATE inventory_receipts SET status = 'reconciled', reconciled_at = NOW(),
     discrepancy_notes = COALESCE(discrepancy_notes,'') || $1
     WHERE id = $2 RETURNING *`,
    [notes ? `\n${notes}` : '', id]
  );
  logLogisticsAction('inventory_receipt', id, 'reconciled', { actorUserId, notes });
  return result.rows[0];
}

async function listInventoryReceipts({ warehouseId, status, limit = 50, offset = 0 } = {}) {
  const conditions = ['1=1'];
  const params = [];
  if (warehouseId) { conditions.push(`ir.warehouse_id = $${params.push(warehouseId)}`); }
  if (status)      { conditions.push(`ir.status = $${params.push(status)}`); }
  const result = await pool.query(
    `SELECT ir.*, w.name AS warehouse_name, w.country AS warehouse_country
     FROM inventory_receipts ir
     LEFT JOIN warehouses w ON w.id = ir.warehouse_id
     WHERE ${conditions.join(' AND ')}
     ORDER BY ir.created_at DESC
     LIMIT $${params.push(Math.min(limit,200))} OFFSET $${params.push(offset)}`,
    params
  );
  return result.rows;
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
  const result = await pool.query(
    `UPDATE inventory_allocations SET status = 'released', released_by = $1, released_at = NOW()
     WHERE id = $2 RETURNING *`,
    [actorUserId, id]
  );
  logLogisticsAction('inventory_allocation', id, 'released', { actorUserId });
  return result.rows[0];
}

async function listAllocations({ warehouseId, status, pooledOrderId, buyerUserId, limit = 100 } = {}) {
  const conditions = ['1=1'];
  const params = [];
  if (warehouseId)   { conditions.push(`ir.warehouse_id = $${params.push(warehouseId)}`); }
  if (status)        { conditions.push(`ia.status = $${params.push(status)}`); }
  if (pooledOrderId) { conditions.push(`ia.pooled_order_id = $${params.push(pooledOrderId)}`); }
  if (buyerUserId)   { conditions.push(`ia.buyer_user_id = $${params.push(buyerUserId)}`); }

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
  return result.rows;
}

module.exports = {
  listWarehouses, createWarehouse,
  createInventoryReceipt, receiveInventory, reconcileReceipt, listInventoryReceipts,
  createAllocation, releaseAllocation, listAllocations,
};
