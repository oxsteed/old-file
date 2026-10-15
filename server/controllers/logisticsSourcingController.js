'use strict';
const AppError = require('../utils/appError');
const sourcingService = require('../services/sourcingService');
const supplierService = require('../services/supplierService');
const { buildActionContext } = require('../middleware/requireLogisticsAccess');
const { getAvailableActions } = require('../services/logisticsStateMachine');

// ─── Sourcing Requests ────────────────────────────────────────

exports.createRequest = async (req, res, next) => {
  try {
    const { title, category } = req.body;
    if (!title || !category) {
      return next(new AppError('title and category are required', 400, 'validation_failed'));
    }
    const request = await sourcingService.createSourcingRequest(req.body, req.user.id);
    res.status(201).json({ success: true, data: request });
  } catch (err) { next(err); }
};

exports.listRequests = async (req, res, next) => {
  try {
    const { status, lane_id, limit = 50, offset = 0 } = req.query;
    // Non-admins only see their own requests
    const userId = req.isAdmin ? (req.query.user_id || null) : req.user.id;
    const result = await sourcingService.listSourcingRequests({
      userId,
      status,
      laneId: lane_id,
      limit: parseInt(limit),
      offset: parseInt(offset),
    });
    res.json({ success: true, ...result });
  } catch (err) { next(err); }
};

exports.getRequest = async (req, res, next) => {
  try {
    const request = await sourcingService.getSourcingRequest(req.params.id);
    if (!request) return next(new AppError('Sourcing request not found', 404, 'not_found'));
    // Only owner, assigned operator, or admin can view
    if (!req.isAdmin && request.user_id !== req.user.id) {
      return next(new AppError('Not authorized', 403, 'forbidden'));
    }
    // Advisory, additive: which status transitions the viewer may perform
    // and why the rest are unavailable. Mutations re-check server-side.
    const actionCtx = await buildActionContext(req, { ownerId: request.user_id });
    const availableActions = getAvailableActions('sourcing_request', request.status, actionCtx);
    res.json({ success: true, data: request, availableActions });
  } catch (err) { next(err); }
};

exports.updateStatus = async (req, res, next) => {
  try {
    const { status, notes } = req.body;
    if (!status) return next(new AppError('status is required', 400, 'validation_failed'));
    const request = await sourcingService.updateSourcingRequestStatus(
      req.params.id, status, req.user.id, notes
    );
    res.json({ success: true, data: request });
  } catch (err) {
    // The canonical sourcing-request machine rejects illegal jumps with a
    // 409 (carrying from/to/allowed) instead of a raw PG enum error.
    if (err.code === 'invalid_transition') {
      return next(new AppError(err.message, 409, 'invalid_transition', err.details));
    }
    next(err);
  }
};

exports.assignOperator = async (req, res, next) => {
  try {
    const { operator_user_id } = req.body;
    if (!operator_user_id) return next(new AppError('operator_user_id required', 400, 'validation_failed'));
    const request = await sourcingService.assignOperator(req.params.id, operator_user_id, req.user.id);
    res.json({ success: true, data: request });
  } catch (err) { next(err); }
};

// ─── Quotes ───────────────────────────────────────────────────

exports.createQuote = async (req, res, next) => {
  try {
    const { supplier_id, qty_quoted, unit_price_usd } = req.body;
    if (!supplier_id || !qty_quoted || !unit_price_usd) {
      return next(new AppError('supplier_id, qty_quoted, unit_price_usd required', 400, 'validation_failed'));
    }
    req.body.sourcing_request_id = req.body.sourcing_request_id || req.params.requestId;
    const quote = await sourcingService.createQuote(req.body, req.user.id);
    res.status(201).json({ success: true, data: quote });
  } catch (err) { next(err); }
};

exports.reviewQuote = async (req, res, next) => {
  try {
    const { status, notes } = req.body;
    if (!status) return next(new AppError('status is required', 400, 'validation_failed'));
    // Target-state validation is enforced by the canonical supplier-quote
    // machine in the service (checks the current state, not just the target).
    const quote = await sourcingService.reviewQuote(req.params.quoteId, status, req.user.id, notes);
    res.json({ success: true, data: quote });
  } catch (err) {
    if (err.code === 'invalid_transition') {
      return next(new AppError(err.message, 409, 'invalid_transition', err.details));
    }
    next(err);
  }
};

// ─── Suppliers (public-facing listing for sourcing context) ───

exports.listSuppliers = async (req, res, next) => {
  try {
    // Non-admins see only approved + active
    const result = await supplierService.listSuppliers({
      country:   req.query.country,
      category:  req.query.category,
      isActive:  true,
      isApproved:true,
      publicSafe: !req.isAdmin,
      limit:     Math.min(parseInt(req.query.limit)||50, 200),
      offset:    parseInt(req.query.offset)||0,
    });
    res.json({ success: true, ...result });
  } catch (err) { next(err); }
};

exports.getSupplierProduct = async (req, res, next) => {
  try {
    const product = await supplierService.getSupplierProduct(req.params.id);
    if (!product) return next(new AppError('Product not found', 404, 'not_found'));
    res.json({ success: true, data: product });
  } catch (err) { next(err); }
};
