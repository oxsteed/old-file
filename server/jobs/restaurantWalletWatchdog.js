'use strict';

const cron = require('node-cron');
const db = require('../db');
const logger = require('../utils/logger');
const incidentStore = require('../services/incidentStore');
const { withJobLock } = require('./jobLockingService');
const { recordOxsteedCreditWorkerRun } = require('../services/oxsteedCreditWorkerHeartbeat');

const JOB_NAME = 'restaurant-credit-wallet-watchdog';
const CRON_EXPRESSION = '55 */5 * * * *';
const CRON_TIMEZONE = 'UTC';
const PENDING_PAYMENT_STALE_MINUTES = 15;
const FAILED_PAYMENT_WINDOW_MINUTES = 15;

const INCIDENT_KEYS = Object.freeze({
  staleQrSessions: 'restaurant-credit-wallet:stale-qr-sessions',
  pendingPayments: 'restaurant-credit-wallet:pending-pos-payments',
  failedPayments: 'restaurant-credit-wallet:failed-pos-payments',
  reservationDrift: 'restaurant-credit-wallet:reservation-drift',
  balanceDrift: 'restaurant-credit-wallet:balance-drift',
  integrityLocks: 'restaurant-credit-wallet:integrity-locks',
  watchdogFailure: 'restaurant-credit-wallet:watchdog-failed',
});

function numberValue(value) {
  return Number(value || 0);
}

function checkDetails(row, fields = []) {
  return fields.reduce((details, field) => {
    details[field] = numberValue(row?.[field]);
    return details;
  }, {});
}

async function inspectRestaurantWalletOperations() {
  const [qrResult, pendingResult, failedResult, reservationResult, balanceResult, integrityLockResult] = await Promise.all([
    db.query(
      `SELECT COUNT(*)::int AS stale_count,
              COALESCE(SUM(amount_cents), 0)::bigint AS stale_amount_cents,
              MIN(expires_at) AS oldest_expires_at
         FROM food_wallet_payment_sessions
        WHERE status = 'active'
          AND expires_at <= NOW()`
    ),
    db.query(
      `SELECT COUNT(*)::int AS pending_count,
              COALESCE(SUM(amount_cents), 0)::bigint AS pending_amount_cents,
              MIN(created_at) AS oldest_created_at
         FROM restaurant_pos_payments
        WHERE status = 'pending'
          AND (payment_type = 'wallet_credit'
            OR (payment_type = 'refund' AND provider = 'food_wallet'))
          AND created_at <= NOW() - ($1::integer * INTERVAL '1 minute')`,
      [PENDING_PAYMENT_STALE_MINUTES]
    ),
    db.query(
      `SELECT COUNT(*)::int AS failed_count,
              COALESCE(SUM(amount_cents), 0)::bigint AS failed_amount_cents,
              MAX(created_at) AS last_failed_at
         FROM restaurant_pos_payments
        WHERE status = 'failed'
          AND (payment_type = 'wallet_credit'
            OR (payment_type = 'refund' AND provider = 'food_wallet'))
          AND created_at >= NOW() - ($1::integer * INTERVAL '1 minute')`,
      [FAILED_PAYMENT_WINDOW_MINUTES]
    ),
    db.query(
      `SELECT COUNT(*) FILTER (
                WHERE a.reserved_cents IS DISTINCT FROM COALESCE(h.active_hold_cents, 0)
              )::int AS drift_count,
              COALESCE(SUM(ABS(a.reserved_cents - COALESCE(h.active_hold_cents, 0))) FILTER (
                WHERE a.reserved_cents IS DISTINCT FROM COALESCE(h.active_hold_cents, 0)
              ), 0)::bigint AS drift_amount_cents
         FROM food_customer_wallet_accounts a
         LEFT JOIN (
           SELECT account_id, COALESCE(SUM(amount_cents), 0)::bigint AS active_hold_cents
             FROM food_customer_wallet_holds
            WHERE status = 'active'
            GROUP BY account_id
         ) h ON h.account_id = a.id`
    ),
    db.query(
      `SELECT COUNT(*) FILTER (
                WHERE a.balance_cents IS DISTINCT FROM COALESCE(last_entry.balance_after_cents, 0)
              )::int AS drift_count,
              COALESCE(SUM(ABS(a.balance_cents - COALESCE(last_entry.balance_after_cents, 0))) FILTER (
                WHERE a.balance_cents IS DISTINCT FROM COALESCE(last_entry.balance_after_cents, 0)
              ), 0)::bigint AS drift_amount_cents
         FROM food_customer_wallet_accounts a
         LEFT JOIN LATERAL (
           SELECT l.balance_after_cents
             FROM food_customer_wallet_ledger l
            WHERE l.account_id = a.id
            ORDER BY l.created_at DESC, l.id DESC
            LIMIT 1
         ) last_entry ON TRUE`
    ),
    db.query(
      `SELECT COUNT(*)::int AS lock_count,
              MAX(created_at) AS last_locked_at
         FROM food_customer_wallet_operator_audit_events
        WHERE action_type = 'wallet_integrity_failed_lock'
          AND created_at >= NOW() - ($1::integer * INTERVAL '1 minute')`,
      [FAILED_PAYMENT_WINDOW_MINUTES]
    ),
  ]);

  const qr = qrResult.rows[0] || {};
  const pending = pendingResult.rows[0] || {};
  const failed = failedResult.rows[0] || {};
  const reservation = reservationResult.rows[0] || {};
  const balance = balanceResult.rows[0] || {};
  const integrityLocks = integrityLockResult.rows[0] || {};
  const checks = {
    staleQrSessions: {
      count: numberValue(qr.stale_count),
      amountCents: numberValue(qr.stale_amount_cents),
      oldestExpiresAt: qr.oldest_expires_at || null,
    },
    pendingPosPayments: {
      count: numberValue(pending.pending_count),
      amountCents: numberValue(pending.pending_amount_cents),
      oldestCreatedAt: pending.oldest_created_at || null,
      staleAfterMinutes: PENDING_PAYMENT_STALE_MINUTES,
    },
    failedPosPayments: {
      count: numberValue(failed.failed_count),
      amountCents: numberValue(failed.failed_amount_cents),
      lastFailedAt: failed.last_failed_at || null,
      windowMinutes: FAILED_PAYMENT_WINDOW_MINUTES,
    },
    reservationDrift: checkDetails(reservation, ['drift_count', 'drift_amount_cents']),
    balanceDrift: checkDetails(balance, ['drift_count', 'drift_amount_cents']),
    integrityLocks: {
      count: numberValue(integrityLocks.lock_count),
      lastLockedAt: integrityLocks.last_locked_at || null,
      windowMinutes: FAILED_PAYMENT_WINDOW_MINUTES,
    },
  };

  const incidentInputs = [
    {
      key: INCIDENT_KEYS.staleQrSessions,
      active: checks.staleQrSessions.count > 0,
      type: 'restaurant_credit_stale_qr_sessions',
      message: 'Restaurant credit has active QR payment sessions past their expiry time',
      details: checks.staleQrSessions,
    },
    {
      key: INCIDENT_KEYS.pendingPayments,
      active: checks.pendingPosPayments.count > 0,
      type: 'restaurant_credit_pending_pos_payments',
      message: 'Restaurant credit POS payments are pending beyond the reconciliation threshold',
      details: checks.pendingPosPayments,
    },
    {
      key: INCIDENT_KEYS.failedPayments,
      active: checks.failedPosPayments.count > 0,
      type: 'restaurant_credit_failed_pos_payments',
      message: 'Restaurant credit POS payments have failed recently',
      details: checks.failedPosPayments,
    },
    {
      key: INCIDENT_KEYS.reservationDrift,
      active: checks.reservationDrift.drift_count > 0,
      type: 'restaurant_credit_reservation_drift',
      message: 'Restaurant credit reserved balances do not match active wallet holds',
      details: checks.reservationDrift,
    },
    {
      key: INCIDENT_KEYS.balanceDrift,
      active: checks.balanceDrift.drift_count > 0,
      type: 'restaurant_credit_balance_drift',
      message: 'Restaurant credit account balances do not match the latest wallet ledger entries',
      details: checks.balanceDrift,
    },
    {
      key: INCIDENT_KEYS.integrityLocks,
      active: checks.integrityLocks.count > 0,
      type: 'restaurant_credit_wallet_integrity_lock',
      message: 'Restaurant credit wallets were locked after an integrity failure',
      details: checks.integrityLocks,
    },
  ];
  const incidents = [];
  for (const input of incidentInputs) {
    if (!input.active) continue;
    incidents.push(await incidentStore.recordIncident({
      type: input.type,
      severity: 'critical',
      message: input.message,
      dedupeKey: input.key,
      details: input.details,
    }));
  }
  const recoveredIncidents = await incidentStore.resolveOpenIncidentsByDedupeKeys(
    [
      ...incidentInputs.filter((input) => !input.active).map((input) => input.key),
      INCIDENT_KEYS.watchdogFailure,
    ],
    'Auto-resolved after restaurant credit wallet operations returned to a healthy state.',
  );

  return {
    status: incidents.length ? 'attention' : 'healthy',
    checks,
    incidents,
    recoveredIncidents,
  };
}

async function runRestaurantWalletWatchdog() {
  let locked = false;
  let result = { status: 'skipped', checks: null, incidents: [], recoveredIncidents: [] };
  try {
    await withJobLock(JOB_NAME, async () => {
      locked = true;
      result = await inspectRestaurantWalletOperations();
    }, 120, { throwOnLockError: true });
  } catch (error) {
    const incident = await incidentStore.recordIncident({
      type: 'restaurant_credit_wallet_watchdog_failed',
      severity: 'critical',
      message: 'Restaurant credit wallet watchdog could not complete',
      dedupeKey: INCIDENT_KEYS.watchdogFailure,
      details: { error: error.message },
    });
    logger.error('Restaurant credit wallet watchdog failed', { error: error.message });
    result = {
      status: 'error',
      checks: null,
      incidents: [incident],
      recoveredIncidents: [],
      error: error.message,
    };
  }
  if (locked) {
    await recordOxsteedCreditWorkerRun({
      jobName: JOB_NAME,
      result: { status: result.status, incidentCount: result.incidents.length },
      error: result.status === 'error' ? new Error(result.error || 'Wallet watchdog failed') : null,
    });
  }
  return { locked, ...result };
}

function startRestaurantWalletWatchdog() {
  cron.schedule(CRON_EXPRESSION, () => {
    runRestaurantWalletWatchdog().catch((error) => {
      logger.error('Restaurant credit wallet watchdog failed unexpectedly', { error: error.message });
    });
  }, { timezone: CRON_TIMEZONE });
  logger.info('Restaurant credit wallet watchdog scheduled', {
    cron: CRON_EXPRESSION,
    timezone: CRON_TIMEZONE,
  });
}

module.exports = {
  JOB_NAME,
  CRON_EXPRESSION,
  CRON_TIMEZONE,
  PENDING_PAYMENT_STALE_MINUTES,
  FAILED_PAYMENT_WINDOW_MINUTES,
  INCIDENT_KEYS,
  inspectRestaurantWalletOperations,
  runRestaurantWalletWatchdog,
  startRestaurantWalletWatchdog,
};
