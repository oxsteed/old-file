#!/usr/bin/env node
'use strict';

const pool = require('../db');
const { withTransaction } = require('../utils/transaction');
const {
  setCreditRailStatus,
  loadCustomerCredit,
  ensureAccount,
  postJournalTransaction,
  purchaseWithCredit,
  purchaseWithCreditInTransaction,
  transferCreditInTransaction,
  adjustCustomerCreditInTransaction,
  createCreditHold,
  captureCreditHoldInTransaction,
  releaseCreditHold,
  refundCreditInTransaction,
} = require('../services/oxsteedCreditService');
const { recordPartnerFundingInTransaction } = require('../services/oxsteedCreditPartnerLedgerService');
const {
  createCurrencyQuote,
  convertCustomerCreditInTransaction,
} = require('../services/oxsteedCreditCurrencyConversionService');
const {
  issueVirtualCard,
  setCardPin,
  cashOutWithCardInTransaction,
} = require('../services/oxsteedCreditCardService');

const databaseUrl = String(process.env.DATABASE_URL || '');
const databaseName = (() => {
  try {
    return new URL(databaseUrl).pathname.replace(/^\//, '').split('?')[0];
  } catch {
    return '';
  }
})();

if (process.env.NODE_ENV !== 'test'
  || process.env.CREDIT_FAILURE_INJECTION_TEST_MODE !== 'true'
  || databaseName !== 'oxsteed_db'
  || !/^oxsteed-credit-test-[a-z0-9-]+$/.test(String(process.env.CREDIT_TEST_PROJECT || ''))) {
  throw new Error('Refusing Credit failure injection outside the disposable test harness.');
}

const CUSTOMER_ACCOUNT_ID = 12001;
const CUSTOMER_ID = '66666666-6666-4666-8666-666666666666';
const PARTNER_ID = 901;
const PARTNER_FUNDING_PARTNER_ID = 902;
const ADMIN_ID = '22222222-2222-4222-8222-222222222222';
const RUN_ID = `isolated-failure-${Date.now()}-${process.pid}`;

async function query(text, values = []) {
  return pool.query(text, values);
}

async function accountSnapshot(accountId = CUSTOMER_ACCOUNT_ID) {
  const { rows } = await query(
    `SELECT balance_cents::text, reserved_cents::text, ledger_version::text
       FROM oxsteed_credit_accounts
      WHERE id = $1`,
    [accountId]
  );
  if (!rows[0]) throw new Error(`Synthetic customer account ${accountId} is missing; seed the isolated fixture first.`);
  return rows[0];
}

async function holdSnapshot(holdId) {
  const { rows } = await query(
    `SELECT status, amount_cents::text, capture_idempotency_key, captured_transaction_id
       FROM oxsteed_credit_holds
      WHERE id = $1`,
    [holdId]
  );
  if (!rows[0]) throw new Error(`Synthetic hold ${holdId} is missing.`);
  return rows[0];
}

async function currencyAccountSnapshot(customerId, currencyCode) {
  const { rows } = await query(
    `SELECT id, balance_cents::text, reserved_cents::text, ledger_version::text
       FROM oxsteed_credit_accounts
      WHERE customer_id = $1
        AND account_type = 'customer_wallet'
        AND currency_code = $2`,
    [customerId, currencyCode]
  );
  return rows[0] || null;
}

async function conversionSnapshot(quoteId, idempotencyKey) {
  const { rows } = await query(
    `SELECT
        (SELECT status FROM oxsteed_credit_currency_quotes WHERE id = $1) AS quote_status,
        (SELECT COUNT(*)::int
           FROM oxsteed_credit_currency_conversions
          WHERE idempotency_key = $2) AS conversion_count,
        (SELECT COUNT(*)::int
           FROM oxsteed_credit_transactions
          WHERE reference_type = 'currency_conversion'
            AND metadata->>'quoteId' = $1::text) AS transaction_count`,
    [quoteId, idempotencyKey]
  );
  return rows[0];
}

async function cardSnapshot(cardId) {
  const { rows } = await query(
    `SELECT status, last_used_at, failed_pin_attempts, pin_locked_until
       FROM oxsteed_credit_cards
      WHERE id = $1`,
    [cardId]
  );
  if (!rows[0]) throw new Error(`Synthetic card ${cardId} is missing.`);
  return rows[0];
}

async function cashOutSnapshot(idempotencyKey, kioskDeviceId, cardId) {
  const { rows } = await query(
    `SELECT
        (SELECT COUNT(*)::int
           FROM oxsteed_credit_transactions
          WHERE idempotency_key = $1) AS transaction_count,
        (SELECT COUNT(*)::int
           FROM oxsteed_credit_transactions
          WHERE transaction_type = 'cash_out'
            AND reference_type = 'credit_kiosk_cash_out'
            AND reference_id = $2) AS reference_transaction_count,
        (SELECT COUNT(*)::int
           FROM oxsteed_credit_audit_events
          WHERE action_type = 'credit.card.cash_out_completed'
            AND resource_type = 'credit_card'
            AND resource_id = $3::text) AS audit_count`,
    [idempotencyKey, String(kioskDeviceId), String(cardId)]
  );
  return rows[0];
}

async function transactionCount(idempotencyKey) {
  const { rows } = await query(
    `SELECT COUNT(*)::int AS count
       FROM oxsteed_credit_transactions
      WHERE idempotency_key = $1`,
    [idempotencyKey]
  );
  return Number(rows[0]?.count || 0);
}

async function partnerFundingSnapshot(idempotencyKey, externalReference, reason) {
  const { rows } = await query(
    `SELECT
        (SELECT COUNT(*)::int
           FROM oxsteed_credit_partner_ledgers
          WHERE partner_id = $1) AS ledger_count,
        (SELECT COUNT(*)::int
           FROM oxsteed_credit_accounts
          WHERE partner_id = $1
            AND account_type IN ('partner_payable', 'partner_reserve')) AS account_count,
        (SELECT COUNT(*)::int
           FROM oxsteed_credit_partner_funding_records
          WHERE idempotency_key = $2) AS funding_count,
        (SELECT COUNT(*)::int
           FROM oxsteed_credit_transactions
          WHERE reference_type = 'partner_funding'
            AND reference_id = $3) AS transaction_count,
        (SELECT COUNT(*)::int
           FROM oxsteed_credit_audit_events
          WHERE partner_id = $1
            AND resource_type = 'credit_partner_funding'
            AND reason = $4) AS audit_count`,
    [PARTNER_FUNDING_PARTNER_ID, idempotencyKey, externalReference, reason]
  );
  return rows[0];
}

function assertUnchanged(before, after, label) {
  if (JSON.stringify(before) !== JSON.stringify(after)) {
    throw new Error(`${label} changed account state: before=${JSON.stringify(before)} after=${JSON.stringify(after)}`);
  }
}

async function runRollbackProbe(name, operation) {
  let injectedError = null;
  try {
    await withTransaction(pool, async (client) => {
      await operation(client);
      throw new Error(`synthetic ${name} failure`);
    }, `credit_failure_injection_${name}`);
  } catch (error) {
    injectedError = error;
  }
  const expectedMessage = `synthetic ${name} failure`;
  if (!injectedError || injectedError.message !== expectedMessage) {
    throw new Error(`Expected ${expectedMessage}, received ${injectedError?.message || 'no error'}`);
  }
  return { name, error: injectedError.message };
}

async function run() {
  const results = [];
  await setCreditRailStatus({
    enabled: true,
    actorUserId: ADMIN_ID,
    reason: 'Disposable financial failure-injection verification',
  });

  try {
    await loadCustomerCredit({
      customerId: CUSTOMER_ID,
      amountCents: 5000,
      currencyCode: 'USD',
      idempotencyKey: `${RUN_ID}-load`,
      actorUserId: ADMIN_ID,
      reason: 'Disposable financial failure-injection seed load',
      referenceType: 'isolated_failure_injection',
      referenceId: RUN_ID,
    });

    const beforePurchase = await accountSnapshot();
    const purchaseKey = `${RUN_ID}-purchase`;
    results.push(await runRollbackProbe('purchase', (client) => purchaseWithCreditInTransaction(client, {
      customerId: CUSTOMER_ID,
      partnerId: PARTNER_ID,
      amountCents: 125,
      currencyCode: 'USD',
      idempotencyKey: purchaseKey,
      actorUserId: CUSTOMER_ID,
      actorType: 'customer',
      orderType: 'pickup',
      category: 'entree',
      referenceType: 'isolated_failure_injection',
      referenceId: `${RUN_ID}-purchase`,
      description: 'Disposable purchase rollback verification',
    })));
    assertUnchanged(beforePurchase, await accountSnapshot(), 'Purchase rollback');
    if (await transactionCount(purchaseKey) !== 0) throw new Error('Rolled-back purchase transaction still exists.');

    const recipientId = '77777777-7777-4777-8777-777777777777';
    const beforeTransferSender = await accountSnapshot();
    const beforeTransferRecipient = await accountSnapshot(12003);
    const transferKey = `${RUN_ID}-transfer`;
    results.push(await runRollbackProbe('transfer', (client) => transferCreditInTransaction(client, {
      senderCustomerId: CUSTOMER_ID,
      recipientCustomerId: recipientId,
      amountCents: 125,
      currencyCode: 'USD',
      idempotencyKey: transferKey,
      actorUserId: CUSTOMER_ID,
      referenceType: 'isolated_failure_injection',
      referenceId: `${RUN_ID}-transfer`,
      description: 'Disposable transfer rollback verification',
    })));
    assertUnchanged(beforeTransferSender, await accountSnapshot(), 'Transfer sender rollback');
    assertUnchanged(beforeTransferRecipient, await accountSnapshot(12003), 'Transfer recipient rollback');
    if (await transactionCount(transferKey) !== 0) throw new Error('Rolled-back transfer transaction still exists.');

    const beforeAdjustment = await accountSnapshot();
    const adjustmentKey = `${RUN_ID}-adjustment`;
    results.push(await runRollbackProbe('adjustment', (client) => adjustCustomerCreditInTransaction(client, {
      customerId: CUSTOMER_ID,
      amountCents: 125,
      currencyCode: 'USD',
      direction: 'debit',
      idempotencyKey: adjustmentKey,
      actorUserId: ADMIN_ID,
      reason: 'Disposable adjustment rollback verification',
      referenceType: 'isolated_failure_injection',
      referenceId: `${RUN_ID}-adjustment`,
    })));
    assertUnchanged(beforeAdjustment, await accountSnapshot(), 'Adjustment rollback');
    if (await transactionCount(adjustmentKey) !== 0) throw new Error('Rolled-back adjustment transaction still exists.');

    const holdKey = `${RUN_ID}-hold`;
    const createdHold = await createCreditHold({
      customerId: CUSTOMER_ID,
      partnerId: PARTNER_ID,
      amountCents: 600,
      currencyCode: 'USD',
      idempotencyKey: holdKey,
      actorUserId: CUSTOMER_ID,
      orderType: 'pickup',
      category: 'entree',
      purpose: 'Disposable hold capture rollback verification',
      referenceType: 'isolated_failure_injection',
      referenceId: `${RUN_ID}-hold`,
    });
    const holdId = createdHold.hold.id;
    const beforeCaptureAccount = await accountSnapshot();
    const beforeCaptureHold = await holdSnapshot(holdId);
    const captureKey = `${RUN_ID}-capture`;
    results.push(await runRollbackProbe('hold-capture', (client) => captureCreditHoldInTransaction(client, {
      holdId,
      amountCents: 600,
      currencyCode: 'USD',
      idempotencyKey: captureKey,
      actorUserId: ADMIN_ID,
      actorType: 'admin',
      reason: 'Disposable hold capture rollback verification',
      orderType: 'pickup',
      category: 'entree',
      referenceType: 'isolated_failure_injection',
      referenceId: `${RUN_ID}-capture`,
      description: 'Disposable hold capture rollback verification',
    })));
    assertUnchanged(beforeCaptureAccount, await accountSnapshot(), 'Hold capture rollback');
    const afterCaptureHold = await holdSnapshot(holdId);
    if (JSON.stringify(beforeCaptureHold) !== JSON.stringify(afterCaptureHold)) {
      throw new Error(`Hold capture rollback changed hold state: before=${JSON.stringify(beforeCaptureHold)} after=${JSON.stringify(afterCaptureHold)}`);
    }
    if (await transactionCount(captureKey) !== 0) throw new Error('Rolled-back hold capture transaction still exists.');
    await releaseCreditHold({
      customerId: CUSTOMER_ID,
      holdId,
      actorUserId: CUSTOMER_ID,
      reason: 'Disposable failure-injection cleanup',
    });

    const committedPurchaseKey = `${RUN_ID}-committed-purchase`;
    const committedPurchase = await purchaseWithCredit({
      customerId: CUSTOMER_ID,
      partnerId: PARTNER_ID,
      amountCents: 300,
      currencyCode: 'USD',
      idempotencyKey: committedPurchaseKey,
      actorUserId: CUSTOMER_ID,
      actorType: 'customer',
      orderType: 'pickup',
      category: 'entree',
      referenceType: 'isolated_failure_injection',
      referenceId: `${RUN_ID}-committed-purchase`,
      description: 'Disposable refund rollback fixture',
    });
    const committedPurchaseId = committedPurchase.transaction.id;
    const beforeRefundAccount = await accountSnapshot();
    const refundKey = `${RUN_ID}-refund`;
    results.push(await runRollbackProbe('refund', (client) => refundCreditInTransaction(client, {
      purchaseTransactionId: committedPurchaseId,
      amountCents: 300,
      idempotencyKey: refundKey,
      actorUserId: ADMIN_ID,
      actorType: 'admin',
      reason: 'Disposable refund rollback verification',
    })));
    assertUnchanged(beforeRefundAccount, await accountSnapshot(), 'Refund rollback');
    if (await transactionCount(refundKey) !== 0) throw new Error('Rolled-back refund transaction still exists.');
    if (await transactionCount(committedPurchaseKey) !== 1) throw new Error('Committed purchase fixture was changed by refund rollback.');

    const beforeJournal = await accountSnapshot();
    const journalKey = `${RUN_ID}-journal`;
    results.push(await runRollbackProbe('journal', async (client) => {
      const treasury = await ensureAccount(client, {
        accountType: 'platform_treasury',
        currencyCode: 'USD',
      });
      await postJournalTransaction(client, {
        transactionType: 'load',
        debitAccountId: treasury.id,
        creditAccountId: CUSTOMER_ACCOUNT_ID,
        amountCents: 125,
        currencyCode: 'USD',
        customerId: CUSTOMER_ID,
        idempotencyKey: journalKey,
        actorType: 'admin',
        actorUserId: ADMIN_ID,
        reason: 'Disposable journal rollback verification',
        description: 'Disposable journal rollback verification',
        referenceType: 'isolated_failure_injection',
        referenceId: RUN_ID,
        metadata: { runId: RUN_ID },
        bindIdempotencySemantics: true,
      });
    }));
    assertUnchanged(beforeJournal, await accountSnapshot(), 'Journal rollback');
    if (await transactionCount(journalKey) !== 0) throw new Error('Rolled-back journal transaction still exists.');

    const partnerFundingKey = `${RUN_ID}-partner-funding`;
    const partnerFundingReference = `${RUN_ID}-partner-funding-reference`;
    const partnerFundingReason = 'Disposable partner funding rollback verification';
    const beforePartnerFunding = await partnerFundingSnapshot(
      partnerFundingKey,
      partnerFundingReference,
      partnerFundingReason
    );
    results.push(await runRollbackProbe('partner-funding', (client) => recordPartnerFundingInTransaction(client, {
      partnerId: PARTNER_FUNDING_PARTNER_ID,
      currencyCode: 'USD',
      amountCents: 250,
      direction: 'fund',
      externalReference: partnerFundingReference,
      idempotencyKey: partnerFundingKey,
      actorUserId: ADMIN_ID,
      reason: partnerFundingReason,
      referenceType: 'isolated_failure_injection',
      referenceId: partnerFundingReference,
    })));
    assertUnchanged(
      beforePartnerFunding,
      await partnerFundingSnapshot(partnerFundingKey, partnerFundingReference, partnerFundingReason),
      'Partner funding rollback'
    );
    if (beforePartnerFunding.ledger_count !== '0' && beforePartnerFunding.ledger_count !== 0) {
      throw new Error('Partner funding rollback fixture was not isolated from a pre-existing partner ledger.');
    }

    const conversionQuote = await createCurrencyQuote({
      sourceCurrencyCode: 'USD',
      targetCurrencyCode: 'JPY',
      sourceAmountMinorUnits: 300,
      targetAmountMinorUnits: 600,
      feeAmountMinorUnits: 10,
      rateNumerator: '2',
      rateDenominator: '1',
      provider: 'isolated-test-provider',
      providerQuoteReference: `${RUN_ID}-conversion-provider`,
      idempotencyKey: `${RUN_ID}-conversion-quote`,
      actorUserId: ADMIN_ID,
      reason: 'Disposable conversion rollback quote',
    });
    const conversionQuoteId = conversionQuote.quote.id;
    const conversionKey = `${RUN_ID}-conversion`;
    const beforeConversionSource = await accountSnapshot();
    const beforeConversionTarget = await currencyAccountSnapshot(CUSTOMER_ID, 'JPY');
    const beforeConversion = await conversionSnapshot(conversionQuoteId, conversionKey);
    results.push(await runRollbackProbe('conversion', (client) => convertCustomerCreditInTransaction(client, {
      customerId: CUSTOMER_ID,
      quoteId: conversionQuoteId,
      sourceAmountMinorUnits: 300,
      idempotencyKey: conversionKey,
      actorUserId: CUSTOMER_ID,
      metadata: { runId: RUN_ID },
    })));
    assertUnchanged(beforeConversionSource, await accountSnapshot(), 'Conversion source rollback');
    assertUnchanged(beforeConversionTarget, await currencyAccountSnapshot(CUSTOMER_ID, 'JPY'), 'Conversion target rollback');
    assertUnchanged(beforeConversion, await conversionSnapshot(conversionQuoteId, conversionKey), 'Conversion record rollback');

    const issuedCard = await issueVirtualCard({
      customerId: CUSTOMER_ID,
      currencyCode: 'USD',
      nickname: 'Disposable cash-out rollback card',
      idempotencyKey: `${RUN_ID}-cash-out-card`,
      actorUserId: CUSTOMER_ID,
      metadata: { runId: RUN_ID },
    });
    const cardId = issuedCard.card.id;
    const rawCredential = issuedCard.card.credential;
    // Synthetic grant fixture inside the already-guarded disposable harness.
    // Production callers must obtain the password/MFA/email challenge.
    const security = require('../services/oxsteedCreditCardSecurity');
    const pinArgs = { cardId, customerId: CUSTOMER_ID, pin: '2468', actorUserId: CUSTOMER_ID,
      sessionBinding: 'isolated-failure-injection', idempotencyKey: `${RUN_ID}-pin` };
    const owner = (await query('SELECT * FROM users WHERE id=$1', [CUSTOMER_ID])).rows[0];
    const challenge = await query(`INSERT INTO oxsteed_credit_card_security_challenges
      (customer_id,card_id,action,binding_hash,code_hash,expires_at,delivered_at)
      VALUES ($1,$2,'pin_set',$3,$4,NOW()+INTERVAL '10 minutes',NOW()) RETURNING id`,
    [CUSTOMER_ID, cardId, security.bindingHash('pin_set', pinArgs, owner), security.hash(['card-code','123456'])]);
    await setCardPin({ ...pinArgs, stepupChallengeId: challenge.rows[0].id, stepupCode: '123456' });
    const kioskDeviceId = `${RUN_ID}-kiosk`;
    const cashOutKey = `${RUN_ID}-cash-out`;
    const beforeCashOutAccount = await accountSnapshot();
    const beforeCashOutCard = await cardSnapshot(cardId);
    const beforeCashOut = await cashOutSnapshot(cashOutKey, kioskDeviceId, cardId);
    results.push(await runRollbackProbe('cash-out', (client) => cashOutWithCardInTransaction(client, {
      credential: rawCredential,
      pin: '2468',
      kioskDeviceId,
      partnerId: null,
      amountCents: 125,
      currencyCode: 'USD',
      idempotencyKey: cashOutKey,
      metadata: { runId: RUN_ID },
    })));
    assertUnchanged(beforeCashOutAccount, await accountSnapshot(), 'Cash-out account rollback');
    assertUnchanged(beforeCashOutCard, await cardSnapshot(cardId), 'Cash-out card rollback');
    assertUnchanged(beforeCashOut, await cashOutSnapshot(cashOutKey, kioskDeviceId, cardId), 'Cash-out record rollback');
  } finally {
    await setCreditRailStatus({
      enabled: false,
      actorUserId: ADMIN_ID,
      reason: 'Disposable financial failure-injection cleanup',
    }).catch((error) => {
      process.stderr.write(`Credit failure-injection rail cleanup failed: ${error.message}\n`);
    });
  }

  const { rows: railRows } = await query(
    `SELECT is_enabled FROM feature_flags WHERE key = 'oxsteed_credit_enabled'`
  );
  if (railRows[0]?.is_enabled !== false) throw new Error('Failure injection changed the isolated rail state.');

  process.stdout.write(`${JSON.stringify({
    ok: true,
    operations: results,
    customerAccountId: CUSTOMER_ACCOUNT_ID,
    railEnabled: railRows[0]?.is_enabled === true,
  }, null, 2)}\n`);
}

run()
  .catch((error) => {
    process.stderr.write(`Credit failure injection verification failed: ${error.message}\n`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end().catch(() => {});
  });
