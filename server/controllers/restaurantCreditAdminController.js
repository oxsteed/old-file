'use strict';

const pool = require('../db');
const { AppError } = require('../middleware/errorHandler');
const { withTransaction } = require('../utils/transaction');
const { logAdminAction } = require('../services/auditService');
const { logFoodWalletOperatorAudit } = require('../services/foodWalletAuditService');
const {
  creditFoodWallet,
} = require('../services/foodWalletService');
const {
  releaseWalletHold,
  formatHold,
  formatTransfer,
  formatLedgerRow,
} = require('../services/foodWalletOperationsService');

const MAX_PAGE_SIZE = 100;
const MAX_DETAIL_ROWS = 100;

function normalizeString(value, max = 255) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function parsePositiveInt(value, fallback = null, max = Number.MAX_SAFE_INTEGER) {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, max);
}

function parseUuid(value, fieldName) {
  const normalized = normalizeString(value, 80);
  if (!normalized || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(normalized)) {
    throw new AppError(`Invalid ${fieldName}`, 400, `invalid_${fieldName}`);
  }
  return normalized;
}

function parseDate(value, fieldName) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new AppError('Validation failed', 400, 'validation_failed', {
      [fieldName]: 'Must be a valid ISO date',
    });
  }
  return date;
}

function formatMoneyCents(value) {
  return Number(value || 0);
}

function formatLoadRequest(row) {
  if (!row) return null;
  return {
    id: String(row.id),
    restaurantId: String(row.restaurant_id),
    restaurantName: row.restaurant_name || null,
    businessId: row.business_id ? String(row.business_id) : null,
    customerId: row.customer_id || null,
    customerName: row.customer_name || null,
    customerEmail: row.customer_email || null,
    requestedByUserId: row.requested_by_user_id || null,
    requestedByName: row.requested_by_name || null,
    approvedByUserId: row.approved_by_user_id || null,
    amountCents: formatMoneyCents(row.amount_cents),
    currencyCode: row.currency_code || 'USD',
    status: row.status,
    note: row.note || null,
    referenceId: row.reference_id || null,
    correlationId: row.correlation_id || null,
    metadata: row.metadata || {},
    approvedAt: row.approved_at || null,
    cancelledAt: row.cancelled_at || null,
    expiresAt: row.expires_at || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function formatWallet(row) {
  if (!row) return null;
  const balanceCents = formatMoneyCents(row.balance_cents);
  const reservedCents = formatMoneyCents(row.reserved_cents);
  return {
    accountId: String(row.account_id || row.id),
    restaurantId: String(row.restaurant_id),
    restaurantName: row.restaurant_name || null,
    restaurantStatus: row.restaurant_status || null,
    customerId: row.customer_id || null,
    customerName: row.customer_name || null,
    customerEmail: row.customer_email || null,
    currencyCode: row.currency_code || 'USD',
    status: row.status,
    balanceCents,
    reservedCents,
    availableBalanceCents: Math.max(0, balanceCents - reservedCents),
    ledgerVersion: Number(row.ledger_version || 0),
    lastEntryHash: row.last_entry_hash || null,
    lastPostedAt: row.last_posted_at || null,
    updatedAt: row.updated_at || null,
    lastActivityAt: row.last_activity_at || row.updated_at || null,
    lastEntryType: row.last_entry_type || null,
    lastEntryDescription: row.last_entry_description || null,
    pendingLoadRequestCount: Number(row.pending_load_request_count || 0),
    activeHoldCount: Number(row.active_hold_count || 0),
  };
}

function buildWalletFilters(query = {}) {
  const params = [];
  const filters = [];
  const search = normalizeString(query.q || query.search, 120);
  const restaurantId = parsePositiveInt(query.restaurantId || query.restaurant_id);
  const status = normalizeString(query.status, 20);
  const from = parseDate(query.from, 'from');
  const to = parseDate(query.to, 'to');

  if (search) {
    params.push(`%${search}%`);
    const placeholder = `$${params.length}`;
    filters.push(`(
      fr.display_name ILIKE ${placeholder}
      OR COALESCE(NULLIF(TRIM(u.first_name || ' ' || u.last_name), ''), u.email) ILIKE ${placeholder}
      OR u.email ILIKE ${placeholder}
      OR a.customer_id::text ILIKE ${placeholder}
    )`);
  }
  if (restaurantId) {
    params.push(restaurantId);
    filters.push(`a.restaurant_id = $${params.length}`);
  }
  if (status) {
    if (!['active', 'suspended', 'closed'].includes(status)) {
      throw new AppError('Validation failed', 400, 'validation_failed', {
        status: 'Status must be active, suspended, or closed',
      });
    }
    params.push(status);
    filters.push(`a.status = $${params.length}`);
  }
  if (from) {
    params.push(from.toISOString());
    filters.push(`a.updated_at >= $${params.length}`);
  }
  if (to) {
    params.push(to.toISOString());
    filters.push(`a.updated_at <= $${params.length}`);
  }

  return {
    params,
    where: filters.length ? filters.join('\n          AND ') : 'TRUE',
    values: {
      search,
      restaurantId,
      status: status || null,
      from: from?.toISOString() || null,
      to: to?.toISOString() || null,
    },
  };
}

function adminAction(req, action, targetType, targetId, description, before, after) {
  return logAdminAction({
    adminId: req.user.id,
    action,
    targetType,
    targetId,
    description,
    before,
    after,
    req,
  });
}

exports.getOverview = async (req, res, next) => {
  try {
    const page = parsePositiveInt(req.query.page, 1, 100000);
    const pageSize = parsePositiveInt(req.query.pageSize || req.query.limit, 25, MAX_PAGE_SIZE);
    const offset = (page - 1) * pageSize;
    const filters = buildWalletFilters(req.query);
    const limitPlaceholder = filters.params.length + 1;
    const offsetPlaceholder = filters.params.length + 2;

    const [summaryResult, countResult, walletsResult, requestSummaryResult, holdSummaryResult, activityResult, requestsResult, restaurantsResult, currencyBreakdownResult] = await Promise.all([
      pool.query(
        `SELECT COUNT(*)::int AS total_wallets,
                COUNT(DISTINCT a.restaurant_id)::int AS total_restaurants,
                COUNT(*) FILTER (WHERE a.status = 'active')::int AS active_wallets,
                COUNT(*) FILTER (WHERE a.status = 'suspended')::int AS suspended_wallets,
                COUNT(*) FILTER (WHERE a.status = 'closed')::int AS closed_wallets,
                COUNT(DISTINCT a.currency_code)::int AS currency_count,
                COALESCE(SUM(a.balance_cents), 0)::bigint AS total_balance_cents,
                COALESCE(SUM(a.reserved_cents), 0)::bigint AS total_reserved_cents,
                COALESCE(SUM(GREATEST(0, a.balance_cents - a.reserved_cents)), 0)::bigint AS total_available_cents
           FROM food_customer_wallet_accounts a
           JOIN food_restaurants fr ON fr.id = a.restaurant_id
           JOIN users u ON u.id = a.customer_id
          WHERE ${filters.where}`,
        filters.params
      ),
      pool.query(
        `SELECT COUNT(*)::int AS total
           FROM food_customer_wallet_accounts a
           JOIN food_restaurants fr ON fr.id = a.restaurant_id
           JOIN users u ON u.id = a.customer_id
          WHERE ${filters.where}`,
        filters.params
      ),
      pool.query(
        `SELECT a.id AS account_id, a.restaurant_id, fr.display_name AS restaurant_name,
                fr.status AS restaurant_status, a.customer_id, a.currency_code, a.balance_cents,
                a.reserved_cents, a.status, a.ledger_version, a.last_entry_hash,
                a.last_posted_at, a.updated_at,
                COALESCE(NULLIF(TRIM(u.first_name || ' ' || u.last_name), ''), u.email) AS customer_name,
                u.email AS customer_email,
                (SELECT MAX(l.created_at) FROM food_customer_wallet_ledger l WHERE l.account_id = a.id) AS last_activity_at,
                (SELECT l.entry_type FROM food_customer_wallet_ledger l WHERE l.account_id = a.id ORDER BY l.created_at DESC, l.id DESC LIMIT 1) AS last_entry_type,
                (SELECT l.description FROM food_customer_wallet_ledger l WHERE l.account_id = a.id ORDER BY l.created_at DESC, l.id DESC LIMIT 1) AS last_entry_description,
                (SELECT COUNT(*) FROM food_customer_wallet_load_requests r WHERE r.customer_id = a.customer_id AND r.restaurant_id = a.restaurant_id AND r.status = 'pending')::int AS pending_load_request_count,
                (SELECT COUNT(*) FROM food_customer_wallet_holds h WHERE h.account_id = a.id AND h.status = 'active')::int AS active_hold_count
           FROM food_customer_wallet_accounts a
           JOIN food_restaurants fr ON fr.id = a.restaurant_id
           JOIN users u ON u.id = a.customer_id
          WHERE ${filters.where}
          ORDER BY a.updated_at DESC, a.id DESC
          LIMIT $${limitPlaceholder} OFFSET $${offsetPlaceholder}`,
        [...filters.params, pageSize, offset]
      ),
      pool.query(
        `SELECT COUNT(*) FILTER (WHERE r.status = 'pending')::int AS pending_count,
                COUNT(*) FILTER (WHERE r.status = 'approved')::int AS approved_count,
                COUNT(*) FILTER (WHERE r.status = 'cancelled')::int AS cancelled_count,
                COUNT(*) FILTER (WHERE r.status = 'expired')::int AS expired_count,
                COALESCE(SUM(r.amount_cents) FILTER (WHERE r.status = 'pending'), 0)::bigint AS pending_amount_cents
           FROM food_customer_wallet_load_requests r
           JOIN food_customer_wallet_accounts a ON a.restaurant_id = r.restaurant_id AND a.customer_id = r.customer_id
           JOIN food_restaurants fr ON fr.id = r.restaurant_id
           JOIN users u ON u.id = r.customer_id
          WHERE ${filters.where}`,
        filters.params
      ),
      pool.query(
        `SELECT COUNT(*) FILTER (WHERE h.status = 'active')::int AS active_count,
                COUNT(*) FILTER (WHERE h.status = 'captured')::int AS captured_count,
                COUNT(*) FILTER (WHERE h.status = 'released')::int AS released_count,
                COUNT(*) FILTER (WHERE h.status = 'expired')::int AS expired_count,
                COALESCE(SUM(h.amount_cents) FILTER (WHERE h.status = 'active'), 0)::bigint AS active_amount_cents
           FROM food_customer_wallet_holds h
           JOIN food_customer_wallet_accounts a ON a.id = h.account_id
           JOIN food_restaurants fr ON fr.id = a.restaurant_id
           JOIN users u ON u.id = a.customer_id
          WHERE ${filters.where}`,
        filters.params
      ),
      pool.query(
        `SELECT l.id, l.account_id, l.restaurant_id, fr.display_name AS restaurant_name,
                l.customer_id, COALESCE(NULLIF(TRIM(u.first_name || ' ' || u.last_name), ''), u.email) AS customer_name,
                u.email AS customer_email, l.entry_type, l.amount_cents, l.balance_after_cents,
                l.currency_code, l.description, l.reference_type, l.reference_id, l.created_at,
                l.actor_type, l.correlation_id, l.hash_algorithm, l.entry_hash
           FROM food_customer_wallet_ledger l
           JOIN food_customer_wallet_accounts a ON a.id = l.account_id
           JOIN food_restaurants fr ON fr.id = l.restaurant_id
           JOIN users u ON u.id = l.customer_id
          WHERE ${filters.where}
          ORDER BY l.created_at DESC, l.id DESC
          LIMIT ${MAX_DETAIL_ROWS}`,
        filters.params
      ),
      pool.query(
        `SELECT r.*, fr.display_name AS restaurant_name,
                COALESCE(NULLIF(TRIM(u.first_name || ' ' || u.last_name), ''), u.email) AS customer_name,
                u.email AS customer_email,
                COALESCE(NULLIF(TRIM(requester.first_name || ' ' || requester.last_name), ''), requester.email) AS requested_by_name
           FROM food_customer_wallet_load_requests r
           JOIN food_customer_wallet_accounts a ON a.restaurant_id = r.restaurant_id AND a.customer_id = r.customer_id
           JOIN food_restaurants fr ON fr.id = r.restaurant_id
           JOIN users u ON u.id = r.customer_id
           LEFT JOIN users requester ON requester.id = r.requested_by_user_id
          WHERE r.status = 'pending'
            AND ${filters.where}
          ORDER BY r.created_at ASC, r.id ASC
          LIMIT ${MAX_DETAIL_ROWS}`,
        filters.params
      ),
      pool.query(
        `SELECT fr.id, fr.display_name AS name, fr.currency_code,
                COUNT(a.id)::int AS wallet_count,
                COUNT(a.id) FILTER (WHERE a.status = 'active')::int AS active_wallet_count
           FROM food_restaurants fr
           LEFT JOIN food_customer_wallet_accounts a ON a.restaurant_id = fr.id
          GROUP BY fr.id, fr.display_name, fr.currency_code
          ORDER BY fr.display_name ASC, fr.id ASC`
      ),
      // T37-F01: per-currency balance breakdown so finance can inspect each
      // currency's aggregate liability instead of an unqualified mixed total.
      pool.query(
        `SELECT UPPER(a.currency_code) AS currency,
                COUNT(*)::int AS wallet_count,
                COALESCE(SUM(a.balance_cents), 0)::bigint AS balance_cents,
                COALESCE(SUM(a.reserved_cents), 0)::bigint AS reserved_cents,
                COALESCE(SUM(GREATEST(0, a.balance_cents - a.reserved_cents)), 0)::bigint AS available_cents
           FROM food_customer_wallet_accounts a
           JOIN food_restaurants fr ON fr.id = a.restaurant_id
           JOIN users u ON u.id = a.customer_id
          WHERE ${filters.where}
          GROUP BY UPPER(a.currency_code)
          ORDER BY UPPER(a.currency_code) ASC`,
        filters.params
      ),
    ]);

    const summary = summaryResult.rows[0] || {};
    const requestSummary = requestSummaryResult.rows[0] || {};
    const holdSummary = holdSummaryResult.rows[0] || {};
    const currencyBreakdown = (currencyBreakdownResult.rows || []).map(r => ({
      currency: r.currency,
      walletCount: Number(r.wallet_count || 0),
      balanceCents: formatMoneyCents(r.balance_cents),
      reservedCents: formatMoneyCents(r.reserved_cents),
      availableCents: formatMoneyCents(r.available_cents),
    }));
    const total = Number(countResult.rows[0]?.total || 0);

    res.json({
      generatedAt: new Date().toISOString(),
      filters: filters.values,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / pageSize)),
      },
      summary: {
        totalWallets: Number(summary.total_wallets || 0),
        totalRestaurants: Number(summary.total_restaurants || 0),
        activeWallets: Number(summary.active_wallets || 0),
        suspendedWallets: Number(summary.suspended_wallets || 0),
        closedWallets: Number(summary.closed_wallets || 0),
        totalBalanceCents: formatMoneyCents(summary.total_balance_cents),
        totalReservedCents: formatMoneyCents(summary.total_reserved_cents),
        totalAvailableCents: formatMoneyCents(summary.total_available_cents),
        currencyCount: Number(summary.currency_count || 0),
        // T37-F01: grouped native balances per currency. The scalar totals
        // above are unqualified when currencyCount > 1; prefer this breakdown.
        currencyBreakdown,
        pendingLoadRequests: Number(requestSummary.pending_count || 0),
        pendingLoadAmountCents: formatMoneyCents(requestSummary.pending_amount_cents),
        activeHolds: Number(holdSummary.active_count || 0),
        activeHoldAmountCents: formatMoneyCents(holdSummary.active_amount_cents),
      },
      requestSummary: {
        pending: Number(requestSummary.pending_count || 0),
        approved: Number(requestSummary.approved_count || 0),
        cancelled: Number(requestSummary.cancelled_count || 0),
        expired: Number(requestSummary.expired_count || 0),
      },
      holdSummary: {
        active: Number(holdSummary.active_count || 0),
        captured: Number(holdSummary.captured_count || 0),
        released: Number(holdSummary.released_count || 0),
        expired: Number(holdSummary.expired_count || 0),
      },
      wallets: walletsResult.rows.map(formatWallet),
      pendingRequests: requestsResult.rows.map(formatLoadRequest),
      recentActivity: activityResult.rows.map(formatLedgerRow),
      restaurants: restaurantsResult.rows.map((row) => ({
        id: String(row.id),
        name: row.name,
        currencyCode: row.currency_code || 'USD',
        walletCount: Number(row.wallet_count || 0),
        activeWalletCount: Number(row.active_wallet_count || 0),
      })),
    });
  } catch (err) {
    next(err);
  }
};

exports.getWalletDetail = async (req, res, next) => {
  try {
    const accountId = parsePositiveInt(req.params.accountId);
    if (!accountId) throw new AppError('Wallet not found', 404, 'wallet_not_found');

    const { rows } = await pool.query(
      `SELECT a.id AS account_id, a.restaurant_id, fr.display_name AS restaurant_name,
              fr.status AS restaurant_status, a.customer_id, a.currency_code, a.balance_cents,
              a.reserved_cents, a.status, a.ledger_version, a.last_entry_hash,
              a.last_posted_at, a.updated_at,
              COALESCE(NULLIF(TRIM(u.first_name || ' ' || u.last_name), ''), u.email) AS customer_name,
              u.email AS customer_email,
              (SELECT MAX(l.created_at) FROM food_customer_wallet_ledger l WHERE l.account_id = a.id) AS last_activity_at,
              (SELECT COUNT(*) FROM food_customer_wallet_load_requests r WHERE r.customer_id = a.customer_id AND r.restaurant_id = a.restaurant_id AND r.status = 'pending')::int AS pending_load_request_count,
              (SELECT COUNT(*) FROM food_customer_wallet_holds h WHERE h.account_id = a.id AND h.status = 'active')::int AS active_hold_count
         FROM food_customer_wallet_accounts a
         JOIN food_restaurants fr ON fr.id = a.restaurant_id
         JOIN users u ON u.id = a.customer_id
        WHERE a.id = $1
        LIMIT 1`,
      [accountId]
    );
    const account = rows[0];
    if (!account) throw new AppError('Wallet not found', 404, 'wallet_not_found');

    const [ledger, holds, transfers, requests, audits, payments] = await Promise.all([
      pool.query(
        `SELECT * FROM food_customer_wallet_ledger
          WHERE account_id = $1
          ORDER BY created_at DESC, id DESC
          LIMIT ${MAX_DETAIL_ROWS}`,
        [accountId]
      ),
      pool.query(
        `SELECT * FROM food_customer_wallet_holds
          WHERE account_id = $1
          ORDER BY created_at DESC
          LIMIT ${MAX_DETAIL_ROWS}`,
        [accountId]
      ),
      pool.query(
        `SELECT * FROM food_customer_wallet_transfers
          WHERE sender_account_id = $1 OR recipient_account_id = $1
          ORDER BY created_at DESC
          LIMIT ${MAX_DETAIL_ROWS}`,
        [accountId]
      ),
      pool.query(
        `SELECT r.*, fr.display_name AS restaurant_name,
                COALESCE(NULLIF(TRIM(requester.first_name || ' ' || requester.last_name), ''), requester.email) AS requested_by_name
           FROM food_customer_wallet_load_requests r
           JOIN food_restaurants fr ON fr.id = r.restaurant_id
           LEFT JOIN users requester ON requester.id = r.requested_by_user_id
          WHERE r.restaurant_id = $1 AND r.customer_id = $2
          ORDER BY r.created_at DESC
          LIMIT ${MAX_DETAIL_ROWS}`,
        [account.restaurant_id, account.customer_id]
      ),
      pool.query(
        `SELECT e.*, COALESCE(NULLIF(TRIM(operator.first_name || ' ' || operator.last_name), ''), operator.email) AS operator_name,
                operator.email AS operator_email
           FROM food_customer_wallet_operator_audit_events e
           LEFT JOIN users operator ON operator.id = e.operator_user_id
          WHERE e.wallet_account_id = $1
          ORDER BY e.created_at DESC
          LIMIT ${MAX_DETAIL_ROWS}`,
        [accountId]
      ),
      pool.query(
        `SELECT p.id, p.restaurant_id, p.food_order_id, p.payment_type, p.amount_cents,
                p.status, p.provider, p.reference, p.note, p.refunded_amount_cents,
                p.idempotency_key, p.metadata, p.created_by, p.created_at,
                o.total_cents AS order_total_cents,
                COALESCE(NULLIF(TRIM(creator.first_name || ' ' || creator.last_name), ''), creator.email) AS created_by_name
           FROM restaurant_pos_payments p
           LEFT JOIN food_orders o ON o.id = p.food_order_id
           LEFT JOIN users creator ON creator.id = p.created_by
          WHERE p.restaurant_id = $1
            AND p.metadata->>'walletAccountId' = $2
          ORDER BY p.created_at DESC
          LIMIT ${MAX_DETAIL_ROWS}`,
        [account.restaurant_id, String(accountId)]
      ),
    ]);

    res.json({
      generatedAt: new Date().toISOString(),
      wallet: formatWallet(account),
      ledger: ledger.rows.map(formatLedgerRow),
      holds: holds.rows.map(formatHold),
      transfers: transfers.rows.map(formatTransfer),
      loadRequests: requests.rows.map(formatLoadRequest),
      operatorAudit: audits.rows.map((row) => ({
        id: String(row.id),
        actionType: row.action_type,
        amountCents: row.amount_cents === null || row.amount_cents === undefined ? null : Number(row.amount_cents),
        currencyCode: row.currency_code || account.currency_code,
        correlationId: row.correlation_id || null,
        requestIp: row.request_ip || null,
        metadata: row.metadata || {},
        operatorUserId: row.operator_user_id || null,
        operatorName: row.operator_name || null,
        operatorEmail: row.operator_email || null,
        createdAt: row.created_at,
      })),
      payments: payments.rows.map((row) => ({
        id: String(row.id),
        restaurantId: String(row.restaurant_id),
        foodOrderId: row.food_order_id ? String(row.food_order_id) : null,
        paymentType: row.payment_type,
        amountCents: Number(row.amount_cents || 0),
        refundedAmountCents: Number(row.refunded_amount_cents || 0),
        status: row.status,
        provider: row.provider || null,
        reference: row.reference || null,
        note: row.note || null,
        orderTotalCents: row.order_total_cents === null || row.order_total_cents === undefined ? null : Number(row.order_total_cents),
        createdBy: row.created_by || null,
        createdByName: row.created_by_name || null,
        metadata: row.metadata || {},
        createdAt: row.created_at,
      })),
    });
  } catch (err) {
    next(err);
  }
};

exports.updateWalletStatus = async (req, res, next) => {
  try {
    const accountId = parsePositiveInt(req.params.accountId);
    const status = normalizeString(req.body?.status, 20);
    const reason = normalizeString(req.body?.reason, 500);
    if (!accountId) throw new AppError('Wallet not found', 404, 'wallet_not_found');
    if (!['active', 'suspended'].includes(status)) {
      throw new AppError('Validation failed', 400, 'validation_failed', {
        status: 'Status must be active or suspended',
      });
    }
    if (status === 'suspended' && !reason) {
      throw new AppError('Validation failed', 400, 'validation_failed', {
        reason: 'A reason is required when suspending a wallet',
      });
    }

    const result = await withTransaction(pool, async (client) => {
      const { rows: [account] } = await client.query(
        `SELECT a.*, fr.display_name AS restaurant_name, fr.business_id,
                COALESCE(NULLIF(TRIM(u.first_name || ' ' || u.last_name), ''), u.email) AS customer_name,
                u.email AS customer_email
           FROM food_customer_wallet_accounts a
           JOIN food_restaurants fr ON fr.id = a.restaurant_id
           JOIN users u ON u.id = a.customer_id
          WHERE a.id = $1
          FOR UPDATE`,
        [accountId]
      );
      if (!account) throw new AppError('Wallet not found', 404, 'wallet_not_found');
      if (account.status === 'closed') throw new AppError('Closed wallets cannot be reactivated', 409, 'wallet_closed');
      if (account.status === status) return { account, changed: false };

      const { rows: [updated] } = await client.query(
        `UPDATE food_customer_wallet_accounts
            SET status = $1, updated_at = NOW()
          WHERE id = $2
          RETURNING *`,
        [status, accountId]
      );
      await logFoodWalletOperatorAudit(client, {
        restaurantId: account.restaurant_id,
        businessId: account.business_id,
        walletAccountId: account.id,
        customerId: account.customer_id,
        operatorUserId: req.user.id,
        actionType: status === 'suspended' ? 'super_admin_wallet_suspended' : 'super_admin_wallet_reactivated',
        currencyCode: account.currency_code,
        correlationId: normalizeString(req.body?.correlationId, 120) || `admin-wallet-status:${account.id}:${Date.now()}`,
        requestIp: req.ip || null,
        metadata: {
          source: 'super_admin_restaurant_credit_console',
          previousStatus: account.status,
          nextStatus: status,
          reason: reason || null,
          restaurantName: account.restaurant_name,
          customerEmail: account.customer_email,
        },
      });
      return { account: { ...updated, restaurant_name: account.restaurant_name, customer_name: account.customer_name, customer_email: account.customer_email }, changed: true, previousStatus: account.status };
    }, 'admin_restaurant_credit_status');

    if (result.changed) {
      await adminAction(
        req,
        status === 'suspended' ? 'restaurant_credit_wallet_suspended' : 'restaurant_credit_wallet_reactivated',
        'food_customer_wallet_account',
        String(accountId),
        `Super Admin changed restaurant credit wallet status to ${status}.`,
        { status: result.previousStatus },
        { status, reason: reason || null }
      );
    }
    res.json({ changed: result.changed, wallet: formatWallet({ ...result.account, account_id: result.account.id }) });
  } catch (err) {
    next(err);
  }
};

exports.releaseHold = async (req, res, next) => {
  try {
    const holdId = parseUuid(req.params.holdId, 'hold_id');
    const reason = normalizeString(req.body?.reason, 500);
    if (!reason) {
      throw new AppError('Validation failed', 400, 'validation_failed', {
        reason: 'A reason is required when releasing a hold',
      });
    }

    const result = await withTransaction(pool, async (client) => {
      const { rows: [hold] } = await client.query(
        `SELECT h.*, fr.business_id, fr.display_name AS restaurant_name
           FROM food_customer_wallet_holds h
           JOIN food_restaurants fr ON fr.id = h.restaurant_id
          WHERE h.id = $1
          FOR UPDATE`,
        [holdId]
      );
      if (!hold) throw new AppError('Wallet hold not found', 404, 'wallet_hold_not_found');
      const released = await releaseWalletHold(client, {
        holdId,
        restaurantId: hold.restaurant_id,
      });
      if (released.changed) {
        await logFoodWalletOperatorAudit(client, {
          restaurantId: hold.restaurant_id,
          businessId: hold.business_id,
          walletAccountId: hold.account_id,
          customerId: hold.customer_id,
          operatorUserId: req.user.id,
          actionType: 'super_admin_wallet_hold_released',
          amountCents: hold.amount_cents,
          currencyCode: hold.currency_code,
          correlationId: hold.correlation_id || `admin-wallet-hold:${hold.id}`,
          requestIp: req.ip || null,
          metadata: {
            source: 'super_admin_restaurant_credit_console',
            reason,
            previousStatus: hold.status,
            nextStatus: 'released',
            restaurantName: hold.restaurant_name,
          },
        });
      }
      return { ...released, restaurantId: hold.restaurant_id, accountId: hold.account_id };
    }, 'admin_restaurant_credit_release_hold');

    if (result.changed) {
      await adminAction(
        req,
        'restaurant_credit_hold_released',
        'food_customer_wallet_hold',
        holdId,
        'Super Admin released a restaurant credit hold.',
        { status: 'active' },
        { status: 'released', reason }
      );
    }
    res.json({ changed: result.changed, hold: formatHold(result.hold) });
  } catch (err) {
    next(err);
  }
};

exports.declineLoadRequest = async (req, res, next) => {
  try {
    const requestId = parsePositiveInt(req.params.requestId);
    const reason = normalizeString(req.body?.reason, 500);
    if (!requestId) throw new AppError('Wallet load request not found', 404, 'wallet_load_request_not_found');
    if (!reason) {
      throw new AppError('Validation failed', 400, 'validation_failed', {
        reason: 'A reason is required when declining a load request',
      });
    }

    const result = await withTransaction(pool, async (client) => {
      const { rows: [requestRow] } = await client.query(
        `SELECT r.*, fr.business_id, fr.display_name AS restaurant_name
           FROM food_customer_wallet_load_requests r
           JOIN food_restaurants fr ON fr.id = r.restaurant_id
          WHERE r.id = $1
          FOR UPDATE`,
        [requestId]
      );
      if (!requestRow) throw new AppError('Wallet load request not found', 404, 'wallet_load_request_not_found');
      if (requestRow.status !== 'pending') {
        throw new AppError('Wallet load request is not pending', 409, 'wallet_load_request_not_pending', { status: requestRow.status });
      }
      const { rows: [updated] } = await client.query(
        `UPDATE food_customer_wallet_load_requests
            SET status = 'cancelled', cancelled_by_user_id = $1, cancelled_at = NOW(),
                metadata = COALESCE(metadata, '{}'::jsonb) || $2::jsonb
          WHERE id = $3
          RETURNING *`,
        [req.user.id, JSON.stringify({ cancellationReason: reason, source: 'super_admin_restaurant_credit_console' }), requestId]
      );
      await logFoodWalletOperatorAudit(client, {
        restaurantId: requestRow.restaurant_id,
        businessId: requestRow.business_id,
        walletAccountId: null,
        customerId: requestRow.customer_id,
        operatorUserId: req.user.id,
        actionType: 'super_admin_load_request_declined',
        amountCents: requestRow.amount_cents,
        currencyCode: requestRow.currency_code,
        correlationId: requestRow.correlation_id || `admin-wallet-request:${requestId}`,
        requestIp: req.ip || null,
        metadata: { reason, restaurantName: requestRow.restaurant_name },
      });
      return updated;
    }, 'admin_restaurant_credit_decline_request');

    await adminAction(req, 'restaurant_credit_load_request_declined', 'food_customer_wallet_load_request', String(requestId), 'Super Admin declined a restaurant credit load request.', { status: 'pending' }, { status: 'cancelled', reason });
    res.json({ declined: true, loadRequest: formatLoadRequest(result) });
  } catch (err) {
    next(err);
  }
};

exports.approveLoadRequest = async (req, res, next) => {
  try {
    const requestId = parsePositiveInt(req.params.requestId);
    const approvalNote = normalizeString(req.body?.approvalNote || req.body?.approval_note, 500);
    if (!requestId) throw new AppError('Wallet load request not found', 404, 'wallet_load_request_not_found');

    const result = await withTransaction(pool, async (client) => {
      const { rows: [requestRow] } = await client.query(
        `SELECT r.*, fr.business_id, fr.display_name AS restaurant_name
           FROM food_customer_wallet_load_requests r
           JOIN food_restaurants fr ON fr.id = r.restaurant_id
          WHERE r.id = $1
          FOR UPDATE`,
        [requestId]
      );
      if (!requestRow) throw new AppError('Wallet load request not found', 404, 'wallet_load_request_not_found');
      if (requestRow.status !== 'pending') {
        throw new AppError('Wallet load request is not pending', 409, 'wallet_load_request_not_pending', { status: requestRow.status });
      }
      if (requestRow.expires_at && new Date(requestRow.expires_at).getTime() <= Date.now()) {
        await client.query(`UPDATE food_customer_wallet_load_requests SET status = 'expired' WHERE id = $1`, [requestId]);
        throw new AppError('Wallet load request expired', 409, 'wallet_load_request_expired');
      }
      if (requestRow.requested_by_user_id === req.user.id) {
        throw new AppError('A second wallet operator must approve this load', 409, 'wallet_load_requires_second_operator');
      }

      const walletResult = await creditFoodWallet(client, {
        restaurantId: requestRow.restaurant_id,
        customerId: requestRow.customer_id,
        currencyCode: requestRow.currency_code,
        amountCents: Number(requestRow.amount_cents || 0),
        description: requestRow.note || `Approved wallet credit at ${requestRow.restaurant_name}`,
        referenceType: 'merchant_load_request',
        referenceId: String(requestId),
        idempotencyKey: requestRow.idempotency_key || `wallet-load-request:${requestId}`,
        createdByUserId: req.user.id,
        correlationId: requestRow.correlation_id || `admin-wallet-request:${requestId}`,
        actorType: 'super_admin',
        metadata: {
          ...(requestRow.metadata || {}),
          source: 'super_admin_restaurant_credit_console',
          loadRequestId: String(requestId),
          approvedByUserId: req.user.id,
          approvalNote: approvalNote || null,
        },
      });
      const { rows: [updated] } = await client.query(
        `UPDATE food_customer_wallet_load_requests
            SET status = 'approved', approved_by_user_id = $1, approved_at = NOW(),
                metadata = COALESCE(metadata, '{}'::jsonb) || $2::jsonb
          WHERE id = $3
          RETURNING *`,
        [req.user.id, JSON.stringify({ approvalNote: approvalNote || null, ledgerEntryId: walletResult.entry ? String(walletResult.entry.id) : null, walletAccountId: walletResult.account ? String(walletResult.account.id) : null, replayed: Boolean(walletResult.replayed) }), requestId]
      );
      await logFoodWalletOperatorAudit(client, {
        restaurantId: requestRow.restaurant_id,
        businessId: requestRow.business_id,
        walletAccountId: walletResult.account?.id || null,
        customerId: requestRow.customer_id,
        operatorUserId: req.user.id,
        actionType: 'super_admin_load_request_approved',
        amountCents: requestRow.amount_cents,
        currencyCode: requestRow.currency_code,
        correlationId: requestRow.correlation_id || `admin-wallet-request:${requestId}`,
        requestIp: req.ip || null,
        metadata: { approvalNote: approvalNote || null, ledgerEntryId: walletResult.entry ? String(walletResult.entry.id) : null, replayed: Boolean(walletResult.replayed) },
      });
      return { request: updated, walletAccountId: walletResult.account?.id || null, replayed: Boolean(walletResult.replayed) };
    }, 'admin_restaurant_credit_approve_request');

    await adminAction(req, 'restaurant_credit_load_request_approved', 'food_customer_wallet_load_request', String(requestId), 'Super Admin approved a restaurant credit load request.', { status: 'pending' }, { status: 'approved', approvalNote: approvalNote || null });
    res.json({ approved: true, replayed: result.replayed, walletAccountId: result.walletAccountId ? String(result.walletAccountId) : null, loadRequest: formatLoadRequest(result.request) });
  } catch (err) {
    next(err);
  }
};
