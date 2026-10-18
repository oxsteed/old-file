'use strict';

// Phase 1 of the restaurant credit protection system: dispute resolution for
// customer wallet load requests the restaurant cancelled after receiving
// off-platform payment.
//
// Money-safety rule for this whole module: a dispute resolution NEVER moves
// money. 'resolved_release' only re-queues the original load request to
// 'pending' so the restaurant can re-review it through the normal
// maker-checker approval path; credit still posts only via
// approveCustomerWalletLoadRequest.

const pool = require('../db');
const { AppError } = require('../middleware/errorHandler');
const { withTransaction } = require('../utils/transaction');
const { logFoodWalletOperatorAudit } = require('../services/foodWalletAuditService');
// Canonical restaurant access gate (analytics scope model, Phase 1 Item 6).
// Replaces the former local requireRestaurantAccess copy: same ownership
// CASE, same 404, plus the union of columns the variants selected.
const { resolveRestaurantAccess: requireRestaurantAccess } = require('../services/scopeModel');

const DISPUTE_WINDOW_MS = 48 * 60 * 60 * 1000; // 48 hours
const RESOLVE_OUTCOMES = new Set(['resolved_release', 'resolved_deny', 'resolved_info_needed']);
const TERMINAL_DISPUTE_STATUSES = new Set(['resolved_release', 'resolved_deny', 'resolved_info_needed']);
const MAX_REQUEUED_EXPIRES_MS = 48 * 60 * 60 * 1000;

function normalizeString(value, max = 255) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function parsePositiveInt(value, fallback = null) {
  const n = Number.parseInt(String(value), 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function normalizeEvidence(value) {
  if (value === undefined || value === null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new AppError('Validation failed', 400, 'validation_failed', {
      evidence: 'Evidence must be a JSON object',
    });
  }
  return value;
}

function formatCreditDispute(row) {
  if (!row) return null;
  return {
    id: String(row.id),
    loadRequestId: String(row.load_request_id),
    customerId: row.customer_id,
    restaurantId: String(row.restaurant_id),
    restaurantName: row.restaurant_name || null,
    reason: row.reason,
    customerEvidence: row.customer_evidence || {},
    restaurantEvidence: row.restaurant_evidence || {},
    status: row.status,
    openedAt: row.opened_at,
    resolvedAt: row.resolved_at || null,
    resolvedBy: row.resolved_by || null,
    resolutionNote: row.resolution_note || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const WALLET_OPERATOR_ROLES = new Set(['owner', 'manager']);

function assertWalletOperator(restaurant) {
  if (!WALLET_OPERATOR_ROLES.has(restaurant.effective_role)) {
    throw new AppError('Owner or manager access required', 403, 'forbidden');
  }
}

// ── Customer ────────────────────────────────────────────────────────────────

exports.createDispute = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    const requestId = parsePositiveInt(req.params.requestId);
    if (!restaurantId || !requestId) {
      throw new AppError('Wallet load request not found', 404, 'wallet_load_request_not_found');
    }
    const reason = normalizeString(req.body?.reason, 500);
    if (!reason) {
      throw new AppError('Validation failed', 400, 'validation_failed', {
        reason: 'A dispute reason is required',
      });
    }
    const evidence = normalizeEvidence(req.body?.evidence);

    const dispute = await withTransaction(pool, async (client) => {
      const { rows: [requestRow] } = await client.query(
        `SELECT *
           FROM food_customer_wallet_load_requests
          WHERE id = $1
            AND restaurant_id = $2
          FOR UPDATE`,
        [requestId, restaurantId]
      );
      if (!requestRow) {
        throw new AppError('Wallet load request not found', 404, 'wallet_load_request_not_found');
      }
      // Fail closed: a customer must never learn about (or dispute) a request
      // that is not theirs, so ownership is a 404, not a 403.
      if (String(requestRow.customer_id) !== String(req.user.id)) {
        throw new AppError('Wallet load request not found', 404, 'wallet_load_request_not_found');
      }
      if (requestRow.status !== 'cancelled') {
        throw new AppError(
          'Only cancelled load requests can be disputed',
          409,
          'credit_dispute_load_not_cancelled',
          { status: requestRow.status }
        );
      }
      if (!requestRow.cancelled_at || new Date(requestRow.cancelled_at).getTime() < Date.now() - DISPUTE_WINDOW_MS) {
        throw new AppError(
          'The dispute window for this load request has closed',
          409,
          'credit_dispute_window_expired'
        );
      }

      const { rows: [existing] } = await client.query(
        `SELECT id FROM food_credit_disputes WHERE load_request_id = $1`,
        [requestRow.id]
      );
      if (existing) {
        throw new AppError('A dispute already exists for this load request', 409, 'credit_dispute_already_exists');
      }

      let inserted;
      try {
        const { rows } = await client.query(
          `INSERT INTO food_credit_disputes
             (load_request_id, customer_id, restaurant_id, reason, customer_evidence)
           VALUES ($1, $2, $3, $4, $5::jsonb)
           RETURNING *`,
          [requestRow.id, requestRow.customer_id, restaurantId, reason, JSON.stringify(evidence)]
        );
        inserted = rows[0];
      } catch (err) {
        if (err.code === '23505') {
          throw new AppError('A dispute already exists for this load request', 409, 'credit_dispute_already_exists');
        }
        throw err;
      }

      await logFoodWalletOperatorAudit(client, {
        restaurantId,
        businessId: requestRow.business_id || null,
        walletAccountId: null,
        customerId: requestRow.customer_id,
        operatorUserId: req.user.id,
        actionType: 'dispute_opened',
        amountCents: Number(requestRow.amount_cents || 0),
        currencyCode: requestRow.currency_code,
        correlationId: requestRow.correlation_id,
        requestIp: req.ip || null,
        metadata: {
          disputeId: String(inserted.id),
          loadRequestId: String(requestRow.id),
          reason,
        },
      });

      return inserted;
    }, 'food_credit_dispute_open');

    res.status(201).json({ dispute: formatCreditDispute(dispute) });
  } catch (err) {
    next(err);
  }
};

exports.listMyDisputes = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    if (!restaurantId) throw new AppError('Restaurant not found', 404, 'restaurant_not_found');
    const { rows } = await pool.query(
      `SELECT d.*, fr.display_name AS restaurant_name
         FROM food_credit_disputes d
         JOIN food_restaurants fr ON fr.id = d.restaurant_id
        WHERE d.restaurant_id = $1 AND d.customer_id = $2
        ORDER BY d.opened_at DESC
        LIMIT 100`,
      [restaurantId, req.user.id]
    );
    res.json({ disputes: rows.map(formatCreditDispute) });
  } catch (err) {
    next(err);
  }
};

// ── Merchant ────────────────────────────────────────────────────────────────

exports.listMerchantDisputes = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    if (!restaurantId) throw new AppError('Restaurant not found', 404, 'restaurant_not_found');
    const restaurant = await requireRestaurantAccess(req.user.id, restaurantId);
    assertWalletOperator(restaurant);
    const status = req.query.status ? normalizeString(req.query.status, 30) : null;
    const params = [restaurantId];
    let statusClause = '';
    if (status) {
      if (!['open', 'under_review', 'resolved_release', 'resolved_deny', 'resolved_info_needed'].includes(status)) {
        throw new AppError('Validation failed', 400, 'validation_failed', {
          status: 'Status must be one of open, under_review, resolved_release, resolved_deny, resolved_info_needed',
        });
      }
      params.push(status);
      statusClause = 'AND d.status = $2';
    }
    const { rows } = await pool.query(
      `SELECT d.*, fr.display_name AS restaurant_name
         FROM food_credit_disputes d
         JOIN food_restaurants fr ON fr.id = d.restaurant_id
        WHERE d.restaurant_id = $1 ${statusClause}
        ORDER BY d.opened_at DESC
        LIMIT 100`,
      params
    );
    res.json({ disputes: rows.map(formatCreditDispute) });
  } catch (err) {
    next(err);
  }
};

exports.respondToDispute = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    const disputeId = parsePositiveInt(req.params.disputeId);
    if (!restaurantId || !disputeId) {
      throw new AppError('Dispute not found', 404, 'credit_dispute_not_found');
    }
    const restaurant = await requireRestaurantAccess(req.user.id, restaurantId);
    assertWalletOperator(restaurant);
    const evidence = normalizeEvidence(req.body?.evidence);

    const dispute = await withTransaction(pool, async (client) => {
      const { rows: [disputeRow] } = await client.query(
        `SELECT *
           FROM food_credit_disputes
          WHERE id = $1 AND restaurant_id = $2
          FOR UPDATE`,
        [disputeId, restaurantId]
      );
      if (!disputeRow) {
        throw new AppError('Dispute not found', 404, 'credit_dispute_not_found');
      }
      if (TERMINAL_DISPUTE_STATUSES.has(disputeRow.status)) {
        throw new AppError('This dispute has already been resolved', 409, 'credit_dispute_already_resolved', {
          status: disputeRow.status,
        });
      }

      const { rows: [updated] } = await client.query(
        `UPDATE food_credit_disputes
            SET restaurant_evidence = COALESCE(restaurant_evidence, '{}'::jsonb) || $2::jsonb,
                status = 'under_review'
          WHERE id = $1
          RETURNING *`,
        [disputeRow.id, JSON.stringify(evidence)]
      );

      await logFoodWalletOperatorAudit(client, {
        restaurantId,
        businessId: restaurant.business_id,
        walletAccountId: null,
        customerId: disputeRow.customer_id,
        operatorUserId: req.user.id,
        actionType: 'dispute_responded',
        amountCents: null,
        currencyCode: null,
        correlationId: null,
        requestIp: req.ip || null,
        metadata: {
          disputeId: String(disputeRow.id),
          loadRequestId: String(disputeRow.load_request_id),
        },
      });

      return updated;
    }, 'food_credit_dispute_respond');

    res.json({ dispute: formatCreditDispute(dispute) });
  } catch (err) {
    next(err);
  }
};

// ── Admin ───────────────────────────────────────────────────────────────────

exports.resolveDispute = async (req, res, next) => {
  try {
    const disputeId = parsePositiveInt(req.params.disputeId);
    if (!disputeId) throw new AppError('Dispute not found', 404, 'credit_dispute_not_found');
    const outcome = normalizeString(req.body?.outcome, 30);
    if (!RESOLVE_OUTCOMES.has(outcome)) {
      throw new AppError('Validation failed', 400, 'validation_failed', {
        outcome: 'Outcome must be one of resolved_release, resolved_deny, resolved_info_needed',
      });
    }
    const resolutionNote = normalizeString(req.body?.resolution_note || req.body?.resolutionNote, 1000);

    const result = await withTransaction(pool, async (client) => {
      const { rows: [disputeRow] } = await client.query(
        `SELECT *
           FROM food_credit_disputes
          WHERE id = $1
          FOR UPDATE`,
        [disputeId]
      );
      if (!disputeRow) {
        throw new AppError('Dispute not found', 404, 'credit_dispute_not_found');
      }
      if (TERMINAL_DISPUTE_STATUSES.has(disputeRow.status)) {
        throw new AppError('This dispute has already been resolved', 409, 'credit_dispute_already_resolved', {
          status: disputeRow.status,
        });
      }

      const { rows: [updated] } = await client.query(
        `UPDATE food_credit_disputes
            SET status = $2,
                resolved_at = NOW(),
                resolved_by = $3,
                resolution_note = $4
          WHERE id = $1
          RETURNING *`,
        [disputeRow.id, outcome, req.user.id, resolutionNote]
      );

      let requeuedRequest = null;
      if (outcome === 'resolved_release') {
        // Fail-closed re-queue: the original load request goes back to
        // 'pending' for restaurant re-review. No credit is posted here and
        // no approval is granted; money moves only if a restaurant operator
        // later approves through the normal maker-checker path.
        const requeuedExpiresAt = new Date(Date.now() + MAX_REQUEUED_EXPIRES_MS);
        const { rows: [requestRow] } = await client.query(
          `UPDATE food_customer_wallet_load_requests
              SET status = 'pending',
                  approved_by_user_id = NULL,
                  approved_at = NULL,
                  cancelled_by_user_id = NULL,
                  cancelled_at = NULL,
                  expires_at = CASE
                    WHEN expires_at IS NULL OR expires_at < NOW() THEN $2
                    ELSE expires_at
                  END,
                  metadata = COALESCE(metadata, '{}'::jsonb) || $3::jsonb
            WHERE id = $1 AND status = 'cancelled'
            RETURNING *`,
          [
            disputeRow.load_request_id,
            requeuedExpiresAt.toISOString(),
            JSON.stringify({ disputeRequeue: true, disputeId: String(disputeRow.id) }),
          ]
        );
        if (!requestRow) {
          throw new AppError(
            'The disputed load request is no longer cancelled and cannot be re-queued',
            409,
            'credit_dispute_requeue_unavailable'
          );
        }
        requeuedRequest = requestRow;
      }

      await logFoodWalletOperatorAudit(client, {
        restaurantId: Number(disputeRow.restaurant_id),
        businessId: null,
        walletAccountId: null,
        customerId: disputeRow.customer_id,
        operatorUserId: req.user.id,
        actionType: 'dispute_resolved',
        amountCents: null,
        currencyCode: null,
        correlationId: null,
        requestIp: req.ip || null,
        metadata: {
          disputeId: String(disputeRow.id),
          loadRequestId: String(disputeRow.load_request_id),
          outcome,
          requeued: Boolean(requeuedRequest),
        },
      });

      return { dispute: updated, requeuedRequest };
    }, 'food_credit_dispute_resolve');

    res.json({
      dispute: formatCreditDispute(result.dispute),
      requeued: Boolean(result.requeuedRequest),
      requeuedLoadRequestStatus: result.requeuedRequest ? result.requeuedRequest.status : null,
    });
  } catch (err) {
    next(err);
  }
};
