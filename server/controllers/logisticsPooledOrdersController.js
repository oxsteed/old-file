'use strict';
const AppError = require('../utils/appError');
const pooledOrderService = require('../services/pooledOrderService');
const { resolveLogisticsRole } = require('../middleware/requireLogisticsAccess');
const pool = require('../db');

// Map service-layer error codes to HTTP errors. Unknown errors propagate
// unchanged to the shared error handler.
const APPROVAL_ERROR_MAP = {
  lane_not_found:               [400, 'validation_failed'],
  lane_access_denied:           [403, 'lane_access_denied'],
  business_verification_required: [403, 'business_verification_required'],
  not_business_member:          [403, 'forbidden'],
  pooled_order_not_found:       [404, 'not_found'],
  not_owner:                    [403, 'forbidden'],
  self_approval:                [403, 'self_approval'],
  campaign_not_draft:           [409, 'campaign_not_draft'],
  campaign_not_pending_review:  [409, 'campaign_not_pending_review'],
  approval_blockers:            [422, 'approval_blockers'],
  review_reason_required:       [400, 'validation_failed'],
  invalid_review_decision:      [400, 'validation_failed'],
  invalid_transition:           [409, 'invalid_transition'],
};

function toHttpError(err) {
  const mapped = APPROVAL_ERROR_MAP[err.code];
  if (mapped) {
    const httpErr = new AppError(err.message, mapped[0], mapped[1]);
    if (err.details !== undefined) httpErr.fields = err.details;
    return httpErr;
  }
  if (err.code === 'illegal_state_transition') {
    return new AppError(`Illegal state transition: ${err.from} → ${err.to}`, 409, 'illegal_state_transition');
  }
  return null;
}

function viewerCountry(req) {
  return req.user?.country || req.user?.location_country || req.headers['x-buyer-country'] || null;
}

// Shared page/limit/offset parsing for the paginated campaign listings.
function parsePagination(req) {
  const { limit, offset, page } = req.query;
  const paginated = page !== undefined || limit !== undefined;
  const pageSize = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
  const explicitOffset = parseInt(offset, 10) || 0;
  const pageNum = page !== undefined
    ? Math.max(parseInt(page, 10) || 1, 1)
    : Math.floor(explicitOffset / pageSize) + 1;
  const queryOffset = page !== undefined ? (pageNum - 1) * pageSize : explicitOffset;
  return { paginated, pageSize, pageNum, queryOffset };
}

// Legacy shape when no pagination params are passed; paginated envelope when
// `page`/`limit` are present. Additive only: nothing removed or renamed.
function campaignListEnvelope(result, { paginated, pageSize, pageNum }) {
  if (paginated) {
    return {
      success: true,
      data: result.orders,
      pagination: {
        page: pageNum,
        limit: pageSize,
        total: result.total,
        totalPages: Math.ceil(result.total / pageSize),
      },
      orders: result.orders,
      total: result.total,
    };
  }
  return { success: true, ...result };
}

exports.listPooledOrders = async (req, res, next) => {
  try {
    const { status, lane, lane_id, open, search } = req.query;

    // Phase 1 searchable browsing: `page`/`limit` opt into the paginated
    // envelope. Without them the legacy shape is returned unchanged.
    // `lane` is the documented filter name; `lane_id` stays as an alias.
    const { paginated, pageSize, pageNum, queryOffset } = parsePagination(req);

    const result = await pooledOrderService.listPooledOrders({
      status: status || undefined,
      laneId: parseLaneId(lane !== undefined && lane !== '' ? lane : lane_id),
      search: typeof search === 'string' && search.trim() ? search.trim() : null,
      open:         open === 'true' ? true : null,
      publicSafe:   !req.isAdmin,
      // Public visibility: the public board never enumerates drafts. Only
      // platform admins see drafts here; organizers list their own (including
      // drafts) through the scoped GET /organizer/campaigns endpoint.
      excludeDrafts: !req.isAdmin,
      limit:        pageSize,
      offset:       queryOffset,
    });

    res.json(campaignListEnvelope(result, { paginated, pageSize, pageNum }));
  } catch (err) { next(err); }
};

// Organizer-scoped listing (Phase 2): returns only the authenticated
// organizer's own campaigns, including drafts. Drafts are never visible
// through the public /campaigns endpoint.
exports.listOrganizerCampaigns = async (req, res, next) => {
  try {
    const { status, search } = req.query;
    const { paginated, pageSize, pageNum, queryOffset } = parsePagination(req);

    const result = await pooledOrderService.listOrganizerCampaigns(req.user.id, {
      status: status || undefined,
      search: typeof search === 'string' && search.trim() ? search.trim() : null,
      limit:  pageSize,
      offset: queryOffset,
    });

    res.json(campaignListEnvelope(result, { paginated, pageSize, pageNum }));
  } catch (err) { next(err); }
};

// lane_id is an integer FK; ignore (rather than 500 on) non-numeric input.
function parseLaneId(value) {
  if (value === undefined || value === null || value === '') return undefined;
  const n = parseInt(value, 10);
  return Number.isFinite(n) ? n : undefined;
}

exports.getPooledOrder = async (req, res, next) => {
  try {
    const order = await pooledOrderService.getPooledOrder(req.params.id, {
      viewerUserId: req.user?.id || null,
      includePrivate: Boolean(req.isAdmin),
    });
    if (!order) return next(new AppError('Pooled order not found', 404, 'not_found'));
    // Draft visibility: only approved campaigns are public. Drafts and
    // in-review campaigns are visible to their organizer and to Operations
    // staff / admins. Everyone else gets 404 so draft existence is not leaked.
    const approvalState = order.approval_state || 'draft';
    const isOwner = Boolean(req.user && String(order.organizer_user_id) === String(req.user.id));
    const logisticsRole = req.user ? await resolveLogisticsRole(req.user) : null;
    const isOps = req.isAdmin || pooledOrderService.REVIEW_OPS_ROLES.includes(logisticsRole);
    if (approvalState !== 'approved' && !isOwner && !isOps) {
      return next(new AppError('Pooled order not found', 404, 'not_found'));
    }
    // Server-derived capabilities: available actions and submission blockers
    // for the organizer, plus the approval history for organizers and staff.
    if (isOwner || isOps) {
      order.available_actions = await pooledOrderService.describeActions(order, {
        isOwner, isOps, isAdmin: Boolean(req.isAdmin),
        userId: req.user?.id || null,
        userCountry: viewerCountry(req),
        userRole: logisticsRole,
      });
      order.approval_history = await pooledOrderService.getApprovalHistory(order.id);
    }
    res.json({ success: true, data: order });
  } catch (err) { next(err); }
};

exports.createPooledOrder = async (req, res, next) => {
  try {
    const { title, lane_id, target_moq } = req.body;
    if (!title || !lane_id || !target_moq) {
      return next(new AppError('title, lane_id, target_moq are required', 400, 'validation_failed'));
    }
    const logisticsRole = await resolveLogisticsRole(req.user);
    const order = await pooledOrderService.createPooledOrder(req.body, req.user.id, {
      userCountry: viewerCountry(req),
      userRole: logisticsRole,
    });
    res.status(201).json({ success: true, data: order });
  } catch (err) { next(toHttpError(err) || err); }
};

// Organizer submits their draft for Operations review. Blockers (422 with
// details.blockers) tell the UI exactly what is missing.
exports.submitForReview = async (req, res, next) => {
  try {
    const logisticsRole = await resolveLogisticsRole(req.user);
    const order = await pooledOrderService.submitCampaignForReview(req.params.id, req.user.id, {
      userCountry: viewerCountry(req),
      userRole: logisticsRole,
    });
    res.json({ success: true, data: order });
  } catch (err) { next(toHttpError(err) || err); }
};

// Operations review: approve (publishes) or request revisions (with reason).
// Route-level requireLogisticsRole ensures only Operations staff reach here;
// the service additionally forbids self-review.
exports.reviewCampaign = async (req, res, next) => {
  try {
    const { decision, reason } = req.body;
    const order = await pooledOrderService.reviewCampaign(req.params.id, req.user.id, { decision, reason });
    res.json({ success: true, data: order });
  } catch (err) { next(toHttpError(err) || err); }
};

// Approval history for one campaign. Organizer, Operations staff, and admins
// only; everyone else gets 404 so draft existence is not leaked.
exports.getApprovalHistory = async (req, res, next) => {
  try {
    const row = await pool.query(
      'SELECT id, organizer_user_id, approval_state FROM pooled_orders WHERE id = $1',
      [req.params.id]
    );
    const order = row.rows[0];
    if (!order) return next(new AppError('Pooled order not found', 404, 'not_found'));
    const isOwner = String(order.organizer_user_id) === String(req.user.id);
    const logisticsRole = await resolveLogisticsRole(req.user);
    const isOps = req.isAdmin || pooledOrderService.REVIEW_OPS_ROLES.includes(logisticsRole);
    if (!isOwner && !isOps && (order.approval_state || 'draft') !== 'approved') {
      return next(new AppError('Pooled order not found', 404, 'not_found'));
    }
    if (!isOwner && !isOps) {
      return next(new AppError('Forbidden', 403, 'forbidden'));
    }
    const history = await pooledOrderService.getApprovalHistory(order.id);
    res.json({ success: true, data: history });
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
  } catch (err) { next(toHttpError(err) || err); }
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
