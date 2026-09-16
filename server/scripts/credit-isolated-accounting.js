#!/usr/bin/env node
'use strict';

/*
 * Runs the high-value accounting and tenant-isolation journey inside the
 * disposable Credit environment. It intentionally uses synthetic identities
 * and never enables the production rail.
 */

const { Pool } = require('pg');

const databaseUrl = String(process.env.DATABASE_URL || '');
const databaseName = (() => {
  try {
    return new URL(databaseUrl).pathname.replace(/^\//, '').split('?')[0];
  } catch {
    return '';
  }
})();

if (process.env.NODE_ENV !== 'test' || !/^oxsteed_db$/.test(databaseName) || !process.env.CREDIT_TEST_PROJECT) {
  console.error('Refusing to run accounting verification outside the disposable Credit harness.');
  process.exit(1);
}

const pool = new Pool({ connectionString: databaseUrl, ssl: false, max: 5 });
const ADMIN_ID = '22222222-2222-4222-8222-222222222222';
const CUSTOMER_ONE = '66666666-6666-4666-8666-666666666666';
const CUSTOMER_TWO = '77777777-7777-4777-8777-777777777777';
const PARTNER_ONE = 901;
const PARTNER_TWO = 902;
const AGREEMENT_ONE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const RUN_ID = `isolated-accounting-${Date.now()}-${process.pid}`;

async function query(text, values = []) {
  return pool.query(text, values);
}

async function expectRejected(operation, code) {
  try {
    await operation();
  } catch (error) {
    if (error.code !== code) throw new Error(`Expected ${code}, received ${error.code || error.message}`);
    return;
  }
  throw new Error(`Expected ${code} rejection`);
}

async function run() {
  const {
    setCreditRailStatus,
    loadCustomerCredit,
    getCustomerCreditAccount,
    createCreditHold,
    captureCreditHold,
    refundCredit,
    transferCredit,
  } = require('../services/oxsteedCreditService');
  const { recordPartnerFunding, getPartnerLedger } = require('../services/oxsteedCreditPartnerLedgerService');

  const { rows: baselineAccounts } = await query(
    `SELECT id, account_type, customer_id, partner_id, balance_cents, reserved_cents
       FROM oxsteed_credit_accounts
      WHERE (customer_id = ANY($1::uuid[]) AND currency_code = 'USD')
         OR (partner_id = $2 AND currency_code = 'USD')
      ORDER BY id`,
    [[CUSTOMER_ONE, CUSTOMER_TWO], PARTNER_ONE]
  );
  const baselineById = new Map(baselineAccounts.map((account) => [String(account.id), account]));
  const baselineCustomerOne = Number(baselineById.get('12001')?.balance_cents || 0);
  const baselineCustomerTwo = Number(baselineById.get('12003')?.balance_cents || 0);
  const baselineLegacyWallet = await query(
    `SELECT balance_cents
       FROM food_customer_wallet_accounts
      WHERE id = 13001 AND restaurant_id = $1 AND customer_id = $2 AND currency_code = 'USD'`,
    [PARTNER_ONE, CUSTOMER_ONE]
  );
  const baselineJournal = await query(
    `SELECT COUNT(*) FILTER (WHERE transaction_type IN ('load', 'purchase', 'refund', 'transfer'))::int AS central_entries,
            COUNT(*) FILTER (WHERE transaction_type IN ('funding', 'reserve_release'))::int AS reserve_entries,
            COUNT(*) FILTER (WHERE partner_id = $1 AND transaction_type = 'purchase')::int AS partner_purchases
       FROM oxsteed_credit_transactions`,
    [PARTNER_ONE]
  );
  const baselineReserve = (await getPartnerLedger({ partnerId: PARTNER_ONE, currencyCode: 'USD' })).ledger.reserveAccount.balanceCents;

  const key = (suffix) => `${RUN_ID}-${suffix}`;

  await setCreditRailStatus({ enabled: true, actorUserId: ADMIN_ID, reason: 'Synthetic accounting verification only' });
  await loadCustomerCredit({
    customerId: CUSTOMER_ONE,
    amountCents: 5000,
    currencyCode: 'USD',
    idempotencyKey: key('load'),
    actorUserId: ADMIN_ID,
    reason: 'Synthetic accounting verification load',
    referenceType: 'isolated_funding',
    referenceId: key('funding-reference'),
  });

  const funding = await recordPartnerFunding({
    partnerId: PARTNER_ONE,
    currencyCode: 'USD',
    amountCents: 2000,
    direction: 'fund',
    externalReference: key('bank-transfer'),
    idempotencyKey: key('partner-funding'),
    actorUserId: ADMIN_ID,
    reason: 'Synthetic restaurant reserve funding',
  });
  const replay = await recordPartnerFunding({
    partnerId: PARTNER_ONE,
    currencyCode: 'USD',
    amountCents: 2000,
    direction: 'fund',
    externalReference: key('bank-transfer'),
    idempotencyKey: key('partner-funding'),
    actorUserId: ADMIN_ID,
    reason: 'Synthetic restaurant reserve funding',
  });
  if (funding.record.transactionId !== replay.record.transactionId || !replay.replayed) {
    throw new Error('Partner funding replay did not return the original transaction');
  }
  await recordPartnerFunding({
    partnerId: PARTNER_ONE,
    currencyCode: 'USD',
    amountCents: 500,
    direction: 'release',
    externalReference: key('bank-release'),
    idempotencyKey: key('partner-release'),
    actorUserId: ADMIN_ID,
    reason: 'Synthetic restaurant reserve release',
  });

  const hold = await createCreditHold({
    customerId: CUSTOMER_ONE,
    partnerId: PARTNER_ONE,
    amountCents: 600,
    currencyCode: 'USD',
    idempotencyKey: key('hold'),
    actorUserId: CUSTOMER_ONE,
    orderType: 'pickup',
    purpose: 'Synthetic restaurant authorization',
    referenceType: 'isolated_order',
    referenceId: key('order'),
  });
  const captured = await captureCreditHold({
    holdId: hold.hold.id,
    amountCents: 600,
    currencyCode: 'USD',
    idempotencyKey: key('capture'),
    actorUserId: ADMIN_ID,
    actorType: 'admin',
    orderType: 'pickup',
    referenceType: 'isolated_order',
    referenceId: key('order'),
    reason: 'Synthetic capture verification',
  });
  await refundCredit({
    purchaseTransactionId: captured.transaction.id,
    amountCents: 100,
    idempotencyKey: key('refund'),
    actorUserId: ADMIN_ID,
    reason: 'Synthetic partial refund verification',
  });
  await transferCredit({
    senderCustomerId: CUSTOMER_ONE,
    recipientCustomerId: CUSTOMER_TWO,
    amountCents: 200,
    currencyCode: 'USD',
    idempotencyKey: key('transfer'),
    actorUserId: CUSTOMER_ONE,
    referenceId: key('transfer-reference'),
  });
  await expectRejected(
    () => require('../services/oxsteedCreditService').purchaseWithCredit({
      customerId: CUSTOMER_ONE,
      partnerId: PARTNER_TWO,
      amountCents: 100,
      currencyCode: 'USD',
      idempotencyKey: key('cross-restaurant'),
      actorUserId: CUSTOMER_ONE,
      actorType: 'customer',
      orderType: 'pickup',
      referenceType: 'isolated_order',
      referenceId: key('cross-restaurant-reference'),
    }),
    'credit_partner_not_eligible'
  );

  const accountOne = await getCustomerCreditAccount(CUSTOMER_ONE, 'USD');
  const accountTwo = await getCustomerCreditAccount(CUSTOMER_TWO, 'USD');
  const ledger = await getPartnerLedger({ partnerId: PARTNER_ONE, currencyCode: 'USD' });
  const { rows: separation } = await query(
    `SELECT c.account_type AS credit_account_type, c.balance_cents AS credit_balance,
            w.id AS restaurant_wallet_id, w.balance_cents AS restaurant_wallet_balance
       FROM oxsteed_credit_accounts c
       JOIN food_customer_wallet_accounts w
         ON w.customer_id = c.customer_id AND w.restaurant_id = 901 AND w.currency_code = c.currency_code
      WHERE c.customer_id = $1 AND c.currency_code = 'USD'`,
    [CUSTOMER_ONE]
  );
  const separated = separation[0];
  if (!separated || separated.credit_account_type !== 'customer_wallet'
    || Number(separated.credit_balance) !== baselineCustomerOne + 4300
    || Number(separated.restaurant_wallet_balance) !== Number(baselineLegacyWallet.rows[0]?.balance_cents || 0)) {
    throw new Error(`Network and restaurant wallets were not isolated: ${JSON.stringify(separated)}`);
  }
  if (accountOne.balanceCents !== baselineCustomerOne + 4300 || accountTwo.balanceCents !== baselineCustomerTwo + 200
    || ledger.ledger.reserveAccount.balanceCents !== baselineReserve + 1500) {
    throw new Error(`Unexpected accounting totals: ${JSON.stringify({ accountOne, accountTwo, ledger: ledger.ledger })}`);
  }
  const { rows: journal } = await query(
    `SELECT COUNT(*) FILTER (WHERE transaction_type IN ('load', 'purchase', 'refund', 'transfer'))::int AS central_entries,
            COUNT(*) FILTER (WHERE transaction_type IN ('funding', 'reserve_release'))::int AS reserve_entries,
            COUNT(*) FILTER (WHERE partner_id = $1 AND transaction_type = 'purchase')::int AS partner_purchases
       FROM oxsteed_credit_transactions`,
    [PARTNER_ONE]
  );
  if (Number(journal[0].central_entries) - Number(baselineJournal.rows[0].central_entries) !== 4
    || Number(journal[0].reserve_entries) - Number(baselineJournal.rows[0].reserve_entries) !== 2
    || Number(journal[0].partner_purchases) - Number(baselineJournal.rows[0].partner_purchases) !== 1) {
    throw new Error(`Unexpected journal counts: ${JSON.stringify(journal[0])}`);
  }

  console.log(JSON.stringify({
    ok: true,
    database: databaseName,
    railEnabledOnlyInIsolatedFixture: true,
    workflows: ['load', 'partner-funding', 'funding-replay', 'reserve-release', 'hold-capture', 'partial-refund', 'customer-transfer', 'cross-restaurant-denial'],
    balances: { customerOneUsd: accountOne.balanceCents, customerTwoUsd: accountTwo.balanceCents, restaurantReserveUsd: ledger.ledger.reserveAccount.balanceCents, legacyRestaurantWalletUsd: Number(separated.restaurant_wallet_balance) },
    deltas: { customerOneUsd: 4300, customerTwoUsd: 200, restaurantReserveUsd: 1500, centralEntries: 4, reserveEntries: 2, partnerPurchases: 1 },
    journal: journal[0],
  }, null, 2));
}

run()
  .catch((error) => {
    console.error(`Isolated accounting verification failed: ${error.message} (${error.code || 'no_code'})`);
    if (error.fields && Object.keys(error.fields).length) console.error(`Validation fields: ${JSON.stringify(error.fields)}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end().catch(() => {});
  });
