'use strict';

const NOTIFICATION_WORKER_NAME = 'oxsteed-credit-notification-outbox';
const HOLD_EXPIRY_WORKER_NAME = 'oxsteed-credit-hold-expiry';
const ENTITLEMENT_EXPIRY_WORKER_NAME = 'oxsteed-credit-entitlement-expiry';
const RECONCILIATION_WORKER_NAME = 'oxsteed-credit-reconciliation';
const EXTERNAL_RECONCILIATION_WORKER_NAME = 'oxsteed-credit-external-reconciliation';
const COMPLIANCE_MONITOR_WORKER_NAME = 'oxsteed-credit-compliance-monitor';
const SETTLEMENT_CYCLE_WORKER_NAME = 'oxsteed-credit-settlement-cycle';
const INTEGRITY_WORKER_NAME = 'oxsteed-credit-integrity';
const RESTAURANT_WALLET_WATCHDOG_NAME = 'restaurant-credit-wallet-watchdog';
const STALE_AFTER_MINUTES = 10;
const DAILY_WORKER_STALE_AFTER_MINUTES = 48 * 60;
const NOTIFICATION_BACKLOG_STALE_AFTER_MINUTES = 15;

const WORKER_CONFIG = Object.freeze([
  { jobName: NOTIFICATION_WORKER_NAME, label: 'notification worker', staleAfterMinutes: STALE_AFTER_MINUTES },
  { jobName: HOLD_EXPIRY_WORKER_NAME, label: 'hold expiry worker', staleAfterMinutes: STALE_AFTER_MINUTES },
  { jobName: ENTITLEMENT_EXPIRY_WORKER_NAME, label: 'entitlement expiry worker', staleAfterMinutes: STALE_AFTER_MINUTES },
  { jobName: RECONCILIATION_WORKER_NAME, label: 'reconciliation worker', staleAfterMinutes: DAILY_WORKER_STALE_AFTER_MINUTES },
  { jobName: EXTERNAL_RECONCILIATION_WORKER_NAME, label: 'external reconciliation worker', staleAfterMinutes: DAILY_WORKER_STALE_AFTER_MINUTES },
  { jobName: COMPLIANCE_MONITOR_WORKER_NAME, label: 'compliance monitor worker', staleAfterMinutes: DAILY_WORKER_STALE_AFTER_MINUTES },
  { jobName: SETTLEMENT_CYCLE_WORKER_NAME, label: 'settlement cycle worker', staleAfterMinutes: DAILY_WORKER_STALE_AFTER_MINUTES },
  { jobName: INTEGRITY_WORKER_NAME, label: 'integrity worker', staleAfterMinutes: DAILY_WORKER_STALE_AFTER_MINUTES },
  { jobName: RESTAURANT_WALLET_WATCHDOG_NAME, label: 'restaurant wallet watchdog', staleAfterMinutes: STALE_AFTER_MINUTES },
]);

function sqlQuotedList(values) {
  return values.map((value) => `'${String(value).replace(/'/g, "''")}'`).join(', ');
}

const WORKER_NAMES_SQL = sqlQuotedList(WORKER_CONFIG.map(({ jobName }) => jobName));
const FAST_WORKER_NAMES_SQL = sqlQuotedList(WORKER_CONFIG
  .filter(({ staleAfterMinutes }) => staleAfterMinutes === STALE_AFTER_MINUTES)
  .map(({ jobName }) => jobName));

module.exports = {
  NOTIFICATION_WORKER_NAME,
  HOLD_EXPIRY_WORKER_NAME,
  ENTITLEMENT_EXPIRY_WORKER_NAME,
  RECONCILIATION_WORKER_NAME,
  EXTERNAL_RECONCILIATION_WORKER_NAME,
  SETTLEMENT_CYCLE_WORKER_NAME,
  INTEGRITY_WORKER_NAME,
  RESTAURANT_WALLET_WATCHDOG_NAME,
  COMPLIANCE_MONITOR_WORKER_NAME,
  STALE_AFTER_MINUTES,
  DAILY_WORKER_STALE_AFTER_MINUTES,
  NOTIFICATION_BACKLOG_STALE_AFTER_MINUTES,
  WORKER_CONFIG,
  WORKER_NAMES_SQL,
  FAST_WORKER_NAMES_SQL,
};
