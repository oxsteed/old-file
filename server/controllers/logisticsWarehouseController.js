'use strict';
const AppError = require('../utils/appError');
const warehouseService = require('../services/warehouseService');
const { buildActionContext } = require('../middleware/requireLogisticsAccess');
const { getAvailableActions, getCapability } = require('../services/logisticsStateMachine');

/**
 * Staff with warehouse.manage (or admins) see all records; everyone else is
 * scoped to their own buyer/recipient records. requireLogisticsCapability
 * attaches the resolved model as req.logisticsCapabilities on the customer
 * routes; the admin router does not run it, so fall back to req.isAdmin
 * there (preserving its existing behavior exactly).
 */
function canSeeAllWarehouse(req) {
  if (req.isAdmin) return true;
  return !!getCapability(req.logisticsCapabilities, 'warehouse.manage');
}

// ─── Warehouses ───────────────────────────────────────────────

exports.listWarehouses = async (req, res, next) => {
  try {
    const warehouses = await warehouseService.listWarehouses({
      country: req.query.country,
      publicSafe: !req.isAdmin,
    });
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
    const result = await warehouseService.listInventoryReceipts({
      warehouseId: req.query.warehouse_id,
      status:      req.query.status,
      limit:       Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200),
      offset:      Math.min(Math.max(parseInt(req.query.offset, 10) || 0, 0), 1_000_000),
    });
    // `total` is additive: existing consumers keep reading `data`.
    res.json({ success: true, data: result.receipts, total: result.total });
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
  } catch (err) {
    // The canonical receipt machine rejects illegal receives (e.g. receiving
    // a closed receipt) with a 409 carrying from/to/allowed.
    if (err.code === 'invalid_transition') {
      return next(new AppError(err.message, 409, 'invalid_transition', err.details));
    }
    next(err);
  }
};

exports.reconcileReceipt = async (req, res, next) => {
  try {
    const receipt = await warehouseService.reconcileReceipt(req.params.id, req.user.id, req.body.notes);
    res.json({ success: true, data: receipt });
  } catch (err) {
    if (err.code === 'invalid_transition') {
      return next(new AppError(err.message, 409, 'invalid_transition', err.details));
    }
    next(err);
  }
};

// ─── Allocations ──────────────────────────────────────────────

exports.listAllocations = async (req, res, next) => {
  try {
    // Non-staff callers only ever see their own buyer records; staff with
    // warehouse.manage (or admins) may optionally filter by buyer_user_id.
    const seeAll = canSeeAllWarehouse(req);
    const buyerUserId = seeAll ? (req.query.buyer_user_id || null) : req.user.id;
    const result = await warehouseService.listAllocations({
      warehouseId:   req.query.warehouse_id,
      status:        req.query.status,
      pooledOrderId: req.query.pooled_order_id,
      buyerUserId,
    });
    // `total` is additive: existing consumers keep reading `data`.
    res.json({ success: true, data: result.allocations, total: result.total });
  } catch (err) { next(err); }
};

exports.getAllocation = async (req, res, next) => {
  try {
    // Ownership enforced in the query: a buyer asking for someone else's
    // allocation gets a 404, never a 403 that would confirm it exists.
    const allocation = await warehouseService.getAllocation(req.params.id, {
      userId: req.user.id,
      isAdmin: canSeeAllWarehouse(req),
    });
    if (!allocation) return next(new AppError('Allocation not found', 404, 'not_found'));
    res.json({ success: true, data: allocation });
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
    // Non-staff callers only ever see their own recipient records; staff
    // with warehouse.manage (or admins) may optionally filter by recipient.
    const seeAll = canSeeAllWarehouse(req);
    const recipientUserId = seeAll ? (req.query.recipient_user_id || null) : req.user.id;
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
    // Authoritative total for dashboard counts (additive; `data` is unchanged).
    const countRes = await pool.query(
      `SELECT COUNT(*) FROM delivery_orders d WHERE ${conditions.join(' AND ')}`,
      params
    );
    res.json({ success: true, data: result.rows, total: parseInt(countRes.rows[0].count, 10) || 0 });
  } catch (err) { next(err); }
};

exports.createDeliveryOrder = async (req, res, next) => {
  try {
    const delivery = await warehouseService.createDeliveryOrder(req.body, req.user.id);
    res.status(201).json({ success: true, data: delivery });
  } catch (err) { next(err); }
};

exports.getDeliveryOrder = async (req, res, next) => {
  try {
    // Ownership enforced in the query: a buyer asking for someone else's
    // delivery gets a 404, never a 403 that would confirm it exists.
    const delivery = await warehouseService.getDeliveryOrder(req.params.id, {
      userId: req.user.id,
      isAdmin: canSeeAllWarehouse(req),
    });
    if (!delivery) return next(new AppError('Delivery order not found', 404, 'not_found'));
    // Advisory, additive: which status transitions the viewer may perform
    // and why the rest are unavailable. Mutations re-check server-side.
    const actionCtx = await buildActionContext(req);
    const availableActions = getAvailableActions('delivery_order', delivery.status, actionCtx);
    res.json({ success: true, data: delivery, availableActions });
  } catch (err) { next(err); }
};

exports.updateDeliveryStatus = async (req, res, next) => {
  try {
    const { status, notes, carrier, tracking_number, assigned_to } = req.body;
    if (!status) return next(new AppError('status is required', 400, 'validation_failed'));
    const delivery = await warehouseService.transitionDeliveryOrder(
      req.params.id, status, req.user.id,
      { notes, carrier, trackingNumber: tracking_number, assignedTo: assigned_to }
    );
    res.json({ success: true, data: delivery });
  } catch (err) {
    // The canonical delivery machine rejects illegal jumps (e.g. delivering
    // a pending order that was never assigned) with a 409.
    if (err.code === 'invalid_transition') {
      return next(new AppError(err.message, 409, 'invalid_transition', err.details));
    }
    next(err);
  }
};
