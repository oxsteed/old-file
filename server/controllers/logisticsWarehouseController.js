'use strict';
const AppError = require('../utils/AppError');
const warehouseService = require('../services/warehouseService');

// ─── Warehouses ───────────────────────────────────────────────

exports.listWarehouses = async (req, res, next) => {
  try {
    const warehouses = await warehouseService.listWarehouses({ country: req.query.country });
    res.json({ success: true, data: warehouses });
  } catch (err) { next(err); }
};

exports.createWarehouse = async (req, res, next) => {
  try {
    const { code, name, country } = req.body;
    if (!code || !name || !country) {
      return next(new AppError('code, name, country required', 400, 'validation_failed'));
    }
    const warehouse = await warehouseService.createWarehouse(req.body, req.user.id);
    res.status(201).json({ success: true, data: warehouse });
  } catch (err) {
    if (err.code === '23505') return next(new AppError('Warehouse code already exists', 409, 'duplicate_code'));
    next(err);
  }
};

// ─── Inventory Receipts ───────────────────────────────────────

exports.listReceipts = async (req, res, next) => {
  try {
    const receipts = await warehouseService.listInventoryReceipts({
      warehouseId: req.query.warehouse_id,
      status:      req.query.status,
      limit:       parseInt(req.query.limit)||50,
      offset:      parseInt(req.query.offset)||0,
    });
    res.json({ success: true, data: receipts });
  } catch (err) { next(err); }
};

exports.createReceipt = async (req, res, next) => {
  try {
    const { warehouse_id, expected_qty } = req.body;
    if (!warehouse_id || !expected_qty) {
      return next(new AppError('warehouse_id and expected_qty required', 400, 'validation_failed'));
    }
    const receipt = await warehouseService.createInventoryReceipt(req.body, req.user.id);
    res.status(201).json({ success: true, data: receipt });
  } catch (err) { next(err); }
};

exports.receiveInventory = async (req, res, next) => {
  try {
    const { received_qty, shortage_qty, damaged_qty, storage_location, notes } = req.body;
    if (received_qty === undefined) {
      return next(new AppError('received_qty required', 400, 'validation_failed'));
    }
    const receipt = await warehouseService.receiveInventory(req.params.id, {
      receivedQty: received_qty,
      shortageQty: shortage_qty||0,
      damagedQty:  damaged_qty||0,
      storageLocation: storage_location,
      notes,
      actorUserId: req.user.id,
    });
    res.json({ success: true, data: receipt });
  } catch (err) { next(err); }
};

exports.reconcileReceipt = async (req, res, next) => {
  try {
    const receipt = await warehouseService.reconcileReceipt(req.params.id, req.user.id, req.body.notes);
    res.json({ success: true, data: receipt });
  } catch (err) { next(err); }
};

// ─── Allocations ──────────────────────────────────────────────

exports.listAllocations = async (req, res, next) => {
  try {
    const buyerUserId = req.isAdmin ? (req.query.buyer_user_id || null) : req.user.id;
    const allocations = await warehouseService.listAllocations({
      warehouseId:   req.query.warehouse_id,
      status:        req.query.status,
      pooledOrderId: req.query.pooled_order_id,
      buyerUserId,
    });
    res.json({ success: true, data: allocations });
  } catch (err) { next(err); }
};

exports.createAllocation = async (req, res, next) => {
  try {
    const { inventory_receipt_id, allocated_qty } = req.body;
    if (!inventory_receipt_id || !allocated_qty) {
      return next(new AppError('inventory_receipt_id and allocated_qty required', 400, 'validation_failed'));
    }
    const allocation = await warehouseService.createAllocation(req.body, req.user.id);
    res.status(201).json({ success: true, data: allocation });
  } catch (err) { next(err); }
};

exports.releaseAllocation = async (req, res, next) => {
  try {
    const allocation = await warehouseService.releaseAllocation(req.params.id, req.user.id);
    res.json({ success: true, data: allocation });
  } catch (err) { next(err); }
};

// ─── Delivery Orders ──────────────────────────────────────────

exports.listDeliveryOrders = async (req, res, next) => {
  try {
    const pool = require('../db');
    const recipientUserId = req.isAdmin ? (req.query.recipient_user_id || null) : req.user.id;
    const conditions = ['1=1'];
    const params = [];
    if (recipientUserId) { conditions.push(`d.recipient_user_id = $${params.push(recipientUserId)}`); }
    if (req.query.status) { conditions.push(`d.status = $${params.push(req.query.status)}`); }

    const result = await pool.query(
      `SELECT d.*,
              u.first_name || ' ' || u.last_name AS recipient_name_full
       FROM delivery_orders d
       LEFT JOIN users u ON u.id = d.recipient_user_id
       WHERE ${conditions.join(' AND ')}
       ORDER BY d.created_at DESC
       LIMIT 100`,
      params
    );
    res.json({ success: true, data: result.rows });
  } catch (err) { next(err); }
};

exports.createDeliveryOrder = async (req, res, next) => {
  try {
    const pool = require('../db');
    const year = new Date().getFullYear();
    const countRes = await pool.query('SELECT COUNT(*) FROM delivery_orders');
    const seq = String(parseInt(countRes.rows[0].count) + 1).padStart(5, '0');
    const reference = `DO-${year}-${seq}`;

    const { allocation_id, shipment_id, recipient_user_id, recipient_name, recipient_phone,
            delivery_address, delivery_country, delivery_city, method, scheduled_date, delivery_notes } = req.body;
    const result = await pool.query(
      `INSERT INTO delivery_orders
         (reference,allocation_id,shipment_id,recipient_user_id,recipient_name,recipient_phone,
          delivery_address,delivery_country,delivery_city,method,scheduled_date,delivery_notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [reference,allocation_id,shipment_id,recipient_user_id,recipient_name,recipient_phone,
       delivery_address,delivery_country,delivery_city,method||'local_pickup',scheduled_date,delivery_notes]
    );
    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (err) { next(err); }
};
