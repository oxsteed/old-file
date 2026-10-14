'use strict';

/**
 * Phase 6 (restaurant credit protection): the revocation path.
 *
 * When a restaurant LOSES platform approval to offer credit:
 *   1. New credit is blocked immediately (fail closed): customer load
 *      requests and merchant approvals both throw
 *      403 `restaurant_credit_not_approved` while the approval status is
 *      'pending', 'suspended', or 'revoked'.
 *   2. Existing balances get a 30-day grace period (set on 'revoked' only;
 *      'suspended' is reversible and does not start the clock).
 *   3. When the grace period ends, processRevocationGracePeriods migrates
 *      each remaining customer balance into OxSteed Credit so customers are
 *      not stranded.
 *
 * The migration is atomic per customer: the restaurant wallet is debited to
 * zero (available balance only; held funds stay until their holds release)
 * through the SAME audited `restaurant_conversion_out` dual-posting path the
 * customer-initiated conversion uses, so the central journal posts the
 * sub_bank_conversion leg (restaurant_sub_bank -> customer_wallet) in the
 * same transaction. That is the OxSteed Credit crediting step: when the
 * credit rail is on, the customer's OxSteed wallet is credited in the same
 * transaction that zeroes the restaurant wallet. When the rail is off the
 * worker fails closed and retries on the next run (recorded as a 'failed'
 * migration; the balance is left untouched).
 *
 * Money rule: on ANY error inside the per-customer transaction the wallet
 * balance is left untouched. Failed migrations are recorded separately with
 * their failure code so ops can see and retry them; a 'failed' row never
 * overwrites a 'completed' row.
 *
 * The worker is idempotent: a completed migration for the restaurant +
 * customer + revocation is never re-run, and a concurrent run serializes on
 * the wallet account row lock.
 */

const crypto = require('crypto');
const pool = require('../db');
const { withTransaction } = require('../utils/transaction');
const { AppError } = require('../middleware/errorHandler');
const logger = require('../utils/logger');
const { debitFoodWallet } = require('./foodWalletService');
const { assertCreditRailEnabled } = require('./oxsteedCreditService');
const { assertSanctionsClear } = require('./sanctionsScreeningService');

// Grandfather rule: a restaurant with NO approval row is treated as
// 'approved' so existing restaurants keep working until an admin acts.
const APPROVAL_STATUSES = new Set(['pending', 'approved', 'suspended', 'revoked']);
// Fail closed: any non-approved status blocks NEW credit issuance. Only
// 'approved' (or no row) may issue.
const NEW_CREDIT_BLOCKED_STATUSES = new Set(['pending', 'suspended', 'revoked']);

const GRACE_PERIOD_DAYS = 30;
const REVOCATION_MIGRATION_SOURCE = 'revocation_auto_migration';

function normalizeApprovalStatus(value) {
  const status = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return APPROVAL_STATUSES.has(status) ? status : null;
}

function formatApproval(row) {
  if (!row) {
    return {
      restaurantId: null,
      status: 'approved',
      grandfathered: true,
      approvedAt: null,
      revokedAt: null,
      revocationReason: null,
      gracePeriodEndsAt: null,
      migratedAt: null,
      updatedAt: null,
    };
  }
  return {
    restaurantId: Number(row.restaurant_id),
    status: row.status,
    grandfathered: false,
    approvedAt: row.approved_at || null,
    revokedAt: row.revoked_at || null,
    revocationReason: row.revocation_reason || null,
    gracePeriodEndsAt: row.grace_period_ends_at || null,
    migratedAt: row.migrated_at || null,
    updatedAt: row.updated_at || null,
  };
}

async function getCreditApproval(executor, restaurantId) {
  const { rows } = await executor.query(
    `SELECT * FROM restaurant_credit_approvals WHERE restaurant_id = $1 LIMIT 1`,
    [restaurantId]
  );
  return rows[0] || null;
}

function effectiveApprovalStatus(approvalRow) {
  return approvalRow ? approvalRow.status : 'approved';
}

/**
 * Fail-closed gate for new credit issuance. Throws 403
 * `restaurant_credit_not_approved` when the restaurant's approval status is
 * anything other than 'approved' (no row counts as approved).
 */
async function assertNewRestaurantCreditAllowed(executor, restaurantId) {
  const approval = await getCreditApproval(executor, restaurantId);
  const status = effectiveApprovalStatus(approval);
  if (NEW_CREDIT_BLOCKED_STATUSES.has(status)) {
    throw new AppError('This restaurant is not approved to issue new credit', 403, 'restaurant_credit_not_approved', {
      restaurantId: String(restaurantId),
      approvalStatus: status,
      gracePeriodEndsAt: approval && approval.grace_period_ends_at
        ? new Date(approval.grace_period_ends_at).toISOString()
        : null,
    });
  }
  return approval;
}

function migrationIdempotencyKey(restaurantId, customerId, revokedAtEpoch) {
  return `revocation-migration:${restaurantId}:${customerId}:${revokedAtEpoch}`;
}

async function claimDueRevocations(limit) {
  return withTransaction(pool, async (client) => {
    const { rows } = await client.query(
      `SELECT *
         FROM restaurant_credit_approvals
        WHERE status = 'revoked'
          AND grace_period_ends_at < NOW()
          AND migrated_at IS NULL
        ORDER BY grace_period_ends_at ASC
        LIMIT $1
        FOR UPDATE SKIP LOCKED`,
      [Math.max(1, Math.min(limit || 100, 1000))]
    );
    return rows;
  }, 'credit_revocation_claim');
}

async function recordFailedMigration({ restaurantId, account, revokedAtEpoch, error }) {
  const customerId = String(account.customer_id);
  const key = migrationIdempotencyKey(restaurantId, customerId, revokedAtEpoch);
  const failureCode = String((error && error.code) || 'migration_failed').slice(0, 80);
  const failureMessage = String((error && error.message) || 'Unknown error').slice(0, 500);
  const currencyCode = String(account.currency_code || 'USD').toUpperCase().slice(0, 3);
  try {
    await pool.query(
      `INSERT INTO restaurant_credit_migrations
         (customer_id, restaurant_id, amount_cents, currency_code, status,
          failure_code, failure_message, idempotency_key)
       VALUES ($1, $2, $3, $4, 'failed', $5, $6, $7)
       ON CONFLICT (idempotency_key) DO UPDATE
         SET status = EXCLUDED.status,
             failure_code = EXCLUDED.failure_code,
             failure_message = EXCLUDED.failure_message,
             created_at = NOW()
       WHERE restaurant_credit_migrations.status <> 'completed'`,
      [
        customerId,
        restaurantId,
        Math.max(1, Math.round(Number(account.balance_cents || 0))),
        currencyCode,
        failureCode,
        failureMessage,
        key,
      ]
    );
  } catch (recordError) {
    logger.error('[RevocationMigration] failed to record a failed migration', {
      restaurantId: String(restaurantId),
      customerId,
      error: recordError.message,
    });
  }
}

/**
 * Migrates one customer's available restaurant wallet balance into OxSteed
 * Credit. The wallet debit + migration record commit atomically; any error
 * rolls the whole transaction back and the balance is untouched.
 */
async function migrateAccountBalance({ restaurantId, account, revokedAtEpoch }) {
  const customerId = String(account.customer_id);
  const key = migrationIdempotencyKey(restaurantId, customerId, revokedAtEpoch);

  return withTransaction(pool, async (client) => {
    // Idempotency: a completed migration for this revocation is never re-run.
    const { rows: existing } = await client.query(
      `SELECT id FROM restaurant_credit_migrations
        WHERE idempotency_key = $1 AND status = 'completed' LIMIT 1`,
      [key]
    );
    if (existing[0]) {
      return { migrated: false, reason: 'already_migrated', amountCents: 0 };
    }

    // Fail closed like the customer-initiated conversion path: the rail must
    // be on and unfrozen, otherwise the balance stays and we retry later.
    await assertCreditRailEnabled(client);

    const { rows: lockedRows } = await client.query(
      `SELECT * FROM food_customer_wallet_accounts WHERE id = $1 FOR UPDATE`,
      [account.id]
    );
    const wallet = lockedRows[0];
    if (!wallet || wallet.status !== 'active') {
      return { migrated: false, reason: 'account_not_active', amountCents: 0 };
    }
    // Only the available balance migrates; funds held for in-flight payment
    // sessions stay until the holds release (a later run picks them up).
    const availableCents = Number(wallet.balance_cents || 0) - Number(wallet.reserved_cents || 0);
    if (!Number.isSafeInteger(availableCents) || availableCents <= 0) {
      return { migrated: false, reason: 'no_available_balance', amountCents: 0 };
    }

    // The customer receives OxSteed Credit: screen them first (same control
    // as the customer-initiated conversion path).
    await assertSanctionsClear(client, {
      subjectType: 'customer',
      subjectId: customerId,
      context: { operation: REVOCATION_MIGRATION_SOURCE, restaurantId },
    });

    const currencyCode = String(wallet.currency_code || 'USD').toUpperCase();
    const migrationId = crypto.randomUUID();

    // The debit dual-posts through the audited conversion_out path: the
    // central journal posts sub_bank_conversion (restaurant_sub_bank ->
    // customer_wallet) in THIS transaction when the rail is on. That is the
    // OxSteed Credit crediting step. 1:1: revoked customers are not haircut.
    const { entry } = await debitFoodWallet(client, {
      restaurantId,
      customerId,
      currencyCode,
      amountCents: availableCents,
      description: 'Revocation migration: restaurant credit moved to OxSteed Credit (grace period ended)',
      referenceType: 'restaurant_conversion_out',
      referenceId: migrationId,
      idempotencyKey: `revocation-migration:${migrationId}:wallet-debit`,
      createdByUserId: null,
      correlationId: `revocation-migration:${migrationId}`,
      actorType: 'system',
      metadata: {
        revocationMigrationId: migrationId,
        source: REVOCATION_MIGRATION_SOURCE,
        restaurantId,
        // 1:1 conversion: the converted OxSteed amount equals the migrated
        // restaurant balance.
        conversionConvertedAmountCents: availableCents,
      },
    });

    const { rows: [migrationRow] } = await client.query(
      `INSERT INTO restaurant_credit_migrations
         (customer_id, restaurant_id, amount_cents, currency_code,
          wallet_ledger_entry_id, status, idempotency_key, migrated_at)
       VALUES ($1, $2, $3, $4, $5, 'completed', $6, NOW())
       ON CONFLICT (idempotency_key) DO NOTHING
       RETURNING *`,
      [customerId, restaurantId, availableCents, currencyCode, entry.id, key]
    );
    // Defensive: a concurrent pass with the same key won the race.
    if (!migrationRow) {
      return { migrated: false, reason: 'already_migrated', amountCents: 0 };
    }

    logger.info('[RevocationMigration] migrated customer balance to OxSteed Credit', {
      restaurantId: String(restaurantId),
      customerId,
      amountCents: availableCents,
      currencyCode,
      migrationId,
      walletLedgerEntryId: String(entry.id),
    });
    return { migrated: true, reason: 'migrated', amountCents: availableCents, migrationId };
  }, 'credit_revocation_migrate_account');
}

async function migrateRestaurantBalances(approval, summary) {
  const restaurantId = Number(approval.restaurant_id);
  const revokedAtEpoch = approval.revoked_at
    ? Math.floor(new Date(approval.revoked_at).getTime() / 1000)
    : 0;

  const { rows: accounts } = await pool.query(
    `SELECT id, customer_id, currency_code, balance_cents,
            COALESCE(reserved_cents, 0) AS reserved_cents, status
       FROM food_customer_wallet_accounts
      WHERE restaurant_id = $1
        AND balance_cents > 0
      ORDER BY id ASC`,
    [restaurantId]
  );

  for (const account of accounts) {
    try {
      const result = await migrateAccountBalance({ restaurantId, account, revokedAtEpoch });
      if (result.migrated) {
        summary.customersMigrated += 1;
        summary.totalMigratedCents += result.amountCents;
      } else {
        summary.customersSkipped += 1;
      }
    } catch (error) {
      summary.customersFailed += 1;
      // The per-customer transaction rolled back: the balance is untouched.
      await recordFailedMigration({ restaurantId, account, revokedAtEpoch, error });
      logger.warn('[RevocationMigration] customer migration failed; balance untouched, will retry', {
        restaurantId: String(restaurantId),
        customerId: String(account.customer_id),
        code: error && error.code,
        error: error && error.message,
      });
    }
  }

  // Only mark the restaurant migrated when no migratable balance remains.
  // Failed migrations leave balances untouched, so the next run retries them.
  const { rows: [remaining] } = await pool.query(
    `SELECT COUNT(*)::int AS n
       FROM food_customer_wallet_accounts
      WHERE restaurant_id = $1
        AND (balance_cents - COALESCE(reserved_cents, 0)) > 0`,
    [restaurantId]
  );
  if (remaining && remaining.n === 0) {
    await pool.query(
      `UPDATE restaurant_credit_approvals
          SET migrated_at = NOW(), updated_at = NOW()
        WHERE restaurant_id = $1`,
      [restaurantId]
    );
    logger.info('[RevocationMigration] restaurant fully migrated', {
      restaurantId: String(restaurantId),
    });
  } else {
    logger.info('[RevocationMigration] restaurant has remaining balances; will retry', {
      restaurantId: String(restaurantId),
      remaining: remaining ? remaining.n : null,
    });
  }
  summary.restaurantsProcessed += 1;
}

/**
 * Grace-period sweeper: finds revoked restaurants whose grace period has
 * ended and migrates remaining customer balances to OxSteed Credit.
 * Exported for the scheduled worker (see workers/scheduledWorkerSchedule.js).
 */
async function processRevocationGracePeriods({ limit = 100 } = {}) {
  const summary = {
    restaurantsProcessed: 0,
    customersMigrated: 0,
    customersFailed: 0,
    customersSkipped: 0,
    totalMigratedCents: 0,
  };
  const approvals = await claimDueRevocations(limit);
  if (!approvals.length) {
    return { ...summary, ran: false };
  }
  for (const approval of approvals) {
    try {
      await migrateRestaurantBalances(approval, summary);
    } catch (error) {
      logger.error('[RevocationMigration] restaurant pass failed', {
        restaurantId: String(approval.restaurant_id),
        error: error.message,
        code: error.code,
      });
    }
  }
  logger.info('[RevocationMigration] grace-period pass complete', summary);
  return { ...summary, ran: true };
}

module.exports = {
  GRACE_PERIOD_DAYS,
  NEW_CREDIT_BLOCKED_STATUSES,
  formatApproval,
  getCreditApproval,
  effectiveApprovalStatus,
  normalizeApprovalStatus,
  assertNewRestaurantCreditAllowed,
  processRevocationGracePeriods,
  migrateAccountBalance,
};
