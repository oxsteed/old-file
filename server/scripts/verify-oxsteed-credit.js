#!/usr/bin/env node
/**
 * Verifies the OxSteed Credit migration and ledger invariants against the
 * configured database. It is safe to run repeatedly and never mutates data.
 * Usage: DATABASE_URL=... node server/scripts/verify-oxsteed-credit.js
 */
'use strict';

require('dotenv').config();
const { Pool } = require('pg');
const {
  computeEntryHash,
  SUPPORTED_CREDIT_CURRENCIES,
  getCreditRailPrerequisites,
} = require('../services/oxsteedCreditService');
const { getProductionConfigurationErrors } = require('../utils/validateEnv');

const REQUIRED_TABLES = [
  'oxsteed_credit_partners',
  'oxsteed_credit_partner_agreements',
  'oxsteed_credit_customer_entitlements',
  'oxsteed_credit_accounts',
  'oxsteed_credit_transactions',
  'oxsteed_credit_transaction_entries',
  'oxsteed_credit_holds',
  'oxsteed_credit_settlements',
  'oxsteed_credit_reconciliation_runs',
  'oxsteed_credit_audit_events',
  'oxsteed_credit_disputes',
  'oxsteed_credit_partner_ledgers',
  'oxsteed_credit_partner_funding_records',
  'oxsteed_credit_entitlement_bulk_requests',
  'oxsteed_credit_entitlement_requests',
  'oxsteed_credit_notification_outbox',
  'oxsteed_credit_worker_heartbeats',
  'cron_job_locks',
  'food_customer_wallet_accounts',
  'food_customer_wallet_ledger',
  'food_customer_wallet_holds',
  'food_customer_wallet_transfers',
  'food_wallet_payment_sessions',
  'food_customer_wallet_operator_audit_events',
  'restaurant_pos_payments',
  'restaurant_pos_receipt_events',
  'incident_log',
];

const REQUIRED_COLUMNS = {
  oxsteed_credit_accounts: ['balance_cents', 'reserved_cents', 'ledger_version', 'last_entry_hash'],
  oxsteed_credit_audit_events: ['previous_event_hash', 'event_hash'],
  oxsteed_credit_transactions: [
    'idempotency_key',
    'posted_at',
    'partner_id',
    'agreement_id',
    'reason',
    'actor_owner_evidence_legacy',
    'purchase_reference_evidence_legacy',
    'restaurant_staff_evidence_legacy',
    'purchase_reference_uniqueness_legacy',
    'purchase_actor_evidence_legacy',
  ],
  oxsteed_credit_transaction_entries: ['entry_hash', 'previous_entry_hash', 'sequence', 'hash_key_version'],
  oxsteed_credit_holds: [
    'capture_idempotency_key',
    'expires_at',
    'capture_actor_type',
    'captured_by',
    'capture_reason',
    'release_actor_type',
    'released_by',
    'release_reason',
    'terminal_evidence_legacy',
    'actor_evidence_legacy',
  ],
  oxsteed_credit_partner_agreements: ['creation_idempotency_key', 'creation_request_hash', 'requires_customer_entitlement'],
  oxsteed_credit_settlements: ['created_by', 'creation_reason', 'creation_request_hash'],
  oxsteed_credit_disputes: ['idempotency_key', 'actor_evidence_legacy'],
  oxsteed_credit_partner_ledgers: ['partner_id', 'ledger_code', 'currency_code', 'payable_account_id', 'reserve_account_id', 'status'],
  oxsteed_credit_partner_funding_records: ['partner_ledger_id', 'partner_id', 'reserve_account_id', 'transaction_id', 'direction', 'amount_cents', 'currency_code', 'external_reference', 'idempotency_key', 'reason'],
  oxsteed_credit_entitlement_bulk_requests: ['request_hash', 'customer_id', 'agreement_ids', 'response_payload'],
  oxsteed_credit_entitlement_requests: ['request_hash', 'customer_id', 'agreement_id', 'response_payload'],
  oxsteed_credit_notification_outbox: ['transaction_id', 'hold_id', 'user_id', 'event_type', 'payload', 'status', 'attempts', 'next_attempt_at'],
  oxsteed_credit_worker_heartbeats: ['last_run_at', 'last_success_at', 'last_error', 'last_result', 'run_count', 'consecutive_failures', 'updated_at'],
  cron_job_locks: ['lock_id', 'lock_value', 'acquired_at', 'expires_at'],
  food_customer_wallet_accounts: ['balance_cents', 'reserved_cents', 'ledger_version', 'last_entry_hash', 'currency_code', 'status'],
  food_customer_wallet_ledger: ['account_id', 'amount_cents', 'balance_after_cents', 'currency_code', 'entry_type', 'created_at'],
  food_customer_wallet_holds: ['account_id', 'amount_cents', 'status', 'expires_at', 'currency_code'],
  food_customer_wallet_transfers: ['sender_account_id', 'recipient_account_id', 'amount_cents', 'status', 'currency_code', 'idempotency_key'],
  food_wallet_payment_sessions: ['status', 'expires_at', 'amount_cents', 'currency_code', 'wallet_hold_id'],
  food_customer_wallet_operator_audit_events: ['action_type', 'created_at', 'wallet_account_id', 'currency_code'],
  restaurant_pos_payments: ['food_order_id', 'payment_type', 'amount_cents', 'status', 'provider', 'idempotency_key', 'created_at'],
  restaurant_pos_receipt_events: ['event_type', 'payment_status', 'total_cents', 'created_at'],
  incident_log: ['type', 'severity', 'dedupe_key', 'resolved_at', 'last_seen_at'],
};

const REQUIRED_INDEXES = [
  'idx_oxsteed_credit_holds_idempotency',
  'idx_oxsteed_credit_holds_customer_agreement_active',
  'uq_oxsteed_credit_one_active_agreement',
  'idx_oxsteed_credit_transactions_partner_reporting',
  'idx_oxsteed_credit_transactions_debit_posted_history',
  'idx_oxsteed_credit_transactions_credit_posted_history',
  'uq_oxsteed_credit_food_order_purchase_reference',
  'uq_oxsteed_credit_agreement_creation_idempotency',
  'idx_oxsteed_credit_disputes_customer_history',
  'idx_oxsteed_credit_disputes_status_history',
  'uq_oxsteed_credit_dispute_idempotency',
  'idx_oxsteed_credit_entitlement_bulk_requests_customer',
  'idx_oxsteed_credit_entitlement_requests_customer',
  'idx_oxsteed_credit_entitlement_requests_agreement',
  'idx_oxsteed_credit_notification_outbox_due',
  'idx_oxsteed_credit_notification_outbox_user',
  'idx_oxsteed_credit_notification_outbox_sent_retention',
  'idx_oxsteed_credit_notification_outbox_pending_due',
  'idx_oxsteed_credit_notification_outbox_sending_lock',
  'idx_oxsteed_credit_notification_outbox_failed_history',
  'idx_oxsteed_credit_worker_heartbeats_last_run',
  'idx_food_wallet_payment_sessions_restaurant_status',
  'idx_food_wallet_holds_account_status',
  'idx_food_customer_wallet_ledger_sequence',
  'idx_food_customer_wallet_operator_audit_restaurant_created',
  'idx_restaurant_pos_payments_order',
  'idx_oxsteed_credit_transactions_debit_velocity',
  'idx_oxsteed_credit_holds_customer_currency_active',
  'idx_oxsteed_credit_audit_action_created',
  'idx_oxsteed_credit_audit_resource_created',
  'idx_oxsteed_credit_audit_correlation',
  'uq_oxsteed_credit_hold_notification',
  'uq_oxsteed_credit_audit_event_hash',
  'idx_oxsteed_credit_partner_ledgers_status',
  'idx_oxsteed_credit_partner_funding_ledger',
  'idx_oxsteed_credit_partner_funding_partner',
  'uq_oxsteed_credit_partner_reserve_account',
];

const REQUIRED_INTEGRITY_TRIGGERS = [
  'oxsteed_credit_transaction_account_guard',
  'oxsteed_credit_transaction_currency_guard',
  'oxsteed_credit_transaction_entries_guard',
  'oxsteed_credit_transaction_immutable_guard',
  'oxsteed_credit_entry_immutable_guard',
  'oxsteed_credit_transaction_type_guard',
  'oxsteed_credit_hold_integrity_guard',
  'oxsteed_credit_account_integrity_guard',
  'oxsteed_credit_settlement_integrity_guard',
  'oxsteed_credit_settlement_state_guard',
  'oxsteed_credit_settlement_immutability_guard',
  'oxsteed_credit_audit_immutable_guard',
  'oxsteed_credit_account_identity_guard',
  'oxsteed_credit_partner_identity_guard',
  'oxsteed_credit_agreement_identity_guard',
  'oxsteed_credit_transaction_partner_account_guard',
  'oxsteed_credit_purchase_boundary_guard',
  'oxsteed_credit_agreement_terms_guard',
  'oxsteed_credit_user_role_guard',
  'oxsteed_credit_customer_owner_guard',
  'oxsteed_credit_entitlement_owner_guard',
  'oxsteed_credit_transaction_customer_owner_guard',
  'oxsteed_credit_transaction_customer_activity_guard',
  'oxsteed_credit_transaction_spend_account_state_guard',
  'oxsteed_credit_hold_customer_activity_guard',
  'oxsteed_credit_hold_account_state_guard',
  'oxsteed_credit_hold_lifecycle_guard',
  'oxsteed_credit_issuance_trace_guard',
  'oxsteed_credit_dispute_integrity_guard',
  'oxsteed_credit_settlement_payment_evidence_guard',
  'oxsteed_credit_transaction_settlement_evidence_guard',
  'oxsteed_credit_admin_refund_evidence_guard',
  'oxsteed_credit_hold_immutable_guard',
  'oxsteed_credit_account_reservation_guard',
  'oxsteed_credit_hold_reservation_guard',
  'oxsteed_credit_transaction_status_guard',
  'oxsteed_credit_posted_entry_guard',
  'oxsteed_credit_audit_hash_chain_guard',
  'oxsteed_credit_settlement_creation_evidence_guard',
  'oxsteed_credit_entitlement_bulk_request_immutable_guard',
  'oxsteed_credit_entitlement_request_immutable_guard',
  'oxsteed_credit_entitlement_customer_activity_guard',
  'oxsteed_credit_refund_boundary_guard',
  'oxsteed_credit_transaction_actor_identity_guard',
  'oxsteed_credit_user_activity_guard',
  'oxsteed_credit_agreement_state_guard',
  'oxsteed_credit_partner_status_guard',
  'oxsteed_credit_agreement_approval_guard',
  'oxsteed_credit_account_state_guard',
  'oxsteed_credit_restaurant_status_guard',
  'oxsteed_credit_settlement_approval_guard',
  'oxsteed_credit_issuance_actor_evidence_guard',
  'oxsteed_credit_partner_creator_guard',
  'oxsteed_credit_agreement_creator_guard',
  'oxsteed_credit_entitlement_creator_guard',
  'oxsteed_credit_settlement_creator_guard',
  'oxsteed_credit_settlement_overlap_guard',
  'oxsteed_credit_settlement_reference_guard',
  'oxsteed_credit_account_ledger_write_guard',
  'oxsteed_credit_hold_terminal_evidence_guard',
  'oxsteed_credit_dispute_actor_evidence_guard',
  'oxsteed_credit_hold_actor_evidence_guard',
  'oxsteed_credit_transaction_actor_owner_guard',
  'oxsteed_credit_purchase_reference_guard',
  'oxsteed_credit_restaurant_staff_evidence_guard',
  'oxsteed_credit_purchase_reference_uniqueness_guard',
  'oxsteed_credit_purchase_actor_evidence_guard',
  'oxsteed_credit_entitlement_agreement_state_guard',
  'oxsteed_credit_agreement_entitlement_status_guard',
  'oxsteed_credit_notification_outbox_source_guard',
  'oxsteed_credit_hold_notification_outbox_guard',
  'oxsteed_credit_partner_ledger_guard',
  'oxsteed_credit_partner_funding_guard',
];

function verifyEntryHashes(entries, accounts, hashFn = computeEntryHash) {
  const stateByAccount = new Map();
  let invalidEntryHashes = 0;
  let invalidHashChains = 0;

  for (const entry of entries) {
    const accountId = String(entry.account_id);
    const previous = stateByAccount.get(accountId) || { sequence: 0, hash: null };
    const sequence = Number(entry.sequence);
    const previousHash = entry.previous_entry_hash || null;
    if (sequence !== previous.sequence + 1 || previousHash !== previous.hash) invalidHashChains += 1;

    const expectedHash = hashFn({
      transactionId: String(entry.transaction_id),
      transactionType: entry.transaction_type,
      accountId: Number(entry.account_id),
      entrySide: entry.entry_side,
      amountCents: Number(entry.amount_cents),
      balanceAfterCents: Number(entry.balance_after_cents),
      currencyCode: String(entry.currency_code || 'USD').toUpperCase(),
      sequence,
      previousEntryHash: previousHash,
      metadata: entry.metadata && typeof entry.metadata === 'object' ? entry.metadata : {},
    }, entry.hash_key_version || 'v1');
    if (!entry.entry_hash || entry.entry_hash !== expectedHash) invalidEntryHashes += 1;
    stateByAccount.set(accountId, { sequence, hash: entry.entry_hash || null });
  }

  let invalidAccountHashHeads = 0;
  for (const account of accounts) {
    const last = stateByAccount.get(String(account.id)) || { sequence: 0, hash: null };
    if (Number(account.ledger_version || 0) !== last.sequence || (account.last_entry_hash || null) !== last.hash) {
      invalidAccountHashHeads += 1;
    }
  }
  return { invalidEntryHashes, invalidHashChains, invalidAccountHashHeads };
}

function findUnsupportedCurrencyRecords(rows, supportedCurrencies = SUPPORTED_CREDIT_CURRENCIES) {
  const supported = new Set(supportedCurrencies);
  return rows
    .map((row) => ({
      resourceType: row.resource_type,
      currencyCode: String(row.currency_code || '').trim().toUpperCase(),
    }))
    .filter((row) => row.currencyCode && !supported.has(row.currencyCode));
}

async function main() {
  if ((process.env.NODE_ENV || 'production') === 'production') {
    const productionConfigurationErrors = getProductionConfigurationErrors();
    if (productionConfigurationErrors.length > 0) {
      console.error(`verify-oxsteed-credit: unsafe production configuration: ${productionConfigurationErrors.join('; ')}`);
      process.exitCode = 1;
      return;
    }
    const prerequisites = getCreditRailPrerequisites();
    if (!prerequisites.readyForProductionActivation) {
      const missing = [
        !prerequisites.sharedRedisConfigured && 'REDIS_URL',
        !prerequisites.dedicatedLedgerSecretConfigured && 'OXSTEED_CREDIT_LEDGER_HMAC_SECRET',
        !prerequisites.ledgerKeyConfigurationValid && 'ledger key rotation configuration',
        !prerequisites.serverErrorMonitoringConfigured && 'SENTRY_DSN with SENTRY_ENABLED not false',
      ].filter(Boolean);
      console.error(`verify-oxsteed-credit: production prerequisites missing: ${missing.join(', ')}`);
      process.exitCode = 1;
      return;
    }
  }
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('verify-oxsteed-credit: DATABASE_URL is not set.');
    process.exitCode = 1;
    return;
  }

  const pool = new Pool({
    connectionString,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  });

  try {
    const checks = {};
    const { rows: migrationRows } = await pool.query(
      `SELECT 1 FROM _migrations WHERE filename = $1 LIMIT 1`,
      ['421_oxsteed_credit_foundation.sql']
    );
    checks.foundationMigrationApplied = migrationRows.length === 1;
    const { rows: emergencyMigrationRows } = await pool.query(
      `SELECT 1 FROM _migrations WHERE filename = $1 LIMIT 1`,
      ['422_oxsteed_credit_emergency_controls.sql']
    );
    checks.emergencyMigrationApplied = emergencyMigrationRows.length === 1;
    const { rows: integrityMigrationRows } = await pool.query(
      `SELECT 1 FROM _migrations WHERE filename = $1 LIMIT 1`,
      ['424_oxsteed_credit_database_integrity.sql']
    );
    checks.databaseIntegrityMigrationApplied = integrityMigrationRows.length === 1;
    const { rows: immutabilityMigrationRows } = await pool.query(
      `SELECT 1 FROM _migrations WHERE filename = $1 LIMIT 1`,
      ['425_oxsteed_credit_transaction_immutability.sql']
    );
    checks.transactionImmutabilityMigrationApplied = immutabilityMigrationRows.length === 1;
    const { rows: holdIntegrityMigrationRows } = await pool.query(
      `SELECT 1 FROM _migrations WHERE filename = $1 LIMIT 1`,
      ['426_oxsteed_credit_hold_integrity.sql']
    );
    checks.holdIntegrityMigrationApplied = holdIntegrityMigrationRows.length === 1;
    const { rows: accountIntegrityMigrationRows } = await pool.query(
      `SELECT 1 FROM _migrations WHERE filename = $1 LIMIT 1`,
      ['427_oxsteed_credit_account_integrity.sql']
    );
    checks.accountIntegrityMigrationApplied = accountIntegrityMigrationRows.length === 1;
    const { rows: transactionCurrencyMigrationRows } = await pool.query(
      `SELECT 1 FROM _migrations WHERE filename = $1 LIMIT 1`,
      ['428_oxsteed_credit_transaction_currency_integrity.sql']
    );
    checks.transactionCurrencyIntegrityMigrationApplied = transactionCurrencyMigrationRows.length === 1;
    const { rows: settlementIntegrityMigrationRows } = await pool.query(
      `SELECT 1 FROM _migrations WHERE filename = $1 LIMIT 1`,
      ['429_oxsteed_credit_settlement_integrity.sql']
    );
    checks.settlementIntegrityMigrationApplied = settlementIntegrityMigrationRows.length === 1;
    const { rows: entryImmutabilityMigrationRows } = await pool.query(
      `SELECT 1 FROM _migrations WHERE filename = $1 LIMIT 1`,
      ['430_oxsteed_credit_entry_immutability.sql']
    );
    checks.entryImmutabilityMigrationApplied = entryImmutabilityMigrationRows.length === 1;
    const { rows: auditImmutabilityMigrationRows } = await pool.query(
      `SELECT 1 FROM _migrations WHERE filename = $1 LIMIT 1`,
      ['431_oxsteed_credit_audit_immutability.sql']
    );
    checks.auditImmutabilityMigrationApplied = auditImmutabilityMigrationRows.length === 1;
    const { rows: transactionTypeMigrationRows } = await pool.query(
      `SELECT 1 FROM _migrations WHERE filename = $1 LIMIT 1`,
      ['432_oxsteed_credit_transaction_type_integrity.sql']
    );
    checks.transactionTypeIntegrityMigrationApplied = transactionTypeMigrationRows.length === 1;
    const { rows: identityStabilityMigrationRows } = await pool.query(
      `SELECT 1 FROM _migrations WHERE filename = $1 LIMIT 1`,
      ['433_oxsteed_credit_identity_stability.sql']
    );
    checks.identityStabilityMigrationApplied = identityStabilityMigrationRows.length === 1;
    const { rows: settlementStateMigrationRows } = await pool.query(
      `SELECT 1 FROM _migrations WHERE filename = $1 LIMIT 1`,
      ['434_oxsteed_credit_settlement_state.sql']
    );
    checks.settlementStateMigrationApplied = settlementStateMigrationRows.length === 1;
    const { rows: holdIdempotencyMigrationRows } = await pool.query(
      `SELECT 1 FROM _migrations WHERE filename = $1 LIMIT 1`,
      ['436_oxsteed_credit_hold_idempotency_index.sql']
    );
    checks.holdIdempotencyMigrationApplied = holdIdempotencyMigrationRows.length === 1;
    const { rows: activeHoldLookupMigrationRows } = await pool.query(
      `SELECT 1 FROM _migrations WHERE filename = $1 LIMIT 1`,
      ['437_oxsteed_credit_active_hold_lookup.sql']
    );
    checks.activeHoldLookupMigrationApplied = activeHoldLookupMigrationRows.length === 1;
    const { rows: partnerAccountIntegrityMigrationRows } = await pool.query(
      `SELECT 1 FROM _migrations WHERE filename = $1 LIMIT 1`,
      ['438_oxsteed_credit_partner_account_integrity.sql']
    );
    checks.partnerAccountIntegrityMigrationApplied = partnerAccountIntegrityMigrationRows.length === 1;
    const { rows: activeAgreementMigrationRows } = await pool.query(
      `SELECT 1 FROM _migrations WHERE filename = $1 LIMIT 1`,
      ['439_oxsteed_credit_one_active_agreement.sql']
    );
    checks.activeAgreementMigrationApplied = activeAgreementMigrationRows.length === 1;
    const { rows: customerOwnerMigrationRows } = await pool.query(
      `SELECT 1 FROM _migrations WHERE filename = $1 LIMIT 1`,
      ['440_oxsteed_credit_customer_owner_guard.sql']
    );
    checks.customerOwnerMigrationApplied = customerOwnerMigrationRows.length === 1;
    const { rows: entitlementOwnerMigrationRows } = await pool.query(
      `SELECT 1 FROM _migrations WHERE filename = $1 LIMIT 1`,
      ['441_oxsteed_credit_entitlement_owner_guard.sql']
    );
    checks.entitlementOwnerMigrationApplied = entitlementOwnerMigrationRows.length === 1;
    const { rows: currentOwnerMigrationRows } = await pool.query(
      `SELECT 1 FROM _migrations WHERE filename = $1 LIMIT 1`,
      ['442_oxsteed_credit_current_owner_integrity.sql']
    );
    checks.currentOwnerMigrationApplied = currentOwnerMigrationRows.length === 1;
    const { rows: partnerReportingMigrationRows } = await pool.query(
      `SELECT 1 FROM _migrations WHERE filename = $1 LIMIT 1`,
      ['443_oxsteed_credit_partner_reporting_index.sql']
    );
    checks.partnerReportingMigrationApplied = partnerReportingMigrationRows.length === 1;
    const { rows: agreementIdempotencyMigrationRows } = await pool.query(
      `SELECT 1 FROM _migrations WHERE filename = $1 LIMIT 1`,
      ['444_oxsteed_credit_agreement_idempotency.sql']
    );
    checks.agreementIdempotencyMigrationApplied = agreementIdempotencyMigrationRows.length === 1;
    const { rows: entitlementRequiredMigrationRows } = await pool.query(
      `SELECT 1 FROM _migrations WHERE filename = $1 LIMIT 1`,
      ['445_oxsteed_credit_entitlement_required.sql']
    );
    checks.entitlementRequiredMigrationApplied = entitlementRequiredMigrationRows.length === 1;
    const { rows: settlementCreatorMigrationRows } = await pool.query(
      `SELECT 1 FROM _migrations WHERE filename = $1 LIMIT 1`,
      ['447_oxsteed_credit_settlement_creator.sql']
    );
    checks.settlementCreatorMigrationApplied = settlementCreatorMigrationRows.length === 1;
    const { rows: settlementImmutabilityMigrationRows } = await pool.query(
      `SELECT 1 FROM _migrations WHERE filename = $1 LIMIT 1`,
      ['448_oxsteed_credit_settlement_immutability.sql']
    );
    checks.settlementImmutabilityMigrationApplied = settlementImmutabilityMigrationRows.length === 1;
    const { rows: purchaseBoundaryMigrationRows } = await pool.query(
      `SELECT 1 FROM _migrations WHERE filename = $1 LIMIT 1`,
      ['449_oxsteed_credit_purchase_boundary.sql']
    );
    checks.purchaseBoundaryMigrationApplied = purchaseBoundaryMigrationRows.length === 1;
    const agreementTermsImmutabilityMigrationRows = await pool.query(
      `SELECT 1 FROM _migrations WHERE filename = $1 LIMIT 1`,
      ['450_oxsteed_credit_agreement_terms_immutability.sql']
    );
    checks.agreementTermsImmutabilityMigrationApplied = agreementTermsImmutabilityMigrationRows.rows.length === 1;
    const userRoleGuardMigrationRows = await pool.query(
      `SELECT 1 FROM _migrations WHERE filename = $1 LIMIT 1`,
      ['451_oxsteed_credit_user_role_guard.sql']
    );
    checks.userRoleGuardMigrationApplied = userRoleGuardMigrationRows.rows.length === 1;
    const disputeIntegrityMigrationRows = await pool.query(
      `SELECT 1 FROM _migrations WHERE filename = $1 LIMIT 1`,
      ['452_oxsteed_credit_dispute_integrity.sql']
    );
    checks.disputeIntegrityMigrationApplied = disputeIntegrityMigrationRows.rows.length === 1;
    const customerActivityMigrationRows = await pool.query(
      `SELECT 1 FROM _migrations WHERE filename = $1 LIMIT 1`,
      ['457_oxsteed_credit_customer_activity.sql']
    );
    checks.customerActivityMigrationApplied = customerActivityMigrationRows.rows.length === 1;
    const issuanceTraceMigrationRows = await pool.query(
      `SELECT 1 FROM _migrations WHERE filename = $1 LIMIT 1`,
      ['458_oxsteed_credit_issuance_trace.sql']
    );
    checks.issuanceTraceMigrationApplied = issuanceTraceMigrationRows.rows.length === 1;
    const holdLifecycleMigrationRows = await pool.query(
      `SELECT 1 FROM _migrations WHERE filename = $1 LIMIT 1`,
      ['459_oxsteed_credit_hold_lifecycle.sql']
    );
    checks.holdLifecycleMigrationApplied = holdLifecycleMigrationRows.rows.length === 1;
    const settlementPeriodMigrationRows = await pool.query(
      `SELECT 1 FROM _migrations WHERE filename = $1 LIMIT 1`,
      ['460_oxsteed_credit_settlement_period.sql']
    );
    checks.settlementPeriodMigrationApplied = settlementPeriodMigrationRows.rows.length === 1;
    const adjustmentDirectionMigrationRows = await pool.query(
      `SELECT 1 FROM _migrations WHERE filename = $1 LIMIT 1`,
      ['461_oxsteed_credit_adjustment_direction.sql']
    );
    checks.adjustmentDirectionMigrationApplied = adjustmentDirectionMigrationRows.rows.length === 1;
    const reservedTransactionTypesMigrationRows = await pool.query(
      `SELECT 1 FROM _migrations WHERE filename = $1 LIMIT 1`,
      ['462_oxsteed_credit_reserved_transaction_types.sql']
    );
    checks.reservedTransactionTypesMigrationApplied = reservedTransactionTypesMigrationRows.rows.length === 1;
    const disputeStatusEvidenceMigrationRows = await pool.query(
      `SELECT 1 FROM _migrations WHERE filename = $1 LIMIT 1`,
      ['463_oxsteed_credit_dispute_status_evidence.sql']
    );
    checks.disputeStatusEvidenceMigrationApplied = disputeStatusEvidenceMigrationRows.rows.length === 1;
    const reservationConsistencyMigrationRows = await pool.query(
      `SELECT 1 FROM _migrations WHERE filename = $1 LIMIT 1`,
      ['464_oxsteed_credit_reservation_consistency.sql']
    );
    checks.reservationConsistencyMigrationApplied = reservationConsistencyMigrationRows.rows.length === 1;
    const transactionStatusMigrationRows = await pool.query(
      `SELECT 1 FROM _migrations WHERE filename = $1 LIMIT 1`,
      ['465_oxsteed_credit_transaction_status.sql']
    );
    checks.transactionStatusMigrationApplied = transactionStatusMigrationRows.rows.length === 1;
    const settlementPaymentEvidenceMigrationRows = await pool.query(
      `SELECT 1 FROM _migrations WHERE filename = $1 LIMIT 1`,
      ['466_oxsteed_credit_settlement_payment_evidence.sql']
    );
    checks.settlementPaymentEvidenceMigrationApplied = settlementPaymentEvidenceMigrationRows.rows.length === 1;
    const auditHashChainMigrationRows = await pool.query(
      `SELECT 1 FROM _migrations WHERE filename = $1 LIMIT 1`,
      ['467_oxsteed_credit_audit_hash_chain.sql']
    );
    checks.auditHashChainMigrationApplied = auditHashChainMigrationRows.rows.length === 1;
    const adminRefundEvidenceMigrationRows = await pool.query(
      `SELECT 1 FROM _migrations WHERE filename = $1 LIMIT 1`,
      ['468_oxsteed_credit_admin_refund_evidence.sql']
    );
    checks.adminRefundEvidenceMigrationApplied = adminRefundEvidenceMigrationRows.rows.length === 1;
    const holdImmutabilityMigrationRows = await pool.query(
      `SELECT 1 FROM _migrations WHERE filename = $1 LIMIT 1`,
      ['469_oxsteed_credit_hold_immutability.sql']
    );
    checks.holdImmutabilityMigrationApplied = holdImmutabilityMigrationRows.rows.length === 1;
    const identityRetentionMigrationRows = await pool.query(
      `SELECT 1 FROM _migrations WHERE filename = $1 LIMIT 1`,
      ['474_oxsteed_credit_identity_retention.sql']
    );
    checks.identityRetentionMigrationApplied = identityRetentionMigrationRows.rows.length === 1;
    const idempotencyKeysMigrationRows = await pool.query(
      `SELECT 1 FROM _migrations WHERE filename = $1 LIMIT 1`,
      ['475_oxsteed_credit_idempotency_keys.sql']
    );
    checks.idempotencyKeysMigrationApplied = idempotencyKeysMigrationRows.rows.length === 1;
    const refundBoundaryMigrationRows = await pool.query(
      `SELECT 1 FROM _migrations WHERE filename = $1 LIMIT 1`,
      ['476_oxsteed_credit_refund_boundary.sql']
    );
    checks.refundBoundaryMigrationApplied = refundBoundaryMigrationRows.rows.length === 1;
    const actorIdentityMigrationRows = await pool.query(
      `SELECT 1 FROM _migrations WHERE filename = $1 LIMIT 1`,
      ['477_oxsteed_credit_actor_identity.sql']
    );
    checks.actorIdentityMigrationApplied = actorIdentityMigrationRows.rows.length === 1;
    const deactivationPolicyMigrationRows = await pool.query(
      `SELECT 1 FROM _migrations WHERE filename = $1 LIMIT 1`,
      ['478_oxsteed_credit_deactivation_policy.sql']
    );
    checks.deactivationPolicyMigrationApplied = deactivationPolicyMigrationRows.rows.length === 1;
    const agreementStateMigrationRows = await pool.query(
      `SELECT 1 FROM _migrations WHERE filename = $1 LIMIT 1`,
      ['479_oxsteed_credit_agreement_state.sql']
    );
    checks.agreementStateMigrationApplied = agreementStateMigrationRows.rows.length === 1;
    const agreementApprovalMigrationRows = await pool.query(
      `SELECT 1 FROM _migrations WHERE filename = $1 LIMIT 1`,
      ['480_oxsteed_credit_agreement_approval.sql']
    );
    checks.agreementApprovalMigrationApplied = agreementApprovalMigrationRows.rows.length === 1;
    const approvalHistoryMigrationRows = await pool.query(
      `SELECT 1 FROM _migrations WHERE filename = $1 LIMIT 1`,
      ['481_oxsteed_credit_approval_history.sql']
    );
    checks.approvalHistoryMigrationApplied = approvalHistoryMigrationRows.rows.length === 1;
    const accountStateMigrationRows = await pool.query(
      `SELECT 1 FROM _migrations WHERE filename = $1 LIMIT 1`,
      ['482_oxsteed_credit_account_state.sql']
    );
    checks.accountStateMigrationApplied = accountStateMigrationRows.rows.length === 1;
    const suspendedExpiryMigrationRows = await pool.query(
      `SELECT 1 FROM _migrations WHERE filename = $1 LIMIT 1`,
      ['483_oxsteed_credit_suspended_expiry.sql']
    );
    checks.suspendedExpiryMigrationApplied = suspendedExpiryMigrationRows.rows.length === 1;
    const partnerHoldReleaseMigrationRows = await pool.query(
      `SELECT 1 FROM _migrations WHERE filename = $1 LIMIT 1`,
      ['484_oxsteed_credit_partner_hold_release.sql']
    );
    checks.partnerHoldReleaseMigrationApplied = partnerHoldReleaseMigrationRows.rows.length === 1;
    const restaurantStatusMigrationRows = await pool.query(
      `SELECT 1 FROM _migrations WHERE filename = $1 LIMIT 1`,
      ['485_oxsteed_credit_restaurant_status.sql']
    );
    checks.restaurantStatusMigrationApplied = restaurantStatusMigrationRows.rows.length === 1;
    const settlementApprovalMigrationRows = await pool.query(
      `SELECT 1 FROM _migrations WHERE filename = $1 LIMIT 1`,
      ['486_oxsteed_credit_settlement_approval.sql']
    );
    checks.settlementApprovalMigrationApplied = settlementApprovalMigrationRows.rows.length === 1;
    const issuanceActorEvidenceMigrationRows = await pool.query(
      `SELECT 1 FROM _migrations WHERE filename = $1 LIMIT 1`,
      ['487_oxsteed_credit_issuance_actor_evidence.sql']
    );
    checks.issuanceActorEvidenceMigrationApplied = issuanceActorEvidenceMigrationRows.rows.length === 1;
    const adminProvenanceMigrationRows = await pool.query(
      `SELECT 1 FROM _migrations WHERE filename = $1 LIMIT 1`,
      ['488_oxsteed_credit_admin_provenance.sql']
    );
    checks.adminProvenanceMigrationApplied = adminProvenanceMigrationRows.rows.length === 1;
    const settlementOverlapMigrationRows = await pool.query(
      `SELECT 1 FROM _migrations WHERE filename = $1 LIMIT 1`,
      ['489_oxsteed_credit_settlement_overlap.sql']
    );
    checks.settlementOverlapMigrationApplied = settlementOverlapMigrationRows.rows.length === 1;
    const settlementReferenceMigrationRows = await pool.query(
      `SELECT 1 FROM _migrations WHERE filename = $1 LIMIT 1`,
      ['490_oxsteed_credit_settlement_reference.sql']
    );
    checks.settlementReferenceMigrationApplied = settlementReferenceMigrationRows.rows.length === 1;
    const accountLedgerWriteMigrationRows = await pool.query(
      `SELECT 1 FROM _migrations WHERE filename = $1 LIMIT 1`,
      ['491_oxsteed_credit_account_ledger_write.sql']
    );
    checks.accountLedgerWriteMigrationApplied = accountLedgerWriteMigrationRows.rows.length === 1;
    const holdTerminalEvidenceMigrationRows = await pool.query(
      `SELECT 1 FROM _migrations WHERE filename = $1 LIMIT 1`,
      ['492_oxsteed_credit_hold_terminal_evidence.sql']
    );
    checks.holdTerminalEvidenceMigrationApplied = holdTerminalEvidenceMigrationRows.rows.length === 1;
    const disputeActorEvidenceMigrationRows = await pool.query(
      `SELECT 1 FROM _migrations WHERE filename = $1 LIMIT 1`,
      ['493_oxsteed_credit_dispute_actor_evidence.sql']
    );
    checks.disputeActorEvidenceMigrationApplied = disputeActorEvidenceMigrationRows.rows.length === 1;
    const holdActorEvidenceMigrationRows = await pool.query(
      `SELECT 1 FROM _migrations WHERE filename = $1 LIMIT 1`,
      ['494_oxsteed_credit_hold_actor_evidence.sql']
    );
    checks.holdActorEvidenceMigrationApplied = holdActorEvidenceMigrationRows.rows.length === 1;
    const entitlementAgreementStateMigrationRows = await pool.query(
      `SELECT 1 FROM _migrations WHERE filename = $1 LIMIT 1`,
      ['495_oxsteed_credit_entitlement_agreement_state.sql']
    );
    checks.entitlementAgreementStateMigrationApplied = entitlementAgreementStateMigrationRows.rows.length === 1;
    const agreementEntitlementStateMigrationRows = await pool.query(
      `SELECT 1 FROM _migrations WHERE filename = $1 LIMIT 1`,
      ['496_oxsteed_credit_agreement_entitlement_state.sql']
    );
    checks.agreementEntitlementStateMigrationApplied = agreementEntitlementStateMigrationRows.rows.length === 1;
    const transactionActorOwnerMigrationRows = await pool.query(
      `SELECT 1 FROM _migrations WHERE filename = $1 LIMIT 1`,
      ['497_oxsteed_credit_transaction_actor_owner.sql']
    );
    checks.transactionActorOwnerMigrationApplied = transactionActorOwnerMigrationRows.rows.length === 1;
    const purchaseReferenceMigrationRows = await pool.query(
      `SELECT 1 FROM _migrations WHERE filename = $1 LIMIT 1`,
      ['498_oxsteed_credit_purchase_reference.sql']
    );
    checks.purchaseReferenceMigrationApplied = purchaseReferenceMigrationRows.rows.length === 1;
    const restaurantStaffEvidenceMigrationRows = await pool.query(
      `SELECT 1 FROM _migrations WHERE filename = $1 LIMIT 1`,
      ['499_oxsteed_credit_restaurant_staff_evidence.sql']
    );
    checks.restaurantStaffEvidenceMigrationApplied = restaurantStaffEvidenceMigrationRows.rows.length === 1;
    const restaurantStaffRefundReasonMigrationRows = await pool.query(
      `SELECT 1 FROM _migrations WHERE filename = $1 LIMIT 1`,
      ['501_oxsteed_credit_restaurant_staff_refund_reason.sql']
    );
    checks.restaurantStaffRefundReasonMigrationApplied = restaurantStaffRefundReasonMigrationRows.rows.length === 1;
    const purchaseReferenceUniquenessMigrationRows = await pool.query(
      `SELECT 1 FROM _migrations WHERE filename = $1 LIMIT 1`,
      ['500_oxsteed_credit_purchase_reference_uniqueness.sql']
    );
    checks.purchaseReferenceUniquenessMigrationApplied = purchaseReferenceUniquenessMigrationRows.rows.length === 1;
    const purchaseActorEvidenceMigrationRows = await pool.query(
      `SELECT 1 FROM _migrations WHERE filename = $1 LIMIT 1`,
      ['502_oxsteed_credit_purchase_actor_evidence.sql']
    );
    checks.purchaseActorEvidenceMigrationApplied = purchaseActorEvidenceMigrationRows.rows.length === 1;
    const systemHoldReleaseEvidenceMigrationRows = await pool.query(
      `SELECT 1 FROM _migrations WHERE filename = $1 LIMIT 1`,
      ['503_oxsteed_credit_system_hold_release_evidence.sql']
    );
    checks.systemHoldReleaseEvidenceMigrationApplied = systemHoldReleaseEvidenceMigrationRows.rows.length === 1;
    const spendAccountStateMigrationRows = await pool.query(
      `SELECT 1 FROM _migrations WHERE filename = $1 LIMIT 1`,
      ['504_oxsteed_credit_spend_account_state.sql']
    );
    checks.spendAccountStateMigrationApplied = spendAccountStateMigrationRows.rows.length === 1;
    const notificationOutboxMigrationRows = await pool.query(
      `SELECT 1 FROM _migrations WHERE filename = $1 LIMIT 1`,
      ['505_oxsteed_credit_notification_outbox.sql']
    );
    checks.notificationOutboxMigrationApplied = notificationOutboxMigrationRows.rows.length === 1;
    const holdNotificationOutboxMigrationRows = await pool.query(
      `SELECT 1 FROM _migrations WHERE filename = $1 LIMIT 1`,
      ['506_oxsteed_credit_hold_notification_outbox.sql']
    );
    checks.holdNotificationOutboxMigrationApplied = holdNotificationOutboxMigrationRows.rows.length === 1;
    const notificationRetentionMigrationRows = await pool.query(
      `SELECT 1 FROM _migrations WHERE filename = $1 LIMIT 1`,
      ['507_oxsteed_credit_notification_retention.sql']
    );
    checks.notificationRetentionMigrationApplied = notificationRetentionMigrationRows.rows.length === 1;
    const workerHeartbeatMigrationRows = await pool.query(
      `SELECT 1 FROM _migrations WHERE filename = $1 LIMIT 1`,
      ['508_oxsteed_credit_worker_heartbeat.sql']
    );
    checks.workerHeartbeatMigrationApplied = workerHeartbeatMigrationRows.rows.length === 1;
    const notificationQueueIndexesMigrationRows = await pool.query(
      `SELECT 1 FROM _migrations WHERE filename = $1 LIMIT 1`,
      ['509_oxsteed_credit_notification_queue_indexes.sql']
    );
    checks.notificationQueueIndexesMigrationApplied = notificationQueueIndexesMigrationRows.rows.length === 1;
    const ledgerHashKeyVersionMigrationRows = await pool.query(
      `SELECT 1 FROM _migrations WHERE filename = $1 LIMIT 1`,
      ['510_oxsteed_credit_hmac_key_version.sql']
    );
    checks.ledgerHashKeyVersionMigrationApplied = ledgerHashKeyVersionMigrationRows.rows.length === 1;
    const velocityIndexesMigrationRows = await pool.query(
      `SELECT 1 FROM _migrations WHERE filename = $1 LIMIT 1`,
      ['511_oxsteed_credit_velocity_indexes.sql']
    );
    checks.velocityIndexesMigrationApplied = velocityIndexesMigrationRows.rows.length === 1;
    const auditQueryIndexesMigrationRows = await pool.query(
      `SELECT 1 FROM _migrations WHERE filename = $1 LIMIT 1`,
      ['512_oxsteed_credit_audit_query_indexes.sql']
    );
    checks.auditQueryIndexesMigrationApplied = auditQueryIndexesMigrationRows.rows.length === 1;
    const settlementCreationEvidenceMigrationRows = await pool.query(
      `SELECT 1 FROM _migrations WHERE filename = $1 LIMIT 1`,
      ['470_oxsteed_credit_settlement_creation_evidence.sql']
    );
    checks.settlementCreationEvidenceMigrationApplied = settlementCreationEvidenceMigrationRows.rows.length === 1;
    const entitlementIdempotencyMigrationRows = await pool.query(
      `SELECT 1 FROM _migrations WHERE filename = $1 LIMIT 1`,
      ['471_oxsteed_credit_entitlement_idempotency.sql']
    );
    checks.entitlementIdempotencyMigrationApplied = entitlementIdempotencyMigrationRows.rows.length === 1;
    const entitlementRequestResultsMigrationRows = await pool.query(
      `SELECT 1 FROM _migrations WHERE filename = $1 LIMIT 1`,
      ['472_oxsteed_credit_entitlement_request_results.sql']
    );
    checks.entitlementRequestResultsMigrationApplied = entitlementRequestResultsMigrationRows.rows.length === 1;
    const entitlementActivityMigrationRows = await pool.query(
      `SELECT 1 FROM _migrations WHERE filename = $1 LIMIT 1`,
      ['473_oxsteed_credit_entitlement_activity.sql']
    );
    checks.entitlementActivityMigrationApplied = entitlementActivityMigrationRows.rows.length === 1;
    const partnerLedgerMigrationRows = await pool.query(
      `SELECT 1 FROM _migrations WHERE filename = $1 LIMIT 1`,
      ['514_oxsteed_credit_partner_ledgers.sql']
    );
    checks.partnerLedgerMigrationApplied = partnerLedgerMigrationRows.rows.length === 1;

    const { rows: emergencyRows } = await pool.query(
      `SELECT is_enabled FROM feature_flags WHERE key = 'oxsteed_credit_enabled' LIMIT 1`
    );
    checks.emergencyFlagSeeded = emergencyRows.length === 1;
    checks.emergencyFlagEnabled = emergencyRows[0]?.is_enabled === true;

    const { rows: tableRows } = await pool.query(
      `SELECT table_name
         FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = ANY($1::text[])`,
      [REQUIRED_TABLES]
    );
    const presentTables = new Set(tableRows.map((row) => row.table_name));
    checks.missingTables = REQUIRED_TABLES.filter((table) => !presentTables.has(table));

    checks.missingColumns = [];
    for (const [table, columns] of Object.entries(REQUIRED_COLUMNS)) {
      const { rows } = await pool.query(
        `SELECT column_name
           FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = $1 AND column_name = ANY($2::text[])`,
        [table, columns]
      );
      const presentColumns = new Set(rows.map((row) => row.column_name));
      for (const column of columns) {
        if (!presentColumns.has(column)) checks.missingColumns.push(`${table}.${column}`);
      }
    }

    const { rows: indexRows } = await pool.query(
      `SELECT indexname
         FROM pg_indexes
        WHERE schemaname = 'public' AND indexname = ANY($1::text[])`,
      [REQUIRED_INDEXES]
    );
    const presentIndexes = new Set(indexRows.map((row) => row.indexname));
    checks.missingIndexes = REQUIRED_INDEXES.filter((index) => !presentIndexes.has(index));

    const { rows: currencyRows } = await pool.query(
      `SELECT 'partner' AS resource_type, settlement_currency_code AS currency_code
         FROM oxsteed_credit_partners
       UNION ALL
       SELECT 'account', currency_code FROM oxsteed_credit_accounts
       UNION ALL
       SELECT 'transaction', currency_code FROM oxsteed_credit_transactions
       UNION ALL
       SELECT 'hold', currency_code FROM oxsteed_credit_holds
       UNION ALL
       SELECT 'settlement', currency_code FROM oxsteed_credit_settlements`,
    );
    const unsupportedCurrencyRecords = findUnsupportedCurrencyRecords(currencyRows);
    checks.unsupportedCurrencyRecords = unsupportedCurrencyRecords;
    checks.unsupportedCurrencies = [...new Set(unsupportedCurrencyRecords.map((row) => row.currencyCode))].sort();

    const { rows: integrityTriggerRows } = await pool.query(
      `SELECT tgname
         FROM pg_trigger
        WHERE NOT tgisinternal
          AND tgrelid IN ('oxsteed_credit_transactions'::regclass, 'oxsteed_credit_transaction_entries'::regclass, 'oxsteed_credit_holds'::regclass, 'oxsteed_credit_accounts'::regclass, 'oxsteed_credit_settlements'::regclass, 'oxsteed_credit_audit_events'::regclass, 'oxsteed_credit_partners'::regclass, 'oxsteed_credit_partner_agreements'::regclass, 'oxsteed_credit_customer_entitlements'::regclass, 'oxsteed_credit_disputes'::regclass, 'oxsteed_credit_entitlement_bulk_requests'::regclass, 'oxsteed_credit_entitlement_requests'::regclass, 'oxsteed_credit_notification_outbox'::regclass, 'oxsteed_credit_partner_ledgers'::regclass, 'oxsteed_credit_partner_funding_records'::regclass, 'food_restaurants'::regclass, 'users'::regclass)
          AND tgname = ANY($1::text[])`,
      [REQUIRED_INTEGRITY_TRIGGERS]
    );
    const presentIntegrityTriggers = new Set(integrityTriggerRows.map((row) => row.tgname));
    checks.missingIntegrityTriggers = REQUIRED_INTEGRITY_TRIGGERS.filter((trigger) => !presentIntegrityTriggers.has(trigger));

    const { rows: transactionInvariantRows } = await pool.query(
      `SELECT COUNT(*)::int AS invalid_count
         FROM (
           SELECT t.id
             FROM oxsteed_credit_transactions t
             LEFT JOIN oxsteed_credit_transaction_entries e ON e.transaction_id = t.id
            WHERE t.status = 'posted'
            GROUP BY t.id, t.amount_cents
           HAVING COUNT(e.id) <> 2
               OR COUNT(*) FILTER (WHERE e.entry_side = 'debit') <> 1
               OR COUNT(*) FILTER (WHERE e.entry_side = 'credit') <> 1
               OR COUNT(*) FILTER (WHERE e.amount_cents <> t.amount_cents) <> 0
         ) invalid`,
    );
    checks.invalidPostedTransactions = Number(transactionInvariantRows[0]?.invalid_count || 0);

    const { rows: transactionStateRows } = await pool.query(
      `SELECT COUNT(*)::int AS invalid_count
         FROM oxsteed_credit_transactions t
        WHERE (t.status = 'posted' AND t.posted_at IS NULL)
           OR (t.status = 'reversed' AND t.reversed_at IS NULL)
           OR (t.status IN ('pending', 'voided') AND (t.posted_at IS NOT NULL OR t.reversed_at IS NOT NULL))
           OR (t.status <> 'posted' AND EXISTS (
                SELECT 1 FROM oxsteed_credit_transaction_entries e WHERE e.transaction_id = t.id
              ))`,
    );
    checks.invalidTransactionStates = Number(transactionStateRows[0]?.invalid_count || 0);

    const { rows: adminRefundEvidenceRows } = await pool.query(
      `SELECT COUNT(*)::int AS invalid_count
         FROM oxsteed_credit_transactions
        WHERE transaction_type = 'refund'
          AND actor_type = 'admin'
          AND (actor_user_id IS NULL
            OR NULLIF(BTRIM(reason), '') IS NULL
            OR reason = 'Legacy transaction: reason unavailable')`,
    );
    checks.invalidAdministrativeRefunds = Number(adminRefundEvidenceRows[0]?.invalid_count || 0);

    const { rows: balanceInvariantRows } = await pool.query(
      `WITH journal AS (
         SELECT e.account_id,
                SUM(CASE WHEN e.entry_side = 'credit' THEN e.amount_cents ELSE -e.amount_cents END)::bigint AS journal_balance
           FROM oxsteed_credit_transaction_entries e
           JOIN oxsteed_credit_transactions t ON t.id = e.transaction_id
          WHERE t.status = 'posted'
          GROUP BY e.account_id
       )
       SELECT COUNT(*)::int AS invalid_count
         FROM oxsteed_credit_accounts a
         LEFT JOIN journal j ON j.account_id = a.id
        WHERE COALESCE(j.journal_balance, 0) <> a.balance_cents`,
    );
    checks.invalidAccountBalances = Number(balanceInvariantRows[0]?.invalid_count || 0);

    const { rows: accountLedgerStateRows } = await pool.query(
      `SELECT COUNT(*)::int AS invalid_count
         FROM oxsteed_credit_accounts
        WHERE (ledger_version = 0
               AND (balance_cents <> 0
                 OR last_entry_hash IS NOT NULL
                 OR last_posted_at IS NOT NULL))
           OR (ledger_version > 0
               AND (last_entry_hash IS NULL OR last_posted_at IS NULL))`,
    );
    checks.invalidAccountLedgerStates = Number(accountLedgerStateRows[0]?.invalid_count || 0);

    const { rows: reservationInvariantRows } = await pool.query(
      `SELECT COUNT(*)::int AS invalid_count
         FROM oxsteed_credit_accounts a
         LEFT JOIN (
           SELECT account_id, SUM(amount_cents)::bigint AS active_hold_cents
             FROM oxsteed_credit_holds
            WHERE status = 'active'
            GROUP BY account_id
         ) h ON h.account_id = a.id
        WHERE a.account_type = 'customer_wallet'
          AND a.reserved_cents <> COALESCE(h.active_hold_cents, 0)`,
    );
    checks.invalidReservedBalances = Number(reservationInvariantRows[0]?.invalid_count || 0);

    const { rows: holdLifecycleRows } = await pool.query(
      `SELECT COUNT(*)::int AS invalid_count
         FROM oxsteed_credit_holds h
         LEFT JOIN oxsteed_credit_transactions t ON t.id = h.captured_transaction_id
        WHERE (h.status = 'active'
               AND (h.captured_transaction_id IS NOT NULL
                 OR h.capture_idempotency_key IS NOT NULL
                 OR h.captured_at IS NOT NULL
                 OR h.released_at IS NOT NULL))
           OR (h.status IN ('released', 'expired')
               AND (h.released_at IS NULL
                 OR h.captured_transaction_id IS NOT NULL
                 OR h.capture_idempotency_key IS NOT NULL
                 OR h.captured_at IS NOT NULL))
           OR (h.status = 'captured'
               AND (h.captured_transaction_id IS NULL
                 OR NULLIF(BTRIM(h.capture_idempotency_key), '') IS NULL
                 OR h.captured_at IS NULL
                 OR h.released_at IS NOT NULL
                 OR t.transaction_type <> 'purchase'
                 OR t.status <> 'posted'
                 OR t.debit_account_id IS DISTINCT FROM h.account_id
                 OR t.amount_cents IS DISTINCT FROM h.amount_cents
                 OR t.currency_code IS DISTINCT FROM h.currency_code
                 OR t.partner_id IS DISTINCT FROM h.partner_id
                 OR t.agreement_id IS DISTINCT FROM h.agreement_id))`,
    );
    checks.invalidHoldLifecycles = Number(holdLifecycleRows[0]?.invalid_count || 0);

    const { rows: holdTerminalEvidenceRows } = await pool.query(
      `SELECT COUNT(*)::int AS invalid_count
         FROM oxsteed_credit_holds h
        WHERE (h.status = 'active'
               AND (h.capture_actor_type IS NOT NULL
                 OR h.captured_by IS NOT NULL
                 OR h.capture_reason IS NOT NULL
                 OR h.release_actor_type IS NOT NULL
                 OR h.released_by IS NOT NULL
                 OR h.release_reason IS NOT NULL
                 OR h.terminal_evidence_legacy))
           OR (h.status IN ('released', 'expired')
               AND NOT h.terminal_evidence_legacy
               AND (h.release_actor_type NOT IN ('customer', 'admin', 'system')
                 OR NULLIF(BTRIM(h.release_reason), '') IS NULL
                 OR (h.release_actor_type IN ('customer', 'admin') AND h.released_by IS NULL)))
           OR (h.status = 'captured'
               AND NOT h.terminal_evidence_legacy
               AND (h.capture_actor_type NOT IN ('admin', 'system')
                 OR NULLIF(BTRIM(h.capture_reason), '') IS NULL
                 OR (h.capture_actor_type = 'admin' AND h.captured_by IS NULL)))`,
    );
    checks.invalidHoldTerminalEvidence = Number(holdTerminalEvidenceRows[0]?.invalid_count || 0);

    const { rows: holdActorEvidenceRows } = await pool.query(
      `SELECT COUNT(*)::int AS invalid_count
         FROM oxsteed_credit_holds h
         LEFT JOIN users creator ON creator.id = h.created_by
         LEFT JOIN users capture_actor ON capture_actor.id = h.captured_by
         LEFT JOIN users release_actor ON release_actor.id = h.released_by
        WHERE NOT h.actor_evidence_legacy
          AND (
            creator.id IS NULL
            OR creator.id IS DISTINCT FROM h.customer_id
            OR creator.role <> 'customer'
            OR creator.is_active IS DISTINCT FROM TRUE
            OR (h.status = 'captured' AND (
              (h.capture_actor_type = 'admin' AND (
                capture_actor.id IS NULL
                OR capture_actor.role NOT IN ('admin', 'super_admin')
                OR capture_actor.is_active IS DISTINCT FROM TRUE
              ))
              OR (h.capture_actor_type = 'system' AND h.captured_by IS NOT NULL)
              OR COALESCE(h.capture_actor_type, '') NOT IN ('admin', 'system')
            ))
            OR (h.status IN ('released', 'expired') AND (
              (h.release_actor_type = 'customer' AND (
                release_actor.id IS NULL
                OR release_actor.id IS DISTINCT FROM h.customer_id
                OR release_actor.role <> 'customer'
                OR release_actor.is_active IS DISTINCT FROM TRUE
              ))
              OR (h.release_actor_type = 'admin' AND (
                release_actor.id IS NULL
                OR release_actor.role NOT IN ('admin', 'super_admin')
                OR release_actor.is_active IS DISTINCT FROM TRUE
              ))
              OR (h.release_actor_type = 'system' AND h.released_by IS NOT NULL)
              OR COALESCE(h.release_actor_type, '') NOT IN ('customer', 'admin', 'system')
            ))
          )`,
    );
    checks.invalidCreditHoldActors = Number(holdActorEvidenceRows[0]?.invalid_count || 0);

    const { rows: customerOwnerInvariantRows } = await pool.query(
      `SELECT COUNT(*)::int AS invalid_count
         FROM oxsteed_credit_accounts a
         LEFT JOIN users u ON u.id = a.customer_id
        WHERE a.account_type = 'customer_wallet'
          AND (u.id IS NULL OR u.role <> 'customer')`,
    );
    checks.invalidCustomerWalletOwners = Number(customerOwnerInvariantRows[0]?.invalid_count || 0);

    const { rows: entitlementOwnerInvariantRows } = await pool.query(
      `SELECT COUNT(*)::int AS invalid_count
         FROM oxsteed_credit_customer_entitlements e
         LEFT JOIN users u ON u.id = e.customer_id
        WHERE u.id IS NULL OR u.role <> 'customer'`,
    );
    checks.invalidEntitlementOwners = Number(entitlementOwnerInvariantRows[0]?.invalid_count || 0);

    const { rows: entitlementActivityInvariantRows } = await pool.query(
      `SELECT COUNT(*)::int AS invalid_count
         FROM oxsteed_credit_customer_entitlements e
         LEFT JOIN users u ON u.id = e.customer_id
        WHERE e.status = 'active'
          AND (u.id IS NULL OR u.role <> 'customer' OR u.is_active IS DISTINCT FROM TRUE)`,
    );
    checks.invalidActiveEntitlementCustomers = Number(entitlementActivityInvariantRows[0]?.invalid_count || 0);

    const { rows: activeEntitlementAgreementInvariantRows } = await pool.query(
      `SELECT COUNT(*)::int AS invalid_count
         FROM oxsteed_credit_customer_entitlements e
         JOIN oxsteed_credit_partner_agreements a ON a.id = e.agreement_id
         JOIN oxsteed_credit_partners p ON p.id = a.partner_id
         JOIN food_restaurants fr ON fr.id = p.restaurant_id
        WHERE e.status = 'active'
          AND (a.status <> 'active'
            OR p.status <> 'active'
            OR fr.status <> 'active'
            OR (a.ends_at IS NOT NULL AND a.ends_at <= NOW()))`,
    );
    checks.invalidActiveEntitlementAgreements = Number(activeEntitlementAgreementInvariantRows[0]?.invalid_count || 0);

    const { rows: idempotencyKeyInvariantRows } = await pool.query(
      `SELECT COUNT(*)::int AS invalid_count
         FROM (
           SELECT id::text AS id FROM oxsteed_credit_transactions WHERE NULLIF(BTRIM(idempotency_key), '') IS NULL
           UNION ALL
           SELECT id::text FROM oxsteed_credit_holds WHERE NULLIF(BTRIM(idempotency_key), '') IS NULL
           UNION ALL
           SELECT id::text FROM oxsteed_credit_settlements WHERE NULLIF(BTRIM(idempotency_key), '') IS NULL
           UNION ALL
           SELECT creation_idempotency_key FROM oxsteed_credit_partner_agreements
            WHERE creation_idempotency_key IS NOT NULL AND NULLIF(BTRIM(creation_idempotency_key), '') IS NULL
           UNION ALL
           SELECT id::text FROM oxsteed_credit_disputes
            WHERE idempotency_key IS NOT NULL AND NULLIF(BTRIM(idempotency_key), '') IS NULL
           UNION ALL
           SELECT idempotency_key FROM oxsteed_credit_entitlement_bulk_requests WHERE NULLIF(BTRIM(idempotency_key), '') IS NULL
           UNION ALL
           SELECT idempotency_key FROM oxsteed_credit_entitlement_requests WHERE NULLIF(BTRIM(idempotency_key), '') IS NULL
           UNION ALL
           SELECT id::text FROM oxsteed_credit_holds
            WHERE capture_idempotency_key IS NOT NULL AND NULLIF(BTRIM(capture_idempotency_key), '') IS NULL
         ) invalid_keys`,
    );
    checks.invalidCreditIdempotencyKeys = Number(idempotencyKeyInvariantRows[0]?.invalid_count || 0);

    const { rows: refundInvariantRows } = await pool.query(
      `SELECT COUNT(*)::int AS invalid_count
         FROM oxsteed_credit_transactions r
         LEFT JOIN oxsteed_credit_transactions p
           ON p.id::text = r.reference_id
          AND p.transaction_type = 'purchase'
          AND p.status = 'posted'
         LEFT JOIN (
           SELECT reference_id, SUM(amount_cents)::bigint AS refunded_cents
             FROM oxsteed_credit_transactions
            WHERE transaction_type = 'refund'
              AND status = 'posted'
              AND reference_type = 'oxsteed_credit_purchase'
            GROUP BY reference_id
         ) totals ON totals.reference_id = r.reference_id
        WHERE r.transaction_type = 'refund'
          AND r.status = 'posted'
          AND (r.reference_type IS DISTINCT FROM 'oxsteed_credit_purchase'
            OR NULLIF(BTRIM(r.reference_id), '') IS NULL
            OR p.id IS NULL
            OR r.debit_account_id IS DISTINCT FROM p.credit_account_id
            OR r.credit_account_id IS DISTINCT FROM p.debit_account_id
            OR r.currency_code IS DISTINCT FROM p.currency_code
            OR r.partner_id IS DISTINCT FROM p.partner_id
            OR r.agreement_id IS DISTINCT FROM p.agreement_id
            OR COALESCE(totals.refunded_cents, 0) > p.amount_cents)`,
    );
    checks.invalidRefunds = Number(refundInvariantRows[0]?.invalid_count || 0);

    const { rows: actorIdentityInvariantRows } = await pool.query(
      `SELECT COUNT(*)::int AS invalid_count
         FROM oxsteed_credit_transactions t
         LEFT JOIN users u ON u.id = t.actor_user_id
        WHERE (t.actor_type = 'admin'
               AND (u.id IS NULL
                 OR u.role NOT IN ('admin', 'super_admin')))
           OR (t.actor_type IN ('user', 'customer')
               AND (u.id IS NULL OR u.role <> 'customer'))`,
    );
    checks.invalidCreditActorIdentities = Number(actorIdentityInvariantRows[0]?.invalid_count || 0);

    const { rows: actorOwnerInvariantRows } = await pool.query(
      `SELECT COUNT(*)::int AS invalid_count
         FROM oxsteed_credit_transactions t
         LEFT JOIN oxsteed_credit_accounts a ON a.id = t.debit_account_id
        WHERE t.actor_type IN ('user', 'customer')
          AND NOT t.actor_owner_evidence_legacy
          AND (a.account_type <> 'customer_wallet'
            OR a.customer_id IS NULL
            OR t.actor_user_id IS DISTINCT FROM a.customer_id)`,
    );
    checks.invalidCreditActorOwners = Number(actorOwnerInvariantRows[0]?.invalid_count || 0);

    const { rows: restaurantStaffRefundReasonRows } = await pool.query(
      `SELECT COUNT(*)::int AS invalid_count
         FROM oxsteed_credit_transactions t
        WHERE t.transaction_type = 'refund'
          AND t.actor_type = 'restaurant_staff'
          AND NOT t.restaurant_staff_evidence_legacy
          AND NULLIF(BTRIM(t.reason), '') IS NULL`,
    );
    checks.invalidCreditRestaurantStaffRefundReasons = Number(restaurantStaffRefundReasonRows[0]?.invalid_count || 0);

    const { rows: restaurantStaffActorEvidenceRows } = await pool.query(
      `SELECT COUNT(*)::int AS invalid_count
         FROM oxsteed_credit_transactions t
        WHERE t.transaction_type = 'refund'
          AND t.actor_type = 'restaurant_staff'
          AND NOT t.restaurant_staff_evidence_legacy
          AND NOT EXISTS (
            SELECT 1
              FROM oxsteed_credit_partners p
              JOIN food_restaurants fr ON fr.id = p.restaurant_id
              LEFT JOIN businesses b ON b.id = p.business_id
              JOIN users u ON u.id = t.actor_user_id
             WHERE p.id = t.partner_id
               AND u.is_active = TRUE
               AND (
                 b.user_id = u.id
                 OR fr.owner_user_id = u.id
                 OR EXISTS (
                   SELECT 1
                     FROM business_members bm
                    WHERE bm.business_id = p.business_id
                      AND bm.member_id = u.id
                      AND bm.status = 'active'
                 )
               )
          )`,
    );
    checks.invalidCreditRestaurantStaffEvidence = Number(restaurantStaffActorEvidenceRows[0]?.invalid_count || 0);

    const { rows: purchaseReferenceUniquenessRows } = await pool.query(
      `SELECT COUNT(*)::int AS invalid_count
         FROM (
           SELECT reference_type, reference_id
             FROM oxsteed_credit_transactions
            WHERE status = 'posted'
              AND transaction_type = 'purchase'
              AND reference_type = 'food_order'
              AND NULLIF(BTRIM(reference_id), '') IS NOT NULL
              AND NOT purchase_reference_uniqueness_legacy
            GROUP BY reference_type, reference_id
           HAVING COUNT(*) > 1
         ) duplicate_references`,
    );
    checks.invalidCreditPurchaseReferenceUniqueness = Number(purchaseReferenceUniquenessRows[0]?.invalid_count || 0);

    const { rows: purchaseActorEvidenceRows } = await pool.query(
      `SELECT COUNT(*)::int AS invalid_count
         FROM oxsteed_credit_transactions t
         LEFT JOIN oxsteed_credit_accounts a ON a.id = t.debit_account_id
         LEFT JOIN users actor ON actor.id = t.actor_user_id
        WHERE t.transaction_type = 'purchase'
          AND NOT t.purchase_actor_evidence_legacy
          AND (
            t.actor_type IS NULL
            OR t.actor_type NOT IN ('customer', 'user', 'admin', 'system')
            OR (
              t.actor_type IN ('customer', 'user')
              AND (a.account_type <> 'customer_wallet'
                OR a.customer_id IS DISTINCT FROM t.actor_user_id
                OR actor.role <> 'customer'
                OR actor.is_active IS DISTINCT FROM TRUE)
            )
            OR (
              t.actor_type = 'admin'
              AND (
                actor.role NOT IN ('admin', 'super_admin')
                OR actor.is_active IS DISTINCT FROM TRUE
                OR NOT EXISTS (
                  SELECT 1
                    FROM oxsteed_credit_holds h
                   WHERE h.id::TEXT = t.metadata->>'capturedHoldId'
                     AND h.account_id = t.debit_account_id
                     AND h.customer_id = a.customer_id
                     AND h.amount_cents = t.amount_cents
                     AND h.currency_code = t.currency_code
                     AND h.partner_id = t.partner_id
                     AND h.agreement_id = t.agreement_id
                     AND h.status = 'captured'
                     AND h.captured_transaction_id = t.id
                )
              )
            )
            OR (
              t.actor_type = 'system'
              AND NOT EXISTS (
                SELECT 1
                  FROM oxsteed_credit_holds h
                 WHERE h.id::TEXT = t.metadata->>'capturedHoldId'
                   AND h.account_id = t.debit_account_id
                   AND h.customer_id = a.customer_id
                   AND h.amount_cents = t.amount_cents
                   AND h.currency_code = t.currency_code
                   AND h.partner_id = t.partner_id
                   AND h.agreement_id = t.agreement_id
                   AND h.status = 'captured'
                   AND h.captured_transaction_id = t.id
              )
            )
          )`,
    );
    checks.invalidCreditPurchaseActorEvidence = Number(purchaseActorEvidenceRows[0]?.invalid_count || 0);

    const { rows: issuanceActorEvidenceRows } = await pool.query(
      `SELECT COUNT(*)::int AS invalid_count
         FROM oxsteed_credit_transactions t
         LEFT JOIN users u ON u.id = t.actor_user_id
        WHERE t.transaction_type IN ('load', 'adjustment')
          AND (t.actor_type <> 'admin'
            OR t.actor_user_id IS NULL
            OR u.id IS NULL
            OR u.role NOT IN ('admin', 'super_admin')
            OR NULLIF(BTRIM(t.reason), '') IS NULL
            OR t.reason = 'Legacy transaction: reason unavailable')`,
    );
    checks.invalidCreditIssuanceActors = Number(issuanceActorEvidenceRows[0]?.invalid_count || 0);

    const { rows: adminProvenanceRows } = await pool.query(
      `SELECT COUNT(*)::int AS invalid_count
         FROM (
           SELECT created_by AS creator_id FROM oxsteed_credit_partners
           UNION ALL
           SELECT created_by AS creator_id FROM oxsteed_credit_partner_agreements
           UNION ALL
           SELECT created_by AS creator_id FROM oxsteed_credit_customer_entitlements
           UNION ALL
           SELECT created_by AS creator_id FROM oxsteed_credit_settlements
         ) credit_creators
         LEFT JOIN users u ON u.id = credit_creators.creator_id
        WHERE credit_creators.creator_id IS NULL
           OR u.id IS NULL
           OR u.role NOT IN ('admin', 'super_admin')`,
    );
    checks.invalidCreditCreatorEvidence = Number(adminProvenanceRows[0]?.invalid_count || 0);

    const { rows: inactiveHoldInvariantRows } = await pool.query(
      `SELECT COUNT(*)::int AS invalid_count
         FROM oxsteed_credit_holds h
         JOIN users u ON u.id = h.customer_id
         JOIN oxsteed_credit_accounts a ON a.id = h.account_id
        WHERE h.status = 'active'
          AND (u.role <> 'customer'
            OR u.is_active IS DISTINCT FROM TRUE
            OR a.account_type <> 'customer_wallet'
            OR a.status IS DISTINCT FROM 'active')`,
    );
    checks.invalidActiveCreditHolds = Number(inactiveHoldInvariantRows[0]?.invalid_count || 0);

    const { rows: spendAccountStateInvariantRows } = await pool.query(
      `SELECT COUNT(*)::int AS invalid_count
         FROM oxsteed_credit_transactions t
         JOIN oxsteed_credit_accounts a
           ON a.id IN (t.debit_account_id, t.credit_account_id)
        WHERE t.status = 'posted'
          AND t.transaction_type IN ('purchase', 'transfer')
          AND a.account_type = 'customer_wallet'
          AND a.status IS DISTINCT FROM 'active'`,
    );
    checks.invalidCreditSpendAccountStates = Number(spendAccountStateInvariantRows[0]?.invalid_count || 0);

    const { rows: notificationRecipientRows } = await pool.query(
      `SELECT COUNT(*)::int AS invalid_count
         FROM oxsteed_credit_notification_outbox o
         LEFT JOIN oxsteed_credit_holds h ON h.id = o.hold_id
        WHERE (o.hold_id IS NULL) = (o.transaction_id IS NULL)
           OR (o.hold_id IS NOT NULL AND (h.id IS NULL OR h.customer_id IS DISTINCT FROM o.user_id))
           OR (o.transaction_id IS NOT NULL AND NOT EXISTS (
             SELECT 1
               FROM oxsteed_credit_transactions t
               JOIN oxsteed_credit_accounts debit_account ON debit_account.id = t.debit_account_id
               JOIN oxsteed_credit_accounts credit_account ON credit_account.id = t.credit_account_id
              WHERE t.id = o.transaction_id
                AND (
                  (debit_account.account_type = 'customer_wallet' AND debit_account.customer_id = o.user_id)
                  OR (credit_account.account_type = 'customer_wallet' AND credit_account.customer_id = o.user_id)
                )
           ))`,
    );
    checks.invalidCreditNotificationRecipients = Number(notificationRecipientRows[0]?.invalid_count || 0);

    const { rows: activeAgreementInvariantRows } = await pool.query(
      `SELECT COUNT(*)::int AS invalid_count
         FROM oxsteed_credit_partner_agreements a
         JOIN oxsteed_credit_partners p ON p.id = a.partner_id
         JOIN food_restaurants fr ON fr.id = p.restaurant_id
        WHERE a.status = 'active'
          AND (p.status <> 'active' OR fr.status <> 'active')`,
    );
    checks.invalidActiveAgreements = Number(activeAgreementInvariantRows[0]?.invalid_count || 0);

    const { rows: activeRestaurantPartnerInvariantRows } = await pool.query(
      `SELECT COUNT(*)::int AS invalid_count
         FROM oxsteed_credit_partners p
         JOIN food_restaurants fr ON fr.id = p.restaurant_id
        WHERE p.status = 'active'
          AND fr.status IS DISTINCT FROM 'active'`,
    );
    checks.invalidActiveRestaurantPartners = Number(activeRestaurantPartnerInvariantRows[0]?.invalid_count || 0);

    const { rows: agreementApprovalInvariantRows } = await pool.query(
      `SELECT COUNT(*)::int AS invalid_count
         FROM oxsteed_credit_partner_agreements a
         LEFT JOIN users u ON u.id = a.approved_by
        WHERE a.status = 'active'
          AND (u.id IS NULL OR u.role NOT IN ('admin', 'super_admin'))`,
    );
    checks.invalidActiveAgreementApprovals = Number(agreementApprovalInvariantRows[0]?.invalid_count || 0);

    const { rows: closedAccountInvariantRows } = await pool.query(
      `SELECT COUNT(*)::int AS invalid_count
         FROM oxsteed_credit_accounts
        WHERE status = 'closed'
          AND (balance_cents <> 0 OR reserved_cents <> 0)`,
    );
    checks.invalidClosedCreditAccounts = Number(closedAccountInvariantRows[0]?.invalid_count || 0);

    const { rows: purchaseInvariantRows } = await pool.query(
      `SELECT COUNT(*)::int AS invalid_count
         FROM oxsteed_credit_transactions
        WHERE transaction_type = 'purchase'
          AND (partner_id IS NULL OR agreement_id IS NULL)`,
    );
    checks.invalidPurchases = Number(purchaseInvariantRows[0]?.invalid_count || 0);

    const { rows: purchaseReferenceRows } = await pool.query(
      `SELECT COUNT(*)::int AS invalid_count
         FROM oxsteed_credit_transactions
        WHERE transaction_type = 'purchase'
          AND NULLIF(BTRIM(reference_id), '') IS NULL`,
    );
    checks.invalidPurchaseReferences = Number(purchaseReferenceRows[0]?.invalid_count || 0);

    const { rows: purchaseReferenceEvidenceRows } = await pool.query(
      `SELECT COUNT(*)::int AS invalid_count
         FROM oxsteed_credit_transactions t
        WHERE t.transaction_type = 'purchase'
          AND t.reference_type = 'food_order'
          AND NOT t.purchase_reference_evidence_legacy
          AND NOT EXISTS (
            SELECT 1
              FROM food_orders o
              JOIN oxsteed_credit_partners p ON p.id = t.partner_id
              JOIN oxsteed_credit_accounts a ON a.id = t.debit_account_id
             WHERE o.id::TEXT = t.reference_id
               AND o.customer_id IS NOT NULL
               AND o.customer_id = a.customer_id
               AND o.restaurant_id = p.restaurant_id
          )`,
    );
    checks.invalidPurchaseReferenceEvidence = Number(purchaseReferenceEvidenceRows[0]?.invalid_count || 0);

    const { rows: transactionCurrencyRows } = await pool.query(
      `SELECT COUNT(*)::int AS invalid_count
         FROM oxsteed_credit_transactions t
         JOIN oxsteed_credit_partner_agreements a ON a.id = t.agreement_id
         JOIN oxsteed_credit_partners p ON p.id = a.partner_id
        WHERE t.currency_code IS DISTINCT FROM p.settlement_currency_code`,
    );
    checks.invalidTransactionCurrencies = Number(transactionCurrencyRows[0]?.invalid_count || 0);

    const { rows: transactionTypeRows } = await pool.query(
      `SELECT COUNT(*)::int AS invalid_count
         FROM oxsteed_credit_transactions t
         JOIN oxsteed_credit_accounts debit_account ON debit_account.id = t.debit_account_id
         JOIN oxsteed_credit_accounts credit_account ON credit_account.id = t.credit_account_id
        WHERE (t.transaction_type = 'load'
               AND (debit_account.account_type <> 'platform_treasury'
                 OR credit_account.account_type <> 'customer_wallet'
                 OR t.partner_id IS NOT NULL OR t.agreement_id IS NOT NULL))
           OR (t.transaction_type = 'purchase'
               AND (debit_account.account_type <> 'customer_wallet'
                 OR credit_account.account_type <> 'partner_payable'))
           OR (t.transaction_type = 'refund'
               AND (debit_account.account_type <> 'partner_payable'
                 OR credit_account.account_type <> 'customer_wallet'))
           OR (t.transaction_type = 'transfer'
               AND (debit_account.account_type <> 'customer_wallet'
                 OR credit_account.account_type <> 'customer_wallet'
                 OR t.partner_id IS NOT NULL OR t.agreement_id IS NOT NULL))
           OR (t.transaction_type = 'settlement'
               AND (debit_account.account_type <> 'partner_payable'
                 OR credit_account.account_type <> 'platform_treasury'
                 OR t.partner_id IS NULL OR t.agreement_id IS NULL))
           OR (t.transaction_type = 'adjustment'
               AND (t.partner_id IS NOT NULL
                 OR t.agreement_id IS NOT NULL
                 OR (t.metadata->>'direction' = 'credit'
                   AND (debit_account.account_type <> 'platform_treasury'
                     OR credit_account.account_type <> 'customer_wallet'))
                 OR (t.metadata->>'direction' = 'debit'
                 AND (debit_account.account_type <> 'customer_wallet'
                     OR credit_account.account_type <> 'platform_treasury'))
                 OR COALESCE(t.metadata->>'direction', '') NOT IN ('credit', 'debit')))
           OR (t.transaction_type = 'funding'
               AND (debit_account.account_type <> 'platform_treasury'
                 OR credit_account.account_type <> 'partner_reserve'
                 OR t.partner_id IS NULL OR t.agreement_id IS NOT NULL))
           OR (t.transaction_type = 'reserve_release'
               AND (debit_account.account_type <> 'partner_reserve'
                 OR credit_account.account_type <> 'platform_treasury'
                 OR t.partner_id IS NULL OR t.agreement_id IS NOT NULL))
           OR t.transaction_type IN ('fee', 'expiration', 'chargeback')`,
    );
    checks.invalidTransactionTypes = Number(transactionTypeRows[0]?.invalid_count || 0);

    const { rows: transactionPartnerRows } = await pool.query(
      `SELECT COUNT(*)::int AS invalid_count
         FROM oxsteed_credit_transactions t
         JOIN oxsteed_credit_accounts debit_account ON debit_account.id = t.debit_account_id
         JOIN oxsteed_credit_accounts credit_account ON credit_account.id = t.credit_account_id
         LEFT JOIN oxsteed_credit_partner_agreements agreement ON agreement.id = t.agreement_id
        WHERE t.transaction_type IN ('purchase', 'refund', 'settlement')
          AND (t.partner_id IS NULL
            OR t.agreement_id IS NULL
            OR agreement.partner_id IS DISTINCT FROM t.partner_id
            OR (t.transaction_type = 'purchase' AND credit_account.partner_id IS DISTINCT FROM t.partner_id)
            OR (t.transaction_type IN ('refund', 'settlement') AND debit_account.partner_id IS DISTINCT FROM t.partner_id))`,
    );
    checks.invalidTransactionPartnerAccounts = Number(transactionPartnerRows[0]?.invalid_count || 0);

    const { rows: partnerLedgerIntegrityRows } = await pool.query(
      `SELECT COUNT(*)::int AS invalid_count
         FROM oxsteed_credit_partner_ledgers l
         JOIN oxsteed_credit_partners p ON p.id = l.partner_id
         LEFT JOIN oxsteed_credit_accounts payable
           ON payable.id = l.payable_account_id
          AND payable.account_type = 'partner_payable'
          AND payable.partner_id = l.partner_id
          AND payable.currency_code = l.currency_code
         LEFT JOIN oxsteed_credit_accounts reserve
           ON reserve.id = l.reserve_account_id
          AND reserve.account_type = 'partner_reserve'
          AND reserve.partner_id = l.partner_id
          AND reserve.currency_code = l.currency_code
        WHERE p.settlement_currency_code <> l.currency_code
           OR payable.id IS NULL
           OR reserve.id IS NULL`,
    );
    checks.invalidPartnerLedgers = Number(partnerLedgerIntegrityRows[0]?.invalid_count || 0);

    const { rows: partnerFundingIntegrityRows } = await pool.query(
      `SELECT COUNT(*)::int AS invalid_count
         FROM oxsteed_credit_partner_funding_records f
         JOIN oxsteed_credit_partner_ledgers l ON l.id = f.partner_ledger_id
         LEFT JOIN oxsteed_credit_transactions t ON t.id = f.transaction_id
        WHERE f.partner_id IS DISTINCT FROM l.partner_id
           OR f.currency_code IS DISTINCT FROM l.currency_code
           OR f.reserve_account_id IS DISTINCT FROM l.reserve_account_id
           OR t.id IS NULL
           OR t.status <> 'posted'
           OR t.partner_id IS DISTINCT FROM f.partner_id
           OR t.currency_code IS DISTINCT FROM f.currency_code
           OR t.transaction_type IS DISTINCT FROM CASE f.direction
             WHEN 'fund' THEN 'funding' ELSE 'reserve_release' END`,
    );
    checks.invalidPartnerFundingRecords = Number(partnerFundingIntegrityRows[0]?.invalid_count || 0);

    const { rows: disputeIntegrityRows } = await pool.query(
      `SELECT COUNT(*)::int AS invalid_count
         FROM oxsteed_credit_disputes d
         LEFT JOIN oxsteed_credit_transactions t ON t.id = d.transaction_id
        WHERE t.id IS NULL
           OR t.status <> 'posted'
           OR d.partner_id IS DISTINCT FROM t.partner_id
           OR NOT EXISTS (
             SELECT 1
               FROM oxsteed_credit_accounts a
               JOIN users u ON u.id = a.customer_id
              WHERE a.id IN (t.debit_account_id, t.credit_account_id)
                AND a.account_type = 'customer_wallet'
                AND a.customer_id = d.customer_id
                AND a.currency_code IS NOT DISTINCT FROM t.currency_code
                AND u.role = 'customer'
           )
           OR d.status IN ('resolved', 'rejected')
              AND (NULLIF(BTRIM(d.resolution), '') IS NULL
                OR d.resolved_by IS NULL
                OR d.resolved_at IS NULL)`,
    );
    checks.invalidDisputes = Number(disputeIntegrityRows[0]?.invalid_count || 0);

    const { rows: disputeActorEvidenceRows } = await pool.query(
      `SELECT COUNT(*)::int AS invalid_count
         FROM oxsteed_credit_disputes d
         LEFT JOIN users opener ON opener.id = d.opened_by
         LEFT JOIN users resolver ON resolver.id = d.resolved_by
        WHERE NOT d.actor_evidence_legacy
          AND (
            opener.id IS NULL
            OR opener.role <> 'customer'
            OR opener.is_active IS DISTINCT FROM TRUE
            OR (d.resolved_by IS NOT NULL AND (
              resolver.id IS NULL
              OR resolver.role NOT IN ('admin', 'super_admin')
              OR resolver.is_active IS DISTINCT FROM TRUE
            ))
            OR (d.status IN ('resolved', 'rejected') AND (
              d.resolved_by IS NULL
              OR d.resolved_at IS NULL
            ))
          )`,
    );
    checks.invalidCreditDisputeActors = Number(disputeActorEvidenceRows[0]?.invalid_count || 0);

    const { rows: settlementIntegrityRows } = await pool.query(
      `SELECT COUNT(*)::int AS invalid_count
         FROM oxsteed_credit_settlements s
         LEFT JOIN oxsteed_credit_partner_agreements a ON a.id = s.agreement_id
         LEFT JOIN oxsteed_credit_partners p ON p.id = a.partner_id
        WHERE a.id IS NULL
           OR p.id IS NULL
           OR s.partner_id IS DISTINCT FROM a.partner_id
           OR s.currency_code IS DISTINCT FROM p.settlement_currency_code
           OR a.status NOT IN ('active', 'suspended', 'expired')
           OR s.period_start < a.starts_at
           OR (a.ends_at IS NOT NULL AND s.period_end > a.ends_at)`,
    );
    checks.invalidSettlements = Number(settlementIntegrityRows[0]?.invalid_count || 0);

    const { rows: settlementOverlapRows } = await pool.query(
      `SELECT COUNT(*)::int AS invalid_count
         FROM oxsteed_credit_settlements first_settlement
         JOIN oxsteed_credit_settlements second_settlement
           ON second_settlement.id > first_settlement.id
          AND second_settlement.partner_id = first_settlement.partner_id
          AND second_settlement.agreement_id = first_settlement.agreement_id
          AND second_settlement.status <> 'voided'
          AND first_settlement.period_start < second_settlement.period_end
          AND first_settlement.period_end > second_settlement.period_start
        WHERE first_settlement.status <> 'voided'`,
    );
    checks.invalidSettlementOverlaps = Number(settlementOverlapRows[0]?.invalid_count || 0);

    const { rows: settlementReferenceRows } = await pool.query(
      `SELECT COUNT(*)::int AS invalid_count
         FROM oxsteed_credit_transactions t
         LEFT JOIN oxsteed_credit_settlements s ON s.id::TEXT = t.reference_id
        WHERE t.transaction_type = 'settlement'
          AND (t.reference_type IS DISTINCT FROM 'credit_settlement'
            OR NULLIF(BTRIM(t.reference_id), '') IS NULL
            OR s.id IS NULL
            OR s.status NOT IN ('approved', 'paid')
            OR s.partner_id IS DISTINCT FROM t.partner_id
            OR s.agreement_id IS DISTINCT FROM t.agreement_id
            OR s.net_cents IS DISTINCT FROM t.amount_cents
            OR s.currency_code IS DISTINCT FROM t.currency_code
            OR EXISTS (
              SELECT 1
                FROM oxsteed_credit_transactions duplicate
               WHERE duplicate.transaction_type = 'settlement'
                 AND duplicate.status = 'posted'
                 AND duplicate.reference_type = t.reference_type
                 AND duplicate.reference_id = t.reference_id
                 AND duplicate.id <> t.id
            ))`,
    );
    checks.invalidSettlementReferences = Number(settlementReferenceRows[0]?.invalid_count || 0);

    const { rows: settlementStateRows } = await pool.query(
      `SELECT COUNT(*)::int AS invalid_count
         FROM oxsteed_credit_settlements s
         LEFT JOIN users approval_user ON approval_user.id = s.approved_by
        WHERE (s.status = 'paid' AND s.paid_at IS NULL)
           OR (s.status = 'paid' AND s.net_cents > 0 AND NULLIF(BTRIM(s.payment_reference), '') IS NULL)
           OR (s.status IN ('approved', 'paid')
               AND (s.approved_by IS NULL
                 OR approval_user.id IS NULL
                 OR approval_user.role NOT IN ('admin', 'super_admin')))
           OR (s.status = 'paid' AND s.net_cents > 0 AND NOT EXISTS (
                SELECT 1
                  FROM oxsteed_credit_transactions t
                 WHERE t.transaction_type = 'settlement'
                   AND t.status = 'posted'
                   AND t.partner_id = s.partner_id
                   AND t.agreement_id = s.agreement_id
                   AND t.amount_cents = s.net_cents
                   AND t.currency_code = s.currency_code
                   AND t.reference_type = 'credit_settlement'
                   AND t.reference_id = s.id::TEXT
                   AND t.metadata->>'paymentReference' = s.payment_reference
              ))
           OR (s.creation_reason IS NULL) IS DISTINCT FROM (s.creation_request_hash IS NULL)
           OR (s.creation_request_hash IS NOT NULL
               AND s.creation_request_hash !~ '^[a-f0-9]{64}$')`,
    );
    checks.invalidSettlementStates = Number(settlementStateRows[0]?.invalid_count || 0);

    const { rows: hashInvariantRows } = await pool.query(
      `SELECT COUNT(*)::int AS invalid_count
         FROM oxsteed_credit_transaction_entries
        WHERE (sequence = 1 AND previous_entry_hash IS NOT NULL)
           OR (sequence > 1 AND previous_entry_hash IS NULL)`,
    );
    checks.invalidHashLinks = Number(hashInvariantRows[0]?.invalid_count || 0);

    const { rows: creditEntries } = await pool.query(
      `SELECT e.transaction_id, e.account_id, e.entry_side, e.amount_cents,
              e.balance_after_cents, e.sequence, e.previous_entry_hash,
              e.entry_hash, e.hash_key_version, e.metadata,
              t.transaction_type, t.currency_code
         FROM oxsteed_credit_transaction_entries e
         JOIN oxsteed_credit_transactions t ON t.id = e.transaction_id
        WHERE t.status = 'posted'
        ORDER BY e.account_id, e.sequence, e.id`,
    );
    const { rows: creditAccounts } = await pool.query(
      `SELECT id, ledger_version, last_entry_hash
         FROM oxsteed_credit_accounts`,
    );
    const hashVerification = verifyEntryHashes(creditEntries, creditAccounts);
    checks.invalidEntryHashes = hashVerification.invalidEntryHashes;
    checks.invalidHashChains = hashVerification.invalidHashChains;
    checks.invalidAccountHashHeads = hashVerification.invalidAccountHashHeads;

    if (checks.auditHashChainMigrationApplied) {
      const { rows: auditHashRows } = await pool.query(
        `SELECT COUNT(*)::int AS invalid_count
           FROM (
             SELECT e.id,
                    e.previous_event_hash,
                    e.event_hash,
                    LAG(e.event_hash) OVER (ORDER BY e.created_at ASC, e.id ASC) AS expected_previous_event_hash,
                    compute_oxsteed_credit_audit_event_hash(e.previous_event_hash, e) AS expected_event_hash
               FROM oxsteed_credit_audit_events e
           ) chain
          WHERE chain.previous_event_hash IS DISTINCT FROM chain.expected_previous_event_hash
             OR chain.event_hash IS DISTINCT FROM chain.expected_event_hash`,
      );
      checks.invalidAuditHashEvents = Number(auditHashRows[0]?.invalid_count || 0);
    } else {
      checks.invalidAuditHashEvents = 0;
    }

    const { rows: staleHoldRows } = await pool.query(
      `SELECT COUNT(*)::int AS stale_count
         FROM oxsteed_credit_holds
        WHERE status = 'active' AND expires_at <= NOW()`,
    );
    checks.expiredActiveHolds = Number(staleHoldRows[0]?.stale_count || 0);

    const blockingFailures = [
      !checks.foundationMigrationApplied,
      !checks.emergencyMigrationApplied,
      !checks.databaseIntegrityMigrationApplied,
      !checks.transactionImmutabilityMigrationApplied,
      !checks.holdIntegrityMigrationApplied,
      !checks.accountIntegrityMigrationApplied,
      !checks.transactionCurrencyIntegrityMigrationApplied,
      !checks.settlementIntegrityMigrationApplied,
      !checks.entryImmutabilityMigrationApplied,
      !checks.auditImmutabilityMigrationApplied,
      !checks.transactionTypeIntegrityMigrationApplied,
      !checks.identityStabilityMigrationApplied,
      !checks.settlementStateMigrationApplied,
      !checks.holdIdempotencyMigrationApplied,
      !checks.activeHoldLookupMigrationApplied,
      !checks.partnerAccountIntegrityMigrationApplied,
      !checks.activeAgreementMigrationApplied,
      !checks.customerOwnerMigrationApplied,
      !checks.entitlementOwnerMigrationApplied,
      !checks.currentOwnerMigrationApplied,
      !checks.partnerReportingMigrationApplied,
      !checks.agreementIdempotencyMigrationApplied,
      !checks.entitlementRequiredMigrationApplied,
      !checks.settlementCreatorMigrationApplied,
      !checks.settlementImmutabilityMigrationApplied,
      !checks.purchaseBoundaryMigrationApplied,
      !checks.agreementTermsImmutabilityMigrationApplied,
      !checks.userRoleGuardMigrationApplied,
      !checks.disputeIntegrityMigrationApplied,
      !checks.customerActivityMigrationApplied,
      !checks.issuanceTraceMigrationApplied,
      !checks.holdLifecycleMigrationApplied,
      !checks.settlementPeriodMigrationApplied,
      !checks.adjustmentDirectionMigrationApplied,
      !checks.reservedTransactionTypesMigrationApplied,
      !checks.disputeStatusEvidenceMigrationApplied,
      !checks.reservationConsistencyMigrationApplied,
      !checks.transactionStatusMigrationApplied,
      !checks.settlementPaymentEvidenceMigrationApplied,
      !checks.auditHashChainMigrationApplied,
      !checks.adminRefundEvidenceMigrationApplied,
      !checks.holdImmutabilityMigrationApplied,
      !checks.settlementCreationEvidenceMigrationApplied,
      !checks.identityRetentionMigrationApplied,
      !checks.idempotencyKeysMigrationApplied,
      !checks.refundBoundaryMigrationApplied,
      !checks.actorIdentityMigrationApplied,
      !checks.deactivationPolicyMigrationApplied,
      !checks.agreementStateMigrationApplied,
      !checks.agreementApprovalMigrationApplied,
      !checks.approvalHistoryMigrationApplied,
      !checks.accountStateMigrationApplied,
      !checks.suspendedExpiryMigrationApplied,
      !checks.partnerHoldReleaseMigrationApplied,
      !checks.restaurantStatusMigrationApplied,
      !checks.settlementApprovalMigrationApplied,
      !checks.issuanceActorEvidenceMigrationApplied,
      !checks.adminProvenanceMigrationApplied,
      !checks.settlementOverlapMigrationApplied,
      !checks.settlementReferenceMigrationApplied,
      !checks.accountLedgerWriteMigrationApplied,
      !checks.holdTerminalEvidenceMigrationApplied,
      !checks.disputeActorEvidenceMigrationApplied,
      !checks.holdActorEvidenceMigrationApplied,
      !checks.entitlementAgreementStateMigrationApplied,
      !checks.agreementEntitlementStateMigrationApplied,
      !checks.transactionActorOwnerMigrationApplied,
      !checks.purchaseReferenceMigrationApplied,
      !checks.restaurantStaffEvidenceMigrationApplied,
      !checks.purchaseReferenceUniquenessMigrationApplied,
      !checks.restaurantStaffRefundReasonMigrationApplied,
      !checks.purchaseActorEvidenceMigrationApplied,
      !checks.systemHoldReleaseEvidenceMigrationApplied,
      !checks.spendAccountStateMigrationApplied,
      !checks.notificationOutboxMigrationApplied,
      !checks.holdNotificationOutboxMigrationApplied,
      !checks.notificationRetentionMigrationApplied,
      !checks.workerHeartbeatMigrationApplied,
      !checks.notificationQueueIndexesMigrationApplied,
      !checks.ledgerHashKeyVersionMigrationApplied,
      !checks.velocityIndexesMigrationApplied,
      !checks.auditQueryIndexesMigrationApplied,
      !checks.entitlementIdempotencyMigrationApplied,
      !checks.entitlementRequestResultsMigrationApplied,
      !checks.entitlementActivityMigrationApplied,
      !checks.partnerLedgerMigrationApplied,
      !checks.emergencyFlagSeeded,
      checks.missingTables.length > 0,
      checks.missingColumns.length > 0,
      checks.missingIndexes.length > 0,
      checks.unsupportedCurrencyRecords.length > 0,
      checks.missingIntegrityTriggers.length > 0,
      checks.invalidPostedTransactions > 0,
      checks.invalidTransactionStates > 0,
      checks.invalidAdministrativeRefunds > 0,
      checks.invalidAccountBalances > 0,
      checks.invalidAccountLedgerStates > 0,
      checks.invalidReservedBalances > 0,
      checks.invalidHoldLifecycles > 0,
      checks.invalidHoldTerminalEvidence > 0,
      checks.invalidCustomerWalletOwners > 0,
      checks.invalidEntitlementOwners > 0,
      checks.invalidActiveEntitlementCustomers > 0,
      checks.invalidActiveEntitlementAgreements > 0,
      checks.invalidCreditIdempotencyKeys > 0,
      checks.invalidRefunds > 0,
      checks.invalidCreditActorIdentities > 0,
      checks.invalidCreditActorOwners > 0,
      checks.invalidCreditRestaurantStaffEvidence > 0,
      checks.invalidCreditRestaurantStaffRefundReasons > 0,
      checks.invalidCreditPurchaseReferenceUniqueness > 0,
      checks.invalidCreditPurchaseActorEvidence > 0,
      checks.invalidCreditIssuanceActors > 0,
      checks.invalidCreditCreatorEvidence > 0,
      checks.invalidSettlementOverlaps > 0,
      checks.invalidSettlementReferences > 0,
      checks.invalidActiveCreditHolds > 0,
      checks.invalidCreditSpendAccountStates > 0,
      checks.invalidCreditNotificationRecipients > 0,
      checks.invalidActiveAgreements > 0,
      checks.invalidActiveRestaurantPartners > 0,
      checks.invalidActiveAgreementApprovals > 0,
      checks.invalidClosedCreditAccounts > 0,
      checks.invalidPurchases > 0,
      checks.invalidPurchaseReferences > 0,
      checks.invalidPurchaseReferenceEvidence > 0,
      checks.invalidTransactionCurrencies > 0,
      checks.invalidSettlements > 0,
      checks.invalidSettlementStates > 0,
      checks.invalidTransactionTypes > 0,
      checks.invalidTransactionPartnerAccounts > 0,
      checks.invalidPartnerLedgers > 0,
      checks.invalidPartnerFundingRecords > 0,
      checks.invalidDisputes > 0,
      checks.invalidCreditDisputeActors > 0,
      checks.invalidCreditHoldActors > 0,
      checks.invalidHashLinks > 0,
      checks.invalidEntryHashes > 0,
      checks.invalidHashChains > 0,
      checks.invalidAccountHashHeads > 0,
      checks.invalidAuditHashEvents > 0,
    ].filter(Boolean).length;

    console.log(JSON.stringify({
      ok: blockingFailures === 0,
      checks,
      note: checks.expiredActiveHolds > 0
        ? 'Expired active holds are non-blocking but should be cleared by the hold-expiry worker.'
        : 'No expired active holds detected.',
    }, null, 2));
    process.exitCode = blockingFailures === 0 ? 0 : 1;
  } catch (error) {
    console.error(`verify-oxsteed-credit: ${error.message}`);
    process.exitCode = 1;
  } finally {
    await pool.end().catch(() => {});
  }
}

if (require.main === module) main();

module.exports = { REQUIRED_INDEXES, REQUIRED_INTEGRITY_TRIGGERS, findUnsupportedCurrencyRecords, verifyEntryHashes };
