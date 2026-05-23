'use strict';
const AppError = require('../utils/AppError');
const pooledOrderService = require('../services/pooledOrderService');
const pool = require('../db');

exports.listPooledOrders = async (req, res, next) => {
  try {
    const { status, lane_id, open, limit = 20, offset = 0 } = req.query;
    const result = await pooledOrderService.listPooledOrders({
      status,
      laneId:       lane_id,
      open:         open === 'true' ? true : null,
      limit:        Math.min(parseInt(limit)||20, 100),
      offset:       parseInt(offset)||0,
    });
    res.json({ success: true, ...result });
  } catch (err) { next(err); }
};

exports.getPooledOrder = async (req, res, next) => {
  try {
    const order = await pooledOrderService.getPooledOrder(req.params.id);
    if (!order) return next(new AppError('Pooled order not found', 404, 'not_found'));
    res.json({ success: true, data: order });
  } catch (err) { next(err); }
};

exports.createPooledOrder = async (req, res, next) => {
  try {
    const { title, lane_id, target_moq } = req.body;
    if (!title || !lane_id || !target_moq) {
      return next(new AppError('title, lane_id, target_moq are required', 400, 'validation_failed'));
    }
    const order = await pooledOrderService.createPooledOrder(req.body, req.user.id);
    res.status(201).json({ success: true, data: order });
  } catch (err) { next(err); }
};

exports.joinPooledOrder = async (req, res, next) => {
  try {
    const { committed_qty, destination_country, destination_address, delivery_preference } = req.body;
    if (!committed_qty || committed_qty < 1) {
      return next(new AppError('committed_qty must be >= 1', 400, 'validation_failed'));
    }
    const participant = await pooledOrderService.joinPooledOrder(
      req.params.id,
      req.user.id,
      {
        committedQty: committed_qty,
        businessId: req.body.business_id,
        destinationCountry: destination_country,
        destinationAddress: destination_address,
        deliveryPreference: delivery_preference,
      }
    );
    res.json({ success: true, data: participant });
  } catch (err) {
    if (err.message === 'pooled_order_not_found') return next(new AppError('Not found', 404, 'not_found'));
    if (err.message === 'pooled_order_not_open')  return next(new AppError('Order is not open for pledging', 409, 'order_not_open'));
    if (err.message === 'pooled_order_closed')    return next(new AppError('Order close date has passed', 409, 'order_closed'));
    next(err);
  }
};

exports.updateStatus = async (req, res, next) => {
  try {
    const { status, notes } = req.body;
    const VALID = ['draft','open','pledging','deposit_phase','locked','placed','in_transit','receiving','distributing','completed','cancelled','refunding'];
    if (!VALID.includes(status)) {
      return next(new AppError('Invalid status', 400, 'validation_failed'));
    }
    const order = await pooledOrderService.updatePooledOrderStatus(req.params.id, status, req.user.id, notes);
    res.json({ success: true, data: order });
  } catch (err) { next(err); }
};

exports.getMyParticipation = async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT pp.*, po.title AS order_title, po.status AS order_status,
              po.target_moq, po.current_committed_qty,
              po.close_date, po.unit_landed_cost_usd,
              ll.name AS lane_name, ll.origin_country, ll.destination_country,
              ROUND(po.current_committed_qty::numeric / NULLIF(po.target_moq,0) * 100) AS moq_pct
       FROM pooled_order_participants pp
       JOIN pooled_orders po ON po.id = pp.pooled_order_id
       LEFT JOIN logistics_lanes ll ON ll.id = po.lane_id
       WHERE pp.user_id = $1
       ORDER BY pp.created_at DESC`,
      [req.user.id]
    );
    res.json({ success: true, data: result.rows });
  } catch (err) { next(err); }
};
