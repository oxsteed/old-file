'use strict';

/**
 * Backfill Credit lots for balances that predate lot tagging.
 *
 * Existing balances have no recorded origin. The rule, from the
 * credit-origin verification: every existing cent becomes an `unknown`
 * lot (INELIGIBLE) EXCEPT provably completed top-ups, which become
 * `purchased` settled lots. Never claim a balance is eligible that the
 * records cannot prove.
 *
 * Provable purchase: a top-up row with status `completed` and a posted
 * journal transaction (journal_transaction_id set). The lot is settled
 * at the top-up updated_at and tagged with the top-up id and the journal
 * transaction id, so a second run can never double-tag it.
 *
 * Idempotent: an account whose lots already cover its balance is
 * skipped; a partial run only creates the missing remainder. Dry-run
 * counts without writing. Counts only, no personal identifiers in the
 * output.
 */

const pool = require('../../db');
const { withTransaction } = require('../../utils/transaction');
const { createLot } = require('./creditLots');

async function backfillAccount(client, account, { apply }) {
  const customerId = String(account.customer_id);
  const currency = account.currency_code;
  const balance = Number(account.balance_cents || 0);
  if (balance <= 0) return { skipped: true, purchasedLots: 0, unknownLots: 0, purchasedCents: 0, unknownCents: 0 };

  const { rows: lotRows } = await client.query(
    `SELECT source, COALESCE(SUM(amount_cents), 0)::bigint AS total
       FROM oxsteed_credit_balance_lots
      WHERE account_id = $1 GROUP BY source`,
    [account.id],
  );
  const existingTotal = lotRows.reduce((sum, row) => sum + Number(row.total || 0), 0);
  if (existingTotal >= balance) {
    return { skipped: true, purchasedLots: 0, unknownLots: 0, purchasedCents: 0, unknownCents: 0 };
  }

  const { rows: topups } = await client.query(
    `SELECT t.id, t.amount_cents, t.updated_at, t.journal_transaction_id
       FROM oxsteed_credit_topups t
      WHERE t.customer_id = $1 AND t.currency_code = $2
        AND t.status = 'completed' AND t.journal_transaction_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM oxsteed_credit_balance_lots l WHERE l.topup_id = t.id
        )
      ORDER BY t.updated_at ASC`,
    [customerId, currency],
  );

  let purchasedCents = 0;
  let purchasedLots = 0;
  // A completed top-up is provable only up to the still-untagged balance.
  let untagged = balance - existingTotal;
  for (const topup of topups) {
    if (untagged <= 0) break;
    const amount = Math.min(Number(topup.amount_cents || 0), untagged);
    if (amount <= 0) continue;
    if (apply) {
      await createLot(client, {
        accountId: account.id,
        customerId,
        currencyCode: currency,
        source: 'purchased',
        amountCents: amount,
        settledAt: topup.updated_at,
        originatingTransactionId: topup.journal_transaction_id,
        topupId: topup.id,
        referenceType: 'stripe_topup',
        referenceId: String(topup.id),
        metadata: { backfill: true },
      });
    }
    purchasedCents += amount;
    purchasedLots += 1;
    untagged -= amount;
  }

  let unknownCents = 0;
  let unknownLots = 0;
  if (untagged > 0) {
    if (apply) {
      await createLot(client, {
        accountId: account.id,
        customerId,
        currencyCode: currency,
        source: 'unknown',
        amountCents: untagged,
        settledAt: null,
        referenceType: 'backfill',
        referenceId: `account:${account.id}`,
        metadata: { backfill: true },
      });
    }
    unknownCents = untagged;
    unknownLots = 1;
  }

  return { skipped: false, purchasedLots, unknownLots, purchasedCents, unknownCents };
}

async function runInvestCreditBackfill({ mode = 'dry_run', batchSize = 500 } = {}, dbPool = pool) {
  const apply = mode === 'apply';
  const counts = {
    accountsExamined: 0,
    accountsSkipped: 0,
    accountsBackfilled: 0,
    purchasedLots: 0,
    unknownLots: 0,
    purchasedCents: 0,
    unknownCents: 0,
  };
  let offset = 0;
  for (;;) {
    const { rows: accounts } = await dbPool.query(
      `SELECT id, customer_id, currency_code, balance_cents
         FROM oxsteed_credit_accounts
        WHERE account_type = 'customer_wallet' AND balance_cents > 0
        ORDER BY id ASC LIMIT $1 OFFSET $2`,
      [batchSize, offset],
    );
    if (!accounts.length) break;
    for (const account of accounts) {
      counts.accountsExamined += 1;
      const result = await withTransaction(dbPool, async (client) => backfillAccount(client, account, { apply }), 'invest_credit_backfill');
      if (result.skipped) {
        counts.accountsSkipped += 1;
      } else {
        counts.accountsBackfilled += 1;
        counts.purchasedLots += result.purchasedLots;
        counts.unknownLots += result.unknownLots;
        counts.purchasedCents += result.purchasedCents;
        counts.unknownCents += result.unknownCents;
      }
    }
    offset += accounts.length;
    if (accounts.length < batchSize) break;
  }
  return { mode: apply ? 'apply' : 'dry_run', status: 'complete', counts };
}

module.exports = { runInvestCreditBackfill, backfillAccount };
