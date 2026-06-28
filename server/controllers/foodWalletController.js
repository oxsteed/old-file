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

exports.listCustomerWallets = async (req, res, next) => {
  try {
    const wallets = await loadWalletAccountsForUser(req.user.id, {
      transactionLimit: 8,
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
