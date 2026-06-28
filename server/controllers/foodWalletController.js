'use strict';

const crypto = require('crypto');
const pool = require('../db');
const { AppError } = require('../middleware/errorHandler');
const { withTransaction } = require('../utils/transaction');
const { logFoodWalletOperatorAudit } = require('../services/foodWalletAuditService');
const {
  creditFoodWallet,
  loadWalletAccountsForUser,
  verifyWalletIntegrityForCustomer,
} = require('../services/foodWalletService');

const WALLET_LOAD_APPROVAL_THRESHOLD_CENTS = Math.max(
  1,
  Number.parseInt(process.env.FOOD_WALLET_LOAD_APPROVAL_THRESHOLD_CENTS || '50000', 10)
);

function normalizeString(value, max = 255) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function normalizeCurrency(value) {
  const raw = normalizeString(value, 3);
  return raw ? raw.toUpperCase() : 'USD';
}

function parsePositiveInt(value, fallback = null) {
  const n = Number.parseInt(String(value), 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function parseLimit(value, fallback = 100, max = 500) {
  const n = parsePositiveInt(value, fallback);
  return Math.min(n, max);
}

function parsePositiveMoneyCents(body) {
  if (body?.amountCents !== undefined || body?.amount_cents !== undefined) {
    const raw = body.amountCents ?? body.amount_cents;
    const n = Math.round(Number(raw));
    if (!Number.isFinite(n) || n <= 0) {
      throw new AppError('Validation failed', 400, 'validation_failed', {
        amountCents: 'Amount must be a positive number of cents',
      });
    }
    return n;
  }
  if (body?.amount !== undefined) {
    const dollars = Number(body.amount);
    if (!Number.isFinite(dollars) || dollars <= 0) {
      throw new AppError('Validation failed', 400, 'validation_failed', {
        amount: 'Amount must be a positive number',
      });
    }
    return Math.round(dollars * 100);
  }
  throw new AppError('Validation failed', 400, 'validation_failed', {
    amountCents: 'Amount is required',
  });
}

function parseDateBoundary(value, fallback) {
  if (!value) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new AppError('Validation failed', 400, 'validation_failed', {
      dateRange: 'from and to must be valid ISO date strings',
    });
  }
  return date;
}

function signedLedgerAmount(entryType, amountCents) {
  const amount = Number(amountCents || 0);
  return entryType === 'debit' ? -Math.abs(amount) : Math.abs(amount);
}

function buildStatementId({ restaurantId, customerId, from, to, generatedAt }) {
  return crypto
    .createHash('sha256')
    .update([
      'food-wallet-statement-v1',
      restaurantId,
      customerId || 'all-customers',
      from.toISOString(),
      to.toISOString(),
      generatedAt,
    ].join('|'))
    .digest('hex')
    .slice(0, 32);
}

function formatWalletLoadRequest(row) {
  if (!row) return null;
  return {
    id: String(row.id),
    restaurantId: String(row.restaurant_id),
    businessId: row.business_id ? String(row.business_id) : null,
    customerId: row.customer_id,
    requestedByUserId: row.requested_by_user_id || null,
    approvedByUserId: row.approved_by_user_id || null,
    cancelledByUserId: row.cancelled_by_user_id || null,
    amountCents: Number(row.amount_cents || 0),
    amount: Number(row.amount_cents || 0) / 100,
    currencyCode: row.currency_code,
    status: row.status,
    note: row.note || null,
    referenceId: row.reference_id || null,
    idempotencyKey: row.idempotency_key || null,
    correlationId: row.correlation_id || null,
    metadata: row.metadata || {},
    approvedAt: row.approved_at || null,
    cancelledAt: row.cancelled_at || null,
    expiresAt: row.expires_at || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function parseWalletLoadRequestStatuses(value) {
  const allowed = new Set(['pending', 'approved', 'cancelled', 'expired']);
  const raw = value ? String(value).split(',').map((part) => part.trim()).filter(Boolean) : ['pending'];
  const statuses = raw.filter((status) => allowed.has(status));
  if (statuses.length !== raw.length) {
    throw new AppError('Validation failed', 400, 'validation_failed', {
      status: 'Status must be one of pending, approved, cancelled, expired',
    });
  }
  return statuses;
}

async function requireRestaurantAccess(userId, restaurantId) {
  const { rows } = await pool.query(
    `SELECT fr.id, fr.business_id, fr.owner_user_id, fr.display_name, fr.currency_code,
            CASE
              WHEN b.user_id = $2 OR fr.owner_user_id = $2 THEN 'owner'
              ELSE (
                SELECT bm.role
                  FROM business_members bm
                 WHERE bm.business_id = fr.business_id
                   AND bm.member_id = $2
                   AND bm.status = 'active'
                 LIMIT 1
              )
            END AS effective_role
       FROM food_restaurants fr
       JOIN businesses b ON b.id = fr.business_id
      WHERE fr.id = $1
      LIMIT 1`,
    [restaurantId, userId]
  );
  if (!rows[0] || !rows[0].effective_role) {
    throw new AppError('Restaurant not found', 404, 'restaurant_not_found');
  }
  return rows[0];
}

const WALLET_OPERATOR_ROLES = new Set(['owner', 'manager']);

function assertWalletOperator(restaurant) {
  if (!WALLET_OPERATOR_ROLES.has(restaurant.effective_role)) {
    throw new AppError('Owner or manager access required', 403, 'forbidden');
  }
}

function extractCustomerLookup(source = {}) {
  return {
    customerId: normalizeString(source.customerId || source.customer_id, 80),
    customerEmail: normalizeString(source.customerEmail || source.customer_email, 255)?.toLowerCase(),
  };
}

async function resolveCustomer(source) {
  const { customerId, customerEmail } = extractCustomerLookup(source);
  if (!customerId && !customerEmail) {
    throw new AppError('Validation failed', 400, 'validation_failed', {
      customerId: 'customerId or customerEmail is required',
    });
  }

  const { rows } = await pool.query(
    `SELECT id, first_name, last_name, email
       FROM users
      WHERE ($1::uuid IS NOT NULL AND id = $1::uuid)
         OR ($2::text IS NOT NULL AND LOWER(email) = $2)
      LIMIT 1`,
    [customerId || null, customerEmail || null]
  );
  if (!rows[0]) {
    throw new AppError('Customer not found', 404, 'customer_not_found');
  }
  return rows[0];
}

async function loadWalletAccountForOperator(client, restaurantId, customerId) {
  const { rows } = await client.query(
    `SELECT a.*,
            fr.display_name AS restaurant_name,
            fr.logo_url AS restaurant_logo_url
       FROM food_customer_wallet_accounts a
       JOIN food_restaurants fr ON fr.id = a.restaurant_id
      WHERE a.restaurant_id = $1
        AND a.customer_id = $2
      FOR UPDATE`,
    [restaurantId, customerId]
  );
  if (!rows[0]) {
    throw new AppError('Wallet account not found', 404, 'wallet_not_found');
  }
  return rows[0];
}

async function lockWalletAfterIntegrityFailure({
  audit,
  restaurantId,
  businessId = null,
  customerId,
  operatorUserId = null,
  correlationId,
  requestIp,
  initiatedBy,
}) {
  if (audit.valid || audit.wallet.status !== 'active') {
    return false;
  }

  return withTransaction(pool, async (client) => {
    const { rows: [updated] } = await client.query(
      `UPDATE food_customer_wallet_accounts
          SET status = 'suspended',
              updated_at = NOW()
        WHERE id = $1
          AND status = 'active'
        RETURNING *`,
      [audit.wallet.accountId]
    );
    if (!updated) return false;

    await logFoodWalletOperatorAudit(client, {
      restaurantId,
      businessId,
      walletAccountId: audit.wallet.accountId,
      customerId,
      operatorUserId,
      actionType: 'wallet_integrity_failed_lock',
      amountCents: null,
      currencyCode: audit.wallet.currencyCode,
      correlationId,
      requestIp,
      metadata: {
        initiatedBy,
        valid: false,
        issueCount: audit.issues.length,
        issueCodes: audit.issues.map((issue) => issue.code),
        checkedAt: audit.checkedAt,
      },
    });
    audit.wallet.status = 'suspended';
    return true;
  }, 'food_wallet_integrity_failure_lock');
}

exports.listCustomerWallets = async (req, res, next) => {
  try {
    const wallets = await loadWalletAccountsForUser(req.user.id, {
      transactionLimit: 8,
      includeInactive: true,
    });
    res.json({ wallets });
  } catch (err) {
    next(err);
  }
};

exports.verifyCustomerWalletIntegrity = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    if (!restaurantId) {
      throw new AppError('Restaurant not found', 404, 'restaurant_not_found');
    }
    const restaurant = await requireRestaurantAccess(req.user.id, restaurantId);
    assertWalletOperator(restaurant);
    const customer = await resolveCustomer(req.query);
    const audit = await verifyWalletIntegrityForCustomer(restaurantId, customer.id);
    const correlationId = normalizeString(
      req.query.correlationId || req.query.correlation_id || `wallet-integrity:${restaurantId}:${customer.id}:${Date.now()}`,
      120
    );
    const locked = await lockWalletAfterIntegrityFailure({
      audit,
      restaurantId,
      businessId: restaurant.business_id,
      customerId: customer.id,
      operatorUserId: req.user.id,
      correlationId,
      requestIp: req.ip || null,
      initiatedBy: 'operator_integrity_check',
    });
    await withTransaction(pool, async (client) => {
      await logFoodWalletOperatorAudit(client, {
        restaurantId,
        businessId: restaurant.business_id,
        walletAccountId: audit.wallet.accountId,
        customerId: customer.id,
        operatorUserId: req.user.id,
        actionType: 'integrity_check',
        amountCents: null,
        currencyCode: audit.wallet.currencyCode,
        correlationId,
        requestIp: req.ip || null,
        metadata: {
          valid: audit.valid,
          issueCount: audit.issues.length,
          issueCodes: audit.issues.map((issue) => issue.code),
          checkedAt: audit.checkedAt,
          requestedCustomerEmail: customer.email,
          locked,
        },
      });
    }, 'food_wallet_integrity_audit');
    res.json({
      customer: {
        id: customer.id,
        firstName: customer.first_name,
        lastName: customer.last_name,
        email: customer.email,
      },
      audit,
      locked,
    });
  } catch (err) {
    next(err);
  }
};

exports.verifyMyWalletIntegrity = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    if (!restaurantId) {
      throw new AppError('Restaurant not found', 404, 'restaurant_not_found');
    }

    const audit = await verifyWalletIntegrityForCustomer(restaurantId, req.user.id);
    const correlationId = `customer-wallet-integrity:${restaurantId}:${req.user.id}:${Date.now()}`;
    const locked = await lockWalletAfterIntegrityFailure({
      audit,
      restaurantId,
      customerId: req.user.id,
      correlationId,
      requestIp: req.ip || null,
      initiatedBy: 'customer_integrity_check',
    });
    res.json({
      audit: {
        valid: audit.valid,
        checkedAt: audit.checkedAt,
        entryCount: audit.entryCount,
        issueCount: audit.issues.length,
        issueCodes: audit.issues.map((issue) => issue.code),
        currentHashAlgorithm: audit.currentHashAlgorithm,
        locked,
        wallet: {
          id: audit.wallet.id,
          accountId: audit.wallet.accountId,
          restaurantId: audit.wallet.restaurantId,
          restaurantName: audit.wallet.restaurantName,
          currencyCode: audit.wallet.currencyCode,
          balanceCents: audit.wallet.balanceCents,
          status: audit.wallet.status,
          ledgerVersion: audit.wallet.ledgerVersion,
          lastEntryHash: audit.wallet.lastEntryHash,
        },
      },
    });
  } catch (err) {
    next(err);
  }
};

exports.getCustomerWallet = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    if (!restaurantId) {
      throw new AppError('Restaurant not found', 404, 'restaurant_not_found');
    }
    const wallets = await loadWalletAccountsForUser(req.user.id, {
      restaurantId,
      transactionLimit: 25,
      includeInactive: true,
    });
    res.json({ wallet: wallets[0] || null });
  } catch (err) {
    next(err);
  }
};

exports.loadCustomerWallet = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    if (!restaurantId) {
      throw new AppError('Restaurant not found', 404, 'restaurant_not_found');
    }
    const restaurant = await requireRestaurantAccess(req.user.id, restaurantId);
    assertWalletOperator(restaurant);
    const customer = await resolveCustomer(req.body);
    const amountCents = parsePositiveMoneyCents(req.body);
    const currencyCode = normalizeCurrency(req.body.currencyCode || req.body.currency_code || restaurant.currency_code);
    const idempotencyKey = normalizeString(
      req.body.idempotencyKey || req.body.idempotency_key || req.body.clientReferenceId || req.body.client_reference_id,
      120
    );
    const note = normalizeString(req.body.note || req.body.description, 255);
    const referenceId = normalizeString(req.body.referenceId || req.body.reference_id, 120)
      || idempotencyKey
      || `${restaurantId}:${customer.id}:${amountCents}`;
    const correlationId = normalizeString(
      req.body.correlationId || req.body.correlation_id || idempotencyKey || `wallet-load:${restaurantId}:${customer.id}:${amountCents}`,
      120
    );

    if (amountCents >= WALLET_LOAD_APPROVAL_THRESHOLD_CENTS) {
      const loadRequest = await withTransaction(pool, async (client) => {
        const { rows: existingRows } = idempotencyKey
          ? await client.query(
            `SELECT *
               FROM food_customer_wallet_load_requests
              WHERE restaurant_id = $1
                AND idempotency_key = $2
              LIMIT 1`,
            [restaurantId, idempotencyKey]
          )
          : { rows: [] };
        if (existingRows[0]) return existingRows[0];

        const { rows: [requestRow] } = await client.query(
          `INSERT INTO food_customer_wallet_load_requests
             (restaurant_id, business_id, customer_id, requested_by_user_id,
              amount_cents, currency_code, status, note, reference_id, idempotency_key,
              correlation_id, request_ip, metadata, expires_at)
           VALUES
             ($1, $2, $3, $4, $5, $6, 'pending', $7, $8, $9, $10, $11,
              $12::jsonb, NOW() + INTERVAL '7 days')
           RETURNING *`,
          [
            restaurantId,
            restaurant.business_id,
            customer.id,
            req.user.id,
            amountCents,
            currencyCode,
            note,
            referenceId,
            idempotencyKey,
            correlationId,
            req.ip || null,
            JSON.stringify({
              source: 'merchant_load_request',
              approvalThresholdCents: WALLET_LOAD_APPROVAL_THRESHOLD_CENTS,
              restaurantName: restaurant.display_name,
              customerEmail: customer.email,
            }),
          ]
        );
        await logFoodWalletOperatorAudit(client, {
          restaurantId,
          businessId: restaurant.business_id,
          walletAccountId: null,
          customerId: customer.id,
          operatorUserId: req.user.id,
          actionType: 'merchant_load_requested',
          amountCents,
          currencyCode,
          correlationId,
          requestIp: req.ip || null,
          metadata: {
            loadRequestId: String(requestRow.id),
            approvalThresholdCents: WALLET_LOAD_APPROVAL_THRESHOLD_CENTS,
            referenceId,
            idempotencyKey: idempotencyKey || null,
            note: note || null,
            customerEmail: customer.email,
          },
        });
        return requestRow;
      }, 'food_wallet_request_large_load');

      return res.status(202).json({
        pendingApproval: true,
        approvalThresholdCents: WALLET_LOAD_APPROVAL_THRESHOLD_CENTS,
        loadRequest: formatWalletLoadRequest(loadRequest),
        customer: {
          id: customer.id,
          firstName: customer.first_name,
          lastName: customer.last_name,
          email: customer.email,
        },
      });
    }

    const result = await withTransaction(pool, async (client) => {
      const walletResult = await creditFoodWallet(client, {
        restaurantId,
        customerId: customer.id,
        currencyCode,
        amountCents,
        description: note || `Wallet credit loaded at ${restaurant.display_name}`,
        referenceType: 'merchant_load',
        referenceId,
        idempotencyKey,
        createdByUserId: req.user.id,
        correlationId,
        actorType: 'restaurant_staff',
        metadata: {
          source: 'merchant_load',
          restaurantName: restaurant.display_name,
          customerEmail: customer.email,
          note: note || null,
          loadedByUserId: req.user.id,
          requestIp: req.ip || null,
        },
      });
      if (!walletResult.replayed) {
        await logFoodWalletOperatorAudit(client, {
          restaurantId,
          businessId: restaurant.business_id,
          walletAccountId: walletResult.account.id,
          customerId: customer.id,
          operatorUserId: req.user.id,
          actionType: 'merchant_load',
          amountCents,
          currencyCode,
          correlationId,
          requestIp: req.ip || null,
          metadata: {
            replayed: false,
            referenceId,
            idempotencyKey: idempotencyKey || null,
            note: note || null,
            restaurantName: restaurant.display_name,
            customerEmail: customer.email,
          },
        });
      }
      return walletResult;
    }, 'food_wallet_load_customer');

    const wallets = await loadWalletAccountsForUser(customer.id, {
      restaurantId,
      transactionLimit: 25,
    });

    res.status(result.replayed ? 200 : 201).json({
      wallet: wallets[0] || null,
      customer: {
        id: customer.id,
        firstName: customer.first_name,
        lastName: customer.last_name,
        email: customer.email,
      },
      replayed: Boolean(result.replayed),
    });
  } catch (err) {
    next(err);
  }
};

exports.updateCustomerWalletStatus = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    if (!restaurantId) {
      throw new AppError('Restaurant not found', 404, 'restaurant_not_found');
    }
    const restaurant = await requireRestaurantAccess(req.user.id, restaurantId);
    assertWalletOperator(restaurant);
    const customer = await resolveCustomer(req.body);
    const nextStatus = normalizeString(req.body.status, 20);
    if (!['active', 'suspended'].includes(nextStatus)) {
      throw new AppError('Validation failed', 400, 'validation_failed', {
        status: 'Status must be active or suspended',
      });
    }
    const reason = normalizeString(req.body.reason, 500);
    if (nextStatus === 'suspended' && !reason) {
      throw new AppError('Validation failed', 400, 'validation_failed', {
        reason: 'Reason is required when suspending a wallet',
      });
    }
    const correlationId = normalizeString(
      req.body.correlationId || req.body.correlation_id || `wallet-status:${restaurantId}:${customer.id}:${Date.now()}`,
      120
    );

    const result = await withTransaction(pool, async (client) => {
      const account = await loadWalletAccountForOperator(client, restaurantId, customer.id);
      if (account.status === 'closed') {
        throw new AppError('Closed wallets cannot be reactivated', 409, 'wallet_closed');
      }
      if (account.status === nextStatus) {
        return { account, changed: false };
      }

      const { rows: [updated] } = await client.query(
        `UPDATE food_customer_wallet_accounts
            SET status = $1,
                updated_at = NOW()
          WHERE id = $2
          RETURNING *`,
        [nextStatus, account.id]
      );
      await logFoodWalletOperatorAudit(client, {
        restaurantId,
        businessId: restaurant.business_id,
        walletAccountId: account.id,
        customerId: customer.id,
        operatorUserId: req.user.id,
        actionType: nextStatus === 'suspended' ? 'wallet_suspended' : 'wallet_reactivated',
        amountCents: null,
        currencyCode: account.currency_code,
        correlationId,
        requestIp: req.ip || null,
        metadata: {
          previousStatus: account.status,
          nextStatus,
          reason: reason || null,
          customerEmail: customer.email,
          restaurantName: restaurant.display_name,
        },
      });
      return { account: updated, changed: true };
    }, 'food_wallet_update_status');

    const wallets = await loadWalletAccountsForUser(customer.id, {
      restaurantId,
      transactionLimit: 25,
      includeInactive: true,
    });

    res.json({
      wallet: wallets[0] || {
        id: String(result.account.restaurant_id),
        accountId: String(result.account.id),
        restaurantId: String(result.account.restaurant_id),
        restaurantName: restaurant.display_name,
        currencyCode: result.account.currency_code,
        balanceCents: Number(result.account.balance_cents || 0),
        balance: Number(result.account.balance_cents || 0) / 100,
        status: result.account.status,
        ledgerVersion: Number(result.account.ledger_version || 0),
        lastEntryHash: result.account.last_entry_hash || null,
        transactions: [],
      },
      customer: {
        id: customer.id,
        firstName: customer.first_name,
        lastName: customer.last_name,
        email: customer.email,
      },
      changed: result.changed,
    });
  } catch (err) {
    next(err);
  }
};

exports.listCustomerWalletLoadRequests = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    if (!restaurantId) {
      throw new AppError('Restaurant not found', 404, 'restaurant_not_found');
    }
    const restaurant = await requireRestaurantAccess(req.user.id, restaurantId);
    assertWalletOperator(restaurant);
    const limit = parseLimit(req.query.limit, 50, 200);
    const statuses = parseWalletLoadRequestStatuses(req.query.status);
    const hasCustomerFilter = Boolean(req.query.customerId || req.query.customer_id || req.query.customerEmail || req.query.customer_email);
    const customer = hasCustomerFilter ? await resolveCustomer(req.query) : null;

    const { rows } = await pool.query(
      `SELECT r.*,
              COALESCE(NULLIF(TRIM(u.first_name || ' ' || u.last_name), ''), u.email) AS customer_name,
              u.email AS customer_email
         FROM food_customer_wallet_load_requests r
         LEFT JOIN users u ON u.id = r.customer_id
        WHERE r.restaurant_id = $1
          AND r.status = ANY($2::text[])
          AND ($3::uuid IS NULL OR r.customer_id = $3::uuid)
        ORDER BY r.created_at DESC
        LIMIT $4`,
      [restaurantId, statuses, customer?.id || null, limit]
    );

    res.json({
      restaurant: {
        id: String(restaurant.id),
        businessId: restaurant.business_id ? String(restaurant.business_id) : null,
        name: restaurant.display_name,
      },
      filters: {
        statuses,
        customerId: customer?.id || null,
        limit,
      },
      loadRequests: rows.map((row) => ({
        ...formatWalletLoadRequest(row),
        customerName: row.customer_name || null,
        customerEmail: row.customer_email || null,
      })),
    });
  } catch (err) {
    next(err);
  }
};

exports.approveCustomerWalletLoadRequest = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    const requestId = parsePositiveInt(req.params.requestId);
    if (!restaurantId || !requestId) {
      throw new AppError('Wallet load request not found', 404, 'wallet_load_request_not_found');
    }
    const restaurant = await requireRestaurantAccess(req.user.id, restaurantId);
    assertWalletOperator(restaurant);
    const approvalNote = normalizeString(req.body?.approvalNote || req.body?.approval_note, 500);
    const result = await withTransaction(pool, async (client) => {
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
      if (requestRow.status !== 'pending') {
        throw new AppError('Wallet load request is not pending', 409, 'wallet_load_request_not_pending', {
          status: requestRow.status,
        });
      }
      if (requestRow.expires_at && new Date(requestRow.expires_at) < new Date()) {
        await client.query(
          `UPDATE food_customer_wallet_load_requests
              SET status = 'expired'
            WHERE id = $1`,
          [requestRow.id]
        );
        throw new AppError('Wallet load request expired', 409, 'wallet_load_request_expired');
      }
      if (requestRow.requested_by_user_id === req.user.id) {
        throw new AppError('A second wallet operator must approve this load', 409, 'wallet_load_requires_second_operator');
      }

      const walletResult = await creditFoodWallet(client, {
        restaurantId,
        customerId: requestRow.customer_id,
        currencyCode: requestRow.currency_code,
        amountCents: Number(requestRow.amount_cents || 0),
        description: requestRow.note || `Approved wallet credit at ${restaurant.display_name}`,
        referenceType: 'merchant_load_request',
        referenceId: String(requestRow.id),
        idempotencyKey: requestRow.idempotency_key || `wallet-load-request:${requestRow.id}`,
        createdByUserId: req.user.id,
        correlationId: requestRow.correlation_id,
        actorType: 'restaurant_staff',
        metadata: {
          ...(requestRow.metadata || {}),
          source: 'merchant_load_request_approval',
          loadRequestId: String(requestRow.id),
          requestedByUserId: requestRow.requested_by_user_id,
          approvedByUserId: req.user.id,
          approvalNote: approvalNote || null,
        },
      });

      const { rows: [updatedRequest] } = await client.query(
        `UPDATE food_customer_wallet_load_requests
            SET status = 'approved',
                approved_by_user_id = $1,
                approved_at = NOW(),
                metadata = COALESCE(metadata, '{}'::jsonb) || $2::jsonb
          WHERE id = $3
          RETURNING *`,
        [
          req.user.id,
          JSON.stringify({
            approvalNote: approvalNote || null,
            ledgerEntryId: walletResult.entry ? String(walletResult.entry.id) : null,
            walletAccountId: walletResult.account ? String(walletResult.account.id) : null,
            replayed: Boolean(walletResult.replayed),
          }),
          requestRow.id,
        ]
      );

      await logFoodWalletOperatorAudit(client, {
        restaurantId,
        businessId: restaurant.business_id,
        walletAccountId: walletResult.account?.id || null,
        customerId: requestRow.customer_id,
        operatorUserId: req.user.id,
        actionType: 'merchant_load_approved',
        amountCents: Number(requestRow.amount_cents || 0),
        currencyCode: requestRow.currency_code,
        correlationId: requestRow.correlation_id,
        requestIp: req.ip || null,
        metadata: {
          loadRequestId: String(requestRow.id),
          requestedByUserId: requestRow.requested_by_user_id,
          approvalNote: approvalNote || null,
          ledgerEntryId: walletResult.entry ? String(walletResult.entry.id) : null,
          replayed: Boolean(walletResult.replayed),
        },
      });

      return { loadRequest: updatedRequest, walletResult };
    }, 'food_wallet_approve_large_load');

    const wallets = await loadWalletAccountsForUser(result.loadRequest.customer_id, {
      restaurantId,
      transactionLimit: 25,
      includeInactive: true,
    });

    res.json({
      approved: true,
      loadRequest: formatWalletLoadRequest(result.loadRequest),
      wallet: wallets[0] || null,
      replayed: Boolean(result.walletResult.replayed),
    });
  } catch (err) {
    next(err);
  }
};

exports.cancelCustomerWalletLoadRequest = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    const requestId = parsePositiveInt(req.params.requestId);
    if (!restaurantId || !requestId) {
      throw new AppError('Wallet load request not found', 404, 'wallet_load_request_not_found');
    }
    const restaurant = await requireRestaurantAccess(req.user.id, restaurantId);
    assertWalletOperator(restaurant);
    const reason = normalizeString(req.body?.reason, 500);
    if (!reason) {
      throw new AppError('Validation failed', 400, 'validation_failed', {
        reason: 'Cancellation reason is required',
      });
    }
    const result = await withTransaction(pool, async (client) => {
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
      if (requestRow.status !== 'pending') {
        throw new AppError('Wallet load request is not pending', 409, 'wallet_load_request_not_pending', {
          status: requestRow.status,
        });
      }

      const { rows: [updatedRequest] } = await client.query(
        `UPDATE food_customer_wallet_load_requests
            SET status = 'cancelled',
                cancelled_by_user_id = $1,
                cancelled_at = NOW(),
                metadata = COALESCE(metadata, '{}'::jsonb) || $2::jsonb
          WHERE id = $3
          RETURNING *`,
        [
          req.user.id,
          JSON.stringify({ cancellationReason: reason }),
          requestRow.id,
        ]
      );

      await logFoodWalletOperatorAudit(client, {
        restaurantId,
        businessId: restaurant.business_id,
        walletAccountId: null,
        customerId: requestRow.customer_id,
        operatorUserId: req.user.id,
        actionType: 'merchant_load_cancelled',
        amountCents: Number(requestRow.amount_cents || 0),
        currencyCode: requestRow.currency_code,
        correlationId: requestRow.correlation_id,
        requestIp: req.ip || null,
        metadata: {
          loadRequestId: String(requestRow.id),
          requestedByUserId: requestRow.requested_by_user_id,
          reason,
        },
      });

      return updatedRequest;
    }, 'food_wallet_cancel_large_load');

    res.json({
      cancelled: true,
      loadRequest: formatWalletLoadRequest(result),
    });
  } catch (err) {
    next(err);
  }
};

exports.getCustomerWalletReconciliation = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    if (!restaurantId) {
      throw new AppError('Restaurant not found', 404, 'restaurant_not_found');
    }
    const restaurant = await requireRestaurantAccess(req.user.id, restaurantId);
    assertWalletOperator(restaurant);

    const to = parseDateBoundary(req.query.to, new Date());
    const from = parseDateBoundary(
      req.query.from,
      new Date(to.getTime() - (30 * 24 * 60 * 60 * 1000))
    );
    if (from > to) {
      throw new AppError('Validation failed', 400, 'validation_failed', {
        dateRange: 'from must be before to',
      });
    }

    const [accountSummary, ledgerSummary, auditEvents] = await Promise.all([
      pool.query(
        `SELECT currency_code,
                COUNT(*)::int AS total_accounts,
                COUNT(*) FILTER (WHERE status = 'active')::int AS active_accounts,
                COUNT(*) FILTER (WHERE status = 'suspended')::int AS suspended_accounts,
                COUNT(*) FILTER (WHERE status = 'closed')::int AS closed_accounts,
                COALESCE(SUM(balance_cents), 0)::bigint AS total_balance_cents,
                COALESCE(SUM(balance_cents) FILTER (WHERE status = 'active'), 0)::bigint AS active_balance_cents,
                COALESCE(SUM(balance_cents) FILTER (WHERE status IN ('suspended', 'closed')), 0)::bigint AS locked_balance_cents
           FROM food_customer_wallet_accounts
          WHERE restaurant_id = $1
          GROUP BY currency_code
          ORDER BY currency_code`,
        [restaurantId]
      ),
      pool.query(
        `SELECT currency_code,
                entry_type,
                COUNT(*)::int AS entry_count,
                COALESCE(SUM(amount_cents), 0)::bigint AS amount_cents
           FROM food_customer_wallet_ledger
          WHERE restaurant_id = $1
            AND created_at >= $2
            AND created_at <= $3
          GROUP BY currency_code, entry_type
          ORDER BY currency_code, entry_type`,
        [restaurantId, from.toISOString(), to.toISOString()]
      ),
      pool.query(
        `SELECT id,
                wallet_account_id,
                customer_id,
                operator_user_id,
                action_type,
                amount_cents,
                currency_code,
                correlation_id,
                metadata,
                created_at
           FROM food_customer_wallet_operator_audit_events
          WHERE restaurant_id = $1
            AND created_at >= $2
            AND created_at <= $3
          ORDER BY created_at DESC
          LIMIT 25`,
        [restaurantId, from.toISOString(), to.toISOString()]
      ),
    ]);

    const balances = accountSummary.rows.map((row) => ({
      currencyCode: row.currency_code,
      totalAccounts: Number(row.total_accounts || 0),
      activeAccounts: Number(row.active_accounts || 0),
      suspendedAccounts: Number(row.suspended_accounts || 0),
      closedAccounts: Number(row.closed_accounts || 0),
      totalBalanceCents: Number(row.total_balance_cents || 0),
      activeBalanceCents: Number(row.active_balance_cents || 0),
      lockedBalanceCents: Number(row.locked_balance_cents || 0),
    }));
    const movements = ledgerSummary.rows.map((row) => ({
      currencyCode: row.currency_code,
      entryType: row.entry_type,
      count: Number(row.entry_count || 0),
      amountCents: Number(row.amount_cents || 0),
    }));
    const recentAuditEvents = auditEvents.rows.map((row) => ({
      id: String(row.id),
      walletAccountId: row.wallet_account_id ? String(row.wallet_account_id) : null,
      customerId: row.customer_id,
      operatorUserId: row.operator_user_id,
      actionType: row.action_type,
      amountCents: row.amount_cents === null || row.amount_cents === undefined ? null : Number(row.amount_cents),
      currencyCode: row.currency_code,
      correlationId: row.correlation_id,
      metadata: row.metadata || {},
      createdAt: row.created_at,
    }));
    const totals = balances.reduce((acc, row) => {
      acc.totalAccounts += row.totalAccounts;
      acc.activeAccounts += row.activeAccounts;
      acc.suspendedAccounts += row.suspendedAccounts;
      acc.closedAccounts += row.closedAccounts;
      return acc;
    }, {
      totalAccounts: 0,
      activeAccounts: 0,
      suspendedAccounts: 0,
      closedAccounts: 0,
    });

    res.json({
      restaurant: {
        id: String(restaurant.id),
        businessId: restaurant.business_id ? String(restaurant.business_id) : null,
        name: restaurant.display_name,
      },
      period: {
        from: from.toISOString(),
        to: to.toISOString(),
      },
      generatedAt: new Date().toISOString(),
      accounts: {
        ...totals,
        balances,
      },
      ledger: {
        movements,
      },
      auditEvents: recentAuditEvents,
      requiresAttention: totals.suspendedAccounts > 0
        || recentAuditEvents.some((event) => event.actionType === 'wallet_integrity_failed_lock'),
    });
  } catch (err) {
    next(err);
  }
};

exports.getCustomerWalletStatement = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    if (!restaurantId) {
      throw new AppError('Restaurant not found', 404, 'restaurant_not_found');
    }
    const restaurant = await requireRestaurantAccess(req.user.id, restaurantId);
    assertWalletOperator(restaurant);

    const to = parseDateBoundary(req.query.to, new Date());
    const from = parseDateBoundary(
      req.query.from,
      new Date(to.getTime() - (30 * 24 * 60 * 60 * 1000))
    );
    if (from > to) {
      throw new AppError('Validation failed', 400, 'validation_failed', {
        dateRange: 'from must be before to',
      });
    }

    const limit = parseLimit(req.query.limit, 100, 500);
    const hasCustomerFilter = Boolean(req.query.customerId || req.query.customer_id || req.query.customerEmail || req.query.customer_email);
    const customer = hasCustomerFilter ? await resolveCustomer(req.query) : null;
    const customerId = customer?.id || null;
    const fromIso = from.toISOString();
    const toIso = to.toISOString();

    const [ledgerEntries, movementSummary, currentBalances] = await Promise.all([
      pool.query(
        `SELECT l.id,
                l.account_id,
                l.restaurant_id,
                l.customer_id,
                COALESCE(NULLIF(TRIM(u.first_name || ' ' || u.last_name), ''), u.email) AS customer_name,
                u.email AS customer_email,
                l.entry_type,
                l.amount_cents,
                l.balance_after_cents,
                l.currency_code,
                l.description,
                l.reference_type,
                l.reference_id,
                l.correlation_id,
                l.metadata,
                l.entry_sequence,
                l.previous_entry_hash,
                l.entry_hash,
                l.hash_algorithm,
                l.created_by_user_id,
                l.actor_type,
                l.created_at
           FROM food_customer_wallet_ledger l
           LEFT JOIN users u ON u.id = l.customer_id
          WHERE l.restaurant_id = $1
            AND l.created_at >= $2
            AND l.created_at <= $3
            AND ($4::uuid IS NULL OR l.customer_id = $4::uuid)
          ORDER BY l.created_at ASC, l.entry_sequence ASC
          LIMIT $5`,
        [restaurantId, fromIso, toIso, customerId, limit]
      ),
      pool.query(
        `SELECT currency_code,
                entry_type,
                COUNT(*)::int AS entry_count,
                COALESCE(SUM(amount_cents), 0)::bigint AS amount_cents
           FROM food_customer_wallet_ledger
          WHERE restaurant_id = $1
            AND created_at >= $2
            AND created_at <= $3
            AND ($4::uuid IS NULL OR customer_id = $4::uuid)
          GROUP BY currency_code, entry_type
          ORDER BY currency_code, entry_type`,
        [restaurantId, fromIso, toIso, customerId]
      ),
      pool.query(
        `SELECT currency_code,
                COUNT(*)::int AS wallet_count,
                COUNT(*) FILTER (WHERE status = 'active')::int AS active_wallet_count,
                COUNT(*) FILTER (WHERE status = 'suspended')::int AS suspended_wallet_count,
                COUNT(*) FILTER (WHERE status = 'closed')::int AS closed_wallet_count,
                COALESCE(SUM(balance_cents), 0)::bigint AS balance_cents
           FROM food_customer_wallet_accounts
          WHERE restaurant_id = $1
            AND ($2::uuid IS NULL OR customer_id = $2::uuid)
          GROUP BY currency_code
          ORDER BY currency_code`,
        [restaurantId, customerId]
      ),
    ]);

    const generatedAt = new Date().toISOString();
    const reportId = buildStatementId({ restaurantId, customerId, from, to, generatedAt });
    const entries = ledgerEntries.rows.map((row) => ({
      id: String(row.id),
      accountId: row.account_id ? String(row.account_id) : null,
      customerId: row.customer_id,
      customerName: row.customer_name || null,
      customerEmail: row.customer_email || null,
      entryType: row.entry_type,
      amountCents: Number(row.amount_cents || 0),
      signedAmountCents: signedLedgerAmount(row.entry_type, row.amount_cents),
      balanceAfterCents: Number(row.balance_after_cents || 0),
      currencyCode: row.currency_code || restaurant.currency_code || 'USD',
      description: row.description || null,
      referenceType: row.reference_type || null,
      referenceId: row.reference_id || null,
      correlationId: row.correlation_id || null,
      metadata: row.metadata || {},
      entrySequence: Number(row.entry_sequence || 0),
      previousEntryHash: row.previous_entry_hash || null,
      entryHash: row.entry_hash || null,
      hashAlgorithm: row.hash_algorithm || null,
      createdByUserId: row.created_by_user_id || null,
      actorType: row.actor_type || null,
      createdAt: row.created_at,
    }));
    const movements = movementSummary.rows.map((row) => ({
      currencyCode: row.currency_code || restaurant.currency_code || 'USD',
      entryType: row.entry_type,
      count: Number(row.entry_count || 0),
      amountCents: Number(row.amount_cents || 0),
      signedAmountCents: signedLedgerAmount(row.entry_type, row.amount_cents),
    }));
    const balances = currentBalances.rows.map((row) => ({
      currencyCode: row.currency_code || restaurant.currency_code || 'USD',
      walletCount: Number(row.wallet_count || 0),
      activeWalletCount: Number(row.active_wallet_count || 0),
      suspendedWalletCount: Number(row.suspended_wallet_count || 0),
      closedWalletCount: Number(row.closed_wallet_count || 0),
      balanceCents: Number(row.balance_cents || 0),
    }));

    res.json({
      statement: {
        id: reportId,
        version: 'food-wallet-statement-v1',
        generatedAt,
        generatedByUserId: req.user.id,
        limit,
        truncated: ledgerEntries.rows.length >= limit,
      },
      restaurant: {
        id: String(restaurant.id),
        businessId: restaurant.business_id ? String(restaurant.business_id) : null,
        name: restaurant.display_name,
      },
      customer: customer ? {
        id: customer.id,
        firstName: customer.first_name,
        lastName: customer.last_name,
        email: customer.email,
      } : null,
      period: {
        from: fromIso,
        to: toIso,
      },
      currentBalances: balances,
      movements,
      entries,
      audit: {
        hashChainIncluded: true,
        entryCount: entries.length,
        filters: {
          customerScoped: Boolean(customer),
        },
      },
    });
  } catch (err) {
    next(err);
  }
};
