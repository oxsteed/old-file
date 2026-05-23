'use strict';
const AppError = require('../utils/AppError');
const poService = require('../services/purchaseOrderService');
const { calculateLandedCost } = require('../services/logisticsPricingService');

exports.listPurchaseOrders = async (req, res, next) => {
  try {
    const { status, lane_id, supplier_id, limit = 50, offset = 0 } = req.query;
    const buyerUserId = req.isAdmin ? (req.query.buyer_user_id || null) : req.user.id;
    const result = await poService.listPurchaseOrders({
      status, laneId: lane_id, supplierId: supplier_id,
      buyerUserId,
      limit:  Math.min(parseInt(limit)||50, 200),
      offset: parseInt(offset)||0,
    });
    res.json({ success: true, ...result });
  } catch (err) { next(err); }
};

exports.getPurchaseOrder = async (req, res, next) => {
  try {
    const order = await poService.getPurchaseOrder(req.params.id);
    if (!order) return next(new AppError('Purchase order not found', 404, 'not_found'));
    if (!req.isAdmin && order.buyer_user_id !== req.user.id) {
      return next(new AppError('Not authorized', 403, 'forbidden'));
    }
    res.json({ success: true, data: order });
  } catch (err) { next(err); }
};

exports.createPurchaseOrder = async (req, res, next) => {
  try {
    const { supplier_id, lane_id, qty_ordered, unit_cost_usd } = req.body;
    if (!supplier_id || !lane_id || !qty_ordered || !unit_cost_usd) {
      return next(new AppError('supplier_id, lane_id, qty_ordered, unit_cost_usd required', 400, 'validation_failed'));
    }
    const order = await poService.createPurchaseOrder(req.body, req.user.id);
    res.status(201).json({ success: true, data: order });
  } catch (err) { next(err); }
};

exports.transitionStatus = async (req, res, next) => {
  try {
    const { status, notes } = req.body;
    const order = await poService.transitionStatus(req.params.id, status, req.user.id, { notes, approvedBy: req.user.id });
    res.json({ success: true, data: order });
  } catch (err) {
    if (err.code === 'invalid_transition') return next(new AppError(err.message, 409, 'invalid_transition'));
    next(err);
  }
};

exports.previewLandedCost = async (req, res, next) => {
  try {
    const { unit_product_cost_usd, qty, lane_id, freight_est_usd, is_pooled } = req.body;
    if (!unit_product_cost_usd || !qty || !lane_id) {
      return next(new AppError('unit_product_cost_usd, qty, lane_id required', 400, 'validation_failed'));
    }
    const result = await calculateLandedCost({
      unitProductCostUSD: parseFloat(unit_product_cost_usd),
      qty: parseInt(qty),
      laneId: parseInt(lane_id),
      freightEstUSD: freight_est_usd ? parseFloat(freight_est_usd) : 0,
      isPooled: is_pooled === true || is_pooled === 'true',
    });
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
};
