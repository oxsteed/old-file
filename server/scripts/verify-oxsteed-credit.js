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
} = require('../services/oxsteedCreditService');

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
  'oxsteed_credit_entitlement_bulk_requests',
  'oxsteed_credit_entitlement_requests',
  'cron_job_locks',
];

const REQUIRED_COLUMNS = {
  oxsteed_credit_accounts: ['balance_cents', 'reserved_cents', 'ledger_version', 'last_entry_hash'],
  oxsteed_credit_audit_events: ['previous_event_hash', 'event_hash'],
  oxsteed_credit_transactions: ['idempotency_key', 'posted_at', 'partner_id', 'agreement_id'],
  oxsteed_credit_transaction_entries: ['entry_hash', 'previous_entry_hash', 'sequence'],
  oxsteed_credit_holds: ['capture_idempotency_key', 'expires_at'],
  oxsteed_credit_partner_agreements: ['creation_idempotency_key', 'creation_request_hash', 'requires_customer_entitlement'],
  oxsteed_credit_settlements: ['created_by', 'creation_reason', 'creation_request_hash'],
  oxsteed_credit_disputes: ['idempotency_key'],
  oxsteed_credit_entitlement_bulk_requests: ['request_hash', 'customer_id', 'agreement_ids'],
  oxsteed_credit_entitlement_requests: ['request_hash', 'customer_id', 'agreement_id'],
  cron_job_locks: ['lock_id', 'lock_value', 'acquired_at', 'expires_at'],
};

const REQUIRED_INDEXES = [
  'idx_oxsteed_credit_holds_idempotency',
  'idx_oxsteed_credit_holds_customer_agreement_active',
  'uq_oxsteed_credit_one_active_agreement',
  'idx_oxsteed_credit_transactions_partner_reporting',
  'idx_oxsteed_credit_transactions_debit_posted_history',
  'idx_oxsteed_credit_transactions_credit_posted_history',
  'uq_oxsteed_credit_agreement_creation_idempotency',
  'idx_oxsteed_credit_disputes_customer_history',
  'idx_oxsteed_credit_disputes_status_history',
  'uq_oxsteed_credit_dispute_idempotency',
  'idx_oxsteed_credit_entitlement_bulk_requests_customer',
  'idx_oxsteed_credit_entitlement_requests_customer',
  'idx_oxsteed_credit_entitlement_requests_agreement',
  'uq_oxsteed_credit_audit_event_hash',
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
  'oxsteed_credit_hold_customer_activity_guard',
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
    });
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
          AND tgrelid IN ('oxsteed_credit_transactions'::regclass, 'oxsteed_credit_transaction_entries'::regclass, 'oxsteed_credit_holds'::regclass, 'oxsteed_credit_accounts'::regclass, 'oxsteed_credit_settlements'::regclass, 'oxsteed_credit_audit_events'::regclass, 'oxsteed_credit_partners'::regclass, 'oxsteed_credit_partner_agreements'::regclass, 'oxsteed_credit_disputes'::regclass, 'users'::regclass)
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
          AND (actor_user_id IS NULL OR NULLIF(BTRIM(reason), '') IS NULL)`,
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
           OR t.transaction_type IN ('fee', 'expiration', 'chargeback'))`,
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

    const { rows: settlementStateRows } = await pool.query(
      `SELECT COUNT(*)::int AS invalid_count
         FROM oxsteed_credit_settlements
        WHERE (status = 'paid' AND paid_at IS NULL)
           OR (status = 'paid' AND net_cents > 0 AND NULLIF(BTRIM(payment_reference), '') IS NULL)
           OR (status IN ('approved', 'paid') AND approved_by IS NULL)
           OR (status = 'paid' AND net_cents > 0 AND NOT EXISTS (
                SELECT 1
                  FROM oxsteed_credit_transactions t
                 WHERE t.transaction_type = 'settlement'
                   AND t.status = 'posted'
                   AND t.partner_id = oxsteed_credit_settlements.partner_id
                   AND t.agreement_id = oxsteed_credit_settlements.agreement_id
                   AND t.amount_cents = oxsteed_credit_settlements.net_cents
                   AND t.currency_code = oxsteed_credit_settlements.currency_code
                   AND t.reference_type = 'credit_settlement'
                   AND t.reference_id = oxsteed_credit_settlements.id::TEXT
                   AND t.metadata->>'paymentReference' = oxsteed_credit_settlements.payment_reference
              ))
           OR (creation_reason IS NULL) IS DISTINCT FROM (creation_request_hash IS NULL)
           OR (creation_request_hash IS NOT NULL
               AND creation_request_hash !~ '^[a-f0-9]{64}$')`,
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
              e.entry_hash, e.metadata, t.transaction_type, t.currency_code
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
      !checks.entitlementIdempotencyMigrationApplied,
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
      checks.invalidReservedBalances > 0,
      checks.invalidHoldLifecycles > 0,
      checks.invalidCustomerWalletOwners > 0,
      checks.invalidEntitlementOwners > 0,
      checks.invalidPurchases > 0,
      checks.invalidPurchaseReferences > 0,
      checks.invalidTransactionCurrencies > 0,
      checks.invalidSettlements > 0,
      checks.invalidSettlementStates > 0,
      checks.invalidTransactionTypes > 0,
      checks.invalidTransactionPartnerAccounts > 0,
      checks.invalidDisputes > 0,
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
