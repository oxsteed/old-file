'use strict';

/**
 * server/services/foodCreditFraudService.js
 *
 * Phase 3 restaurant credit fraud controls. Sits in front of
 * foodWalletController.createMyWalletLoadRequest (customer wallet credit
 * load requests) and enforces:
 *
 *   1. Customer velocity: max N credit requests per customer per rolling 24h
 *      (FOOD_CREDIT_MAX_REQUESTS_PER_CUSTOMER_PER_DAY, default 5). Block (429).
 *   2. Restaurant velocity: max N credit requests per restaurant per rolling
 *      24h (FOOD_CREDIT_MAX_REQUESTS_PER_RESTAURANT_PER_DAY, default 20).
 *      Block (429).
 *   3. Identity verification gate: requests over $200 require a passed
 *      identity verification (the Didit/verification tier system in
 *      identityVerificationService, the same check other money-moving
 *      endpoints use). Block (403). FAILS CLOSED: if the verification
 *      status cannot be determined, the request is blocked.
 *   4. Anomaly: a customer's very first credit request over $100 logs a
 *      warn signal (never blocks).
 *   5. Anomaly: requests to 3+ different restaurants within 1 hour logs a
 *      warn signal (never blocks).
 *
 * Failure posture: blocks are fail-closed (AppError is always rethrown).
 * Signal logging is fail-open (a logging outage must never wedge a
 * legitimate credit request). Any unexpected infrastructure error inside a
 * guard is logged and the request proceeds — except the IDV gate, which
 * fails closed when the verification status cannot be determined.
 */

const { AppError } = require('../middleware/errorHandler');
const logger = require('../utils/logger');
const { getCustomerVerificationTier } = require('./identityVerificationService');

function envPositiveInt(name, fallback) {
  const raw = Number.parseInt(process.env[name], 10);
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
}

function maxRequestsPerCustomerPerDay() {
  return envPositiveInt('FOOD_CREDIT_MAX_REQUESTS_PER_CUSTOMER_PER_DAY', 5);
}

function maxRequestsPerRestaurantPerDay() {
  return envPositiveInt('FOOD_CREDIT_MAX_REQUESTS_PER_RESTAURANT_PER_DAY', 20);
}

function idvRequiredCents() {
  return envPositiveInt('FOOD_CREDIT_IDV_REQUIRED_CENTS', 20000); // $200
}

function largeFirstRequestCents() {
  return envPositiveInt('FOOD_CREDIT_LARGE_FIRST_REQUEST_CENTS', 10000); // $100
}

function multiRestaurantCountThreshold() {
  return envPositiveInt('FOOD_CREDIT_MULTI_RESTAURANT_COUNT', 3);
}

/**
 * Append a fraud signal. Fail-open: a logging failure is reported but never
 * blocks the caller.
 */
async function logFraudSignal(client, { signalType, customerId, restaurantId, loadRequestId, severity = 'info', details = {} }) {
  try {
    const { rows } = await client.query(
      `INSERT INTO food_credit_fraud_signals
         (signal_type, customer_id, restaurant_id, load_request_id, details, severity)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6)
       RETURNING id`,
      [
        signalType,
        customerId || null,
        restaurantId || null,
        loadRequestId || null,
        JSON.stringify(details || {}),
        severity,
      ]
    );
    return rows[0]?.id || null;
  } catch (err) {
    logger.error('foodCreditFraudService.logFraudSignal failed (fail open)', {
      signalType,
      severity,
      error: err?.message,
    });
    return null;
  }
}

/** Block when the customer has hit their rolling-24h request limit. */
async function checkCustomerVelocity(client, customerId) {
  const limit = maxRequestsPerCustomerPerDay();
  const { rows } = await client.query(
    `SELECT COUNT(*)::int AS count
       FROM food_customer_wallet_load_requests
      WHERE customer_id = $1
        AND created_at >= NOW() - INTERVAL '24 hours'`,
    [customerId]
  );
  const count = rows[0]?.count || 0;
  if (count >= limit) {
    await logFraudSignal(client, {
      signalType: 'velocity_customer',
      customerId,
      severity: 'block',
      details: { count, limit, window: '24h' },
    });
    throw new AppError(
      'Too many credit requests. Please wait before requesting more restaurant credit.',
      429,
      'credit_request_velocity_customer',
      { count, limit }
    );
  }
  return { count, limit };
}

/** Block when the restaurant has hit its rolling-24h request limit. */
async function checkRestaurantVelocity(client, restaurantId) {
  const limit = maxRequestsPerRestaurantPerDay();
  const { rows } = await client.query(
    `SELECT COUNT(*)::int AS count
       FROM food_customer_wallet_load_requests
      WHERE restaurant_id = $1
        AND created_at >= NOW() - INTERVAL '24 hours'`,
    [restaurantId]
  );
  const count = rows[0]?.count || 0;
  if (count >= limit) {
    await logFraudSignal(client, {
      signalType: 'velocity_restaurant',
      restaurantId,
      severity: 'block',
      details: { count, limit, window: '24h' },
    });
    throw new AppError(
      'This restaurant is receiving too many credit requests right now. Please try again later.',
      429,
      'credit_request_velocity_restaurant',
      { count, limit }
    );
  }
  return { count, limit };
}

/**
 * Identity verification gate for large requests. Uses the same
 * verification-tier system as the other money-moving endpoints
 * (identityVerificationService.getCustomerVerificationTier): tier > 0 means
 * a passed identity verification.
 *
 * FAILS CLOSED: if the verification status cannot be determined, the large
 * request is blocked rather than allowed through unverified.
 */
async function checkIdentityVerificationGate(client, { customerId, restaurantId, amountCents }) {
  const threshold = idvRequiredCents();
  if (Number(amountCents) <= threshold) {
    return { required: false };
  }
  let tierInfo;
  try {
    tierInfo = await getCustomerVerificationTier(client, customerId);
  } catch (err) {
    logger.error('foodCreditFraudService IDV status lookup failed (fail closed)', {
      customerId,
      error: err?.message,
    });
    throw new AppError(
      'We could not verify your identity status. Complete identity verification before requesting credit over $200.',
      403,
      'credit_idv_unavailable'
    );
  }
  const tier = Number(tierInfo?.tier) || 0;
  if (tier <= 0) {
    await logFraudSignal(client, {
      signalType: 'idv_required',
      customerId,
      restaurantId,
      severity: 'block',
      details: {
        amountCents: Number(amountCents),
        thresholdCents: threshold,
        verificationStatus: String(tierInfo?.status || 'none'),
      },
    });
    throw new AppError(
      'Identity verification is required before requesting credit over $200. Verify your identity to continue.',
      403,
      'credit_idv_required',
      { verificationStatus: String(tierInfo?.status || 'none') }
    );
  }
  return { required: true, tier };
}

/**
 * Pre-insert screen for a new load request. Runs before the request row is
 * created. Blocks throw AppError (429/403); unexpected infrastructure errors
 * fail open so a DB hiccup cannot wedge legitimate requests (except the IDV
 * gate, which fails closed by design).
 */
async function screenLoadRequest(client, { customerId, restaurantId, amountCents }) {
  const runGuarded = async (name, fn) => {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof AppError) throw err; // blocks stay blocks
      logger.error('foodCreditFraudService guard failed (fail open)', {
        guard: name,
        customerId,
        restaurantId,
        error: err?.message,
      });
      return null;
    }
  };
  await runGuarded('customer_velocity', () => checkCustomerVelocity(client, customerId));
  await runGuarded('restaurant_velocity', () => checkRestaurantVelocity(client, restaurantId));
  // IDV gate enforces its own fail-closed behavior; it is not guarded here.
  await checkIdentityVerificationGate(client, { customerId, restaurantId, amountCents });
}

/**
 * Post-insert anomaly screen. Warn-only: logs signals, never blocks, and
 * fails open on any error. Call only for freshly created rows (not replays).
 */
async function screenPostCreateAnomalies(client, { customerId, restaurantId, amountCents, loadRequestId }) {
  try {
    const threshold = largeFirstRequestCents();
    const { rows: totalRows } = await client.query(
      `SELECT COUNT(*)::int AS count
         FROM food_customer_wallet_load_requests
        WHERE customer_id = $1`,
      [customerId]
    );
    const total = totalRows[0]?.count || 0;
    if (total <= 1 && Number(amountCents) > threshold) {
      await logFraudSignal(client, {
        signalType: 'large_first_request',
        customerId,
        restaurantId,
        loadRequestId,
        severity: 'warn',
        details: { amountCents: Number(amountCents), thresholdCents: threshold },
      });
    }

    const multiThreshold = multiRestaurantCountThreshold();
    const { rows: multiRows } = await client.query(
      `SELECT COUNT(DISTINCT restaurant_id)::int AS count
         FROM food_customer_wallet_load_requests
        WHERE customer_id = $1
          AND created_at >= NOW() - INTERVAL '1 hour'`,
      [customerId]
    );
    const distinctCount = multiRows[0]?.count || 0;
    if (distinctCount >= multiThreshold) {
      await logFraudSignal(client, {
        signalType: 'rapid_multi_restaurant',
        customerId,
        restaurantId,
        loadRequestId,
        severity: 'warn',
        details: { distinctRestaurants: distinctCount, threshold: multiThreshold, window: '1h' },
      });
    }
  } catch (err) {
    logger.error('foodCreditFraudService post-create anomaly screen failed (fail open)', {
      customerId,
      restaurantId,
      loadRequestId,
      error: err?.message,
    });
  }
}

module.exports = {
  logFraudSignal,
  checkCustomerVelocity,
  checkRestaurantVelocity,
  checkIdentityVerificationGate,
  screenLoadRequest,
  screenPostCreateAnomalies,
  maxRequestsPerCustomerPerDay,
  maxRequestsPerRestaurantPerDay,
  idvRequiredCents,
  largeFirstRequestCents,
  multiRestaurantCountThreshold,
};
