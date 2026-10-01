'use strict';

/**
 * One-time backfill for the Phase 1 central-bank model (migration 632).
 *
 * For every (restaurant_id, currency_code) with food-wallet account history:
 *   1. auto-provisions the credit-partner row (pending) when missing,
 *   2. creates the restaurant_sub_bank account when missing,
 *   3. posts a single `sub_bank_opening_balance` journal entry
 *      (platform_treasury -> restaurant_sub_bank) for the current aggregate
 *      outstanding, bringing the sub-bank into agreement with the wallets.
 *
 * Idempotent and re-runnable: the opening-balance posting uses the
 * deterministic idempotency key `sub-bank-opening:<restaurantId>:<currency>`,
 * so a re-run replays (or skips when balances already agree) instead of
 * double-posting. Restaurants already in agreement are skipped.
 *
 * Why a script and not part of migration 632: journal postings require the
 * ledger HMAC secret (OXSTEED_CREDIT_LEDGER_HMAC_SECRET) and must never block
 * the deploy pipeline. Run this explicitly after deploy with the ledger
 * secret configured:
 *
 *   npm run backfill:sub-banks
 *
 * NOTE: this deliberately does NOT assert the credit rail kill switch. The
 * backfill records pre-existing obligations; it is not new money movement.
 */

const pool = require('../db');
const logger = require('../utils/logger');
const { withTransaction } = require('../utils/transaction');
const {
  ensureAccount,
  postJournalTransaction,
  assertSupportedCreditCurrency,
} = require('../services/oxsteedCreditService');
const {
  SUB_BANK_OPENING_BALANCE,
  ensureRestaurantPartner,
  ensureRestaurantSubBankAccount,
  getRestaurantWalletOutstanding,
} = require('../services/oxsteedCreditSubBankService');

function openingBalanceIdempotencyKey(restaurantId, currencyCode) {
  return `sub-bank-opening:${restaurantId}:${currencyCode}`;
}

async function backfillRestaurant(client, { restaurantId, currencyCode, totalBalanceCents }) {
  const currency = assertSupportedCreditCurrency(currencyCode);
  const outstanding = Number(totalBalanceCents || 0);

  const partner = await ensureRestaurantPartner(client, restaurantId);
  const subBank = await ensureRestaurantSubBankAccount(client, { restaurantId, currencyCode: currency });
  const subBankBalance = Number(subBank.balance_cents || 0);

  if (subBankBalance === outstanding) {
    return { restaurantId, currencyCode: currency, action: 'skipped_in_agreement', postedCents: 0 };
  }
  if (outstanding < 0) {
    throw new Error(`Unexpected negative wallet aggregate for restaurant ${restaurantId} (${currency}): ${outstanding}`);
  }
  if (subBankBalance !== 0) {
    // Partial state (e.g. a previous interrupted run that posted without the
    // idempotency key taking effect). Refuse to guess; needs operator review.
    throw new Error(
      `Sub-bank for restaurant ${restaurantId} (${currency}) has balance ${subBankBalance} ` +
      `but wallets total ${outstanding}; manual reconciliation required`
    );
  }
  if (outstanding === 0) {
    return { restaurantId, currencyCode: currency, action: 'skipped_zero_outstanding', postedCents: 0 };
  }

  const treasury = await ensureAccount(client, { accountType: 'platform_treasury', currencyCode: currency });
  const { transaction, replayed } = await postJournalTransaction(client, {
    transactionType: SUB_BANK_OPENING_BALANCE,
    debitAccountId: treasury.id,
    creditAccountId: subBank.id,
    amountCents: outstanding,
    currencyCode: currency,
    partnerId: partner.id,
    agreementId: null,
    idempotencyKey: openingBalanceIdempotencyKey(restaurantId, currency),
    referenceType: 'sub_bank_backfill',
    referenceId: `${restaurantId}:${currency}`,
    description: `Restaurant sub-bank opening balance (backfill) for restaurant ${restaurantId}`,
    reason: 'Backfill pre-existing restaurant credit outstanding onto the central journal',
    actorType: 'system',
    actorUserId: null,
    customerId: null,
    correlationId: null,
    requestIp: null,
    metadata: { backfill: true, restaurantId, walletTotalBalanceCents: outstanding },
    bindIdempotencySemantics: true,
  });
  return {
    restaurantId,
    currencyCode: currency,
    action: replayed ? 'replayed_existing' : 'posted_opening_balance',
    postedCents: outstanding,
    transactionId: transaction.id,
  };
}

async function main() {
  const totals = await getRestaurantWalletOutstanding(pool);
  logger.info('Starting restaurant sub-bank backfill', { restaurantCount: totals.length });
  const results = [];
  const failures = [];
  for (const row of totals) {
    const label = `restaurant ${row.restaurant_id} ${row.currency_code}`;
    try {
      const result = await withTransaction(
        pool,
        (client) => backfillRestaurant(client, {
          restaurantId: Number(row.restaurant_id),
          currencyCode: row.currency_code,
          totalBalanceCents: Number(row.total_balance_cents || 0),
        }),
        'sub_bank_backfill'
      );
      results.push(result);
      logger.info(`Sub-bank backfill ${result.action}`, { label, postedCents: result.postedCents });
    } catch (error) {
      failures.push({ restaurantId: Number(row.restaurant_id), currencyCode: row.currency_code, error: error.message });
      logger.error('Sub-bank backfill failed', { label, error: error.message });
    }
  }

  const posted = results.filter((r) => r.action === 'posted_opening_balance');
  const postedCents = posted.reduce((sum, r) => sum + r.postedCents, 0);
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({
    restaurants: totals.length,
    posted: posted.length,
    postedCents,
    skipped: results.length - posted.length,
    failures,
  }, null, 2));

  await pool.end();
  if (failures.length > 0) process.exitCode = 1;
}

if (require.main === module) {
  main().catch((error) => {
    // eslint-disable-next-line no-console
    console.error('Sub-bank backfill aborted:', error.message);
    process.exitCode = 1;
  });
}

module.exports = { backfillRestaurant, openingBalanceIdempotencyKey };
