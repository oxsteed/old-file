'use strict';

const pool = require('../db');
const { AppError } = require('../middleware/errorHandler');
const { withTransaction } = require('../utils/transaction');
const { logFoodWalletOperatorAudit } = require('../services/foodWalletAuditService');
const {
  creditFoodWallet,
  loadWalletAccountsForUser,
  verifyWalletIntegrityForCustomer,
} = require('../services/foodWalletService');

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
