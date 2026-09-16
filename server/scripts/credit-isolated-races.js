#!/usr/bin/env node
'use strict';

/* Exercises concurrency-sensitive Credit transitions against the disposable fixture. */
const { Pool } = require('pg');

const databaseUrl = String(process.env.DATABASE_URL || '');
const databaseName = (() => {
  try {
    return new URL(databaseUrl).pathname.replace(/^\//, '').split('?')[0];
  } catch {
    return '';
  }
})();

const pool = new Pool({ connectionString: databaseUrl, ssl: false, max: 10 });
const ADMIN_ID = '22222222-2222-4222-8222-222222222222';
const CUSTOMER_ONE = '66666666-6666-4666-8666-666666666666';
const PARTNER_ONE = 901;
const TARGET_BOOTSTRAP_AVAILABLE_CENTS = 2500;
const RUN_ID = `${Date.now()}-${process.pid}`;
const runKey = (label) => `isolated-race-${RUN_ID}-${label}`;

async function query(text, values = []) {
  return pool.query(text, values);
}

function outcome(result) {
  if (result.status === 'fulfilled') return { ok: true, value: result.value };
  return { ok: false, code: result.reason?.code || 'unknown', message: result.reason?.message || String(result.reason) };
}

function requireIsolatedHarness() {
  if (process.env.NODE_ENV !== 'test' || databaseName !== 'oxsteed_db' || !process.env.CREDIT_TEST_PROJECT) {
    throw new Error('Refusing to run concurrency verification outside the disposable Credit harness.');
  }
}

function countTransitionSuccesses(result) {
  if (result?.status !== 'fulfilled') return 0;
  const value = result.value || {};
  const count = Number(value.count);
  if (Number.isFinite(count) && count > 0) return count;
  if (Array.isArray(value.expired)) return value.expired.length;
  return value.expired === true ? 1 : 0;
}

function assertOneSuccess(results, label) {
  const successes = results.filter((result) => result.status === 'fulfilled');
  if (successes.length !== 1) throw new Error(`${label} expected exactly one successful transition: ${JSON.stringify(results.map(outcome))}`);
}

async function run() {
  requireIsolatedHarness();
  // Keep these limits local to this disposable verifier process. They make the
  // cap races practical without changing the application or production caps.
  const { rows: issuanceRows } = await query(
    `SELECT COALESCE(SUM(balance_cents), 0)::int AS total_cents
       FROM oxsteed_credit_accounts
      WHERE account_type = 'customer_wallet' AND currency_code = 'USD'`
  );
  const { rows: customerRows } = await query(
    `SELECT COALESCE(balance_cents - reserved_cents, 0)::int AS available_cents
       FROM oxsteed_credit_accounts
      WHERE account_type = 'customer_wallet' AND customer_id = $1 AND currency_code = 'USD'`,
    [CUSTOMER_ONE]
  );
  const { rows: conversionRows } = await query(
    `SELECT COUNT(*)::int AS conversion_count,
            COALESCE(SUM(source_amount_minor_units), 0)::int AS source_cents
       FROM oxsteed_credit_currency_conversions
      WHERE customer_id = $1 AND created_at >= CURRENT_DATE`,
    [CUSTOMER_ONE]
  );
  const currentIssuedCents = Number(issuanceRows[0]?.total_cents || 0);
  const bootstrapCents = Math.max(0, TARGET_BOOTSTRAP_AVAILABLE_CENTS - Number(customerRows[0]?.available_cents || 0));
  const baselineConversionCount = Number(conversionRows[0]?.conversion_count || 0);
  const baselineConversionCents = Number(conversionRows[0]?.source_cents || 0);
  process.env.OXSTEED_CREDIT_MAX_TOTAL_ISSUANCE_CENTS = String(currentIssuedCents + bootstrapCents + 800);
  process.env.OXSTEED_CREDIT_MAX_DAILY_CUSTOMER_CONVERSION_CENTS = String(baselineConversionCents + 700);
  const {
    setCreditRailStatus,
    createCreditHold,
    captureCreditHold,
    releaseCreditHold,
    expireCreditHolds,
    purchaseWithCredit,
    refundCredit,
    loadCustomerCredit,
  } = require('../services/oxsteedCreditService');
  const { createSettlement } = require('../services/oxsteedCreditAdminService');
  const { createCurrencyQuote, convertCustomerCredit } = require('../services/oxsteedCreditCurrencyConversionService');

  await setCreditRailStatus({ enabled: true, actorUserId: ADMIN_ID, reason: 'Synthetic concurrency verification only' });

  if (bootstrapCents > 0) {
    await loadCustomerCredit({
      customerId: CUSTOMER_ONE,
      amountCents: bootstrapCents,
      currencyCode: 'USD',
      idempotencyKey: runKey('bootstrap'),
      actorUserId: ADMIN_ID,
      reason: 'Synthetic concurrency verifier bootstrap',
      referenceType: 'isolated_race',
      referenceId: runKey('bootstrap-reference'),
    });
  }

  const hold = await createCreditHold({
    customerId: CUSTOMER_ONE, partnerId: PARTNER_ONE, amountCents: 300, currencyCode: 'USD',
    idempotencyKey: runKey('hold-capture-release'), actorUserId: CUSTOMER_ONE, orderType: 'pickup',
    purpose: 'Synthetic capture and release race', referenceType: 'isolated_race', referenceId: 'capture-release-1',
  });
  const captureRelease = await Promise.allSettled([
    captureCreditHold({
      holdId: hold.hold.id, amountCents: 300, currencyCode: 'USD', idempotencyKey: runKey('capture-1'),
      actorUserId: ADMIN_ID, actorType: 'admin', orderType: 'pickup', referenceType: 'isolated_race',
      referenceId: 'capture-release-1', reason: 'Synthetic capture race',
    }),
    releaseCreditHold({ customerId: CUSTOMER_ONE, holdId: hold.hold.id, actorUserId: CUSTOMER_ONE, reason: 'Synthetic release race' }),
  ]);
  assertOneSuccess(captureRelease, 'capture/release');
  const { rows: captureReleaseState } = await query(
    `SELECT h.status, a.reserved_cents FROM oxsteed_credit_holds h
       JOIN oxsteed_credit_accounts a ON a.id = h.account_id WHERE h.id = $1`, [hold.hold.id]
  );
  if (!['captured', 'released'].includes(captureReleaseState[0]?.status) || Number(captureReleaseState[0]?.reserved_cents) !== 0) {
    throw new Error(`Capture/release left invalid state: ${JSON.stringify(captureReleaseState[0])}`);
  }

  const expiringHold = await createCreditHold({
    customerId: CUSTOMER_ONE, partnerId: PARTNER_ONE, amountCents: 250, currencyCode: 'USD',
    idempotencyKey: runKey('expiry-hold'), actorUserId: CUSTOMER_ONE, orderType: 'pickup',
    purpose: 'Synthetic expiry race', referenceType: 'isolated_race', referenceId: 'expiry-1',
  });
  // The authorization is immutable by design; only the disposable fixture may
  // age this synthetic hold, with the guard restored before the race starts.
  await query('BEGIN');
  try {
    await query('ALTER TABLE oxsteed_credit_holds DISABLE TRIGGER oxsteed_credit_hold_immutable_guard');
    await query(`UPDATE oxsteed_credit_holds SET expires_at = NOW() - INTERVAL '1 second' WHERE id = $1`, [expiringHold.hold.id]);
    await query('COMMIT');
  } catch (error) {
    await query('ROLLBACK').catch(() => {});
    throw error;
  }
  await query('ALTER TABLE oxsteed_credit_holds ENABLE TRIGGER oxsteed_credit_hold_immutable_guard');
  const expiryCapture = await Promise.allSettled([
    expireCreditHolds({ limit: 10, actorUserId: ADMIN_ID }),
    captureCreditHold({
      holdId: expiringHold.hold.id, amountCents: 250, currencyCode: 'USD', idempotencyKey: runKey('expiry-capture'),
      actorUserId: ADMIN_ID, actorType: 'admin', orderType: 'pickup', referenceType: 'isolated_race', referenceId: 'expiry-1',
      reason: 'Synthetic expiry race',
    }),
  ]);
  const expiryTransitions = expiryCapture.reduce((count, result) => {
    return count + countTransitionSuccesses(result);
  }, 0);
  if (expiryTransitions !== 1) throw new Error(`expiry/capture expected exactly one committed transition: ${JSON.stringify(expiryCapture.map(outcome))}`);
  const { rows: expiryState } = await query(
    `SELECT h.status, a.reserved_cents FROM oxsteed_credit_holds h
       JOIN oxsteed_credit_accounts a ON a.id = h.account_id WHERE h.id = $1`, [expiringHold.hold.id]
  );
  if (expiryState[0]?.status !== 'expired' || Number(expiryState[0]?.reserved_cents) !== 0) {
    throw new Error(`Expiry race left invalid state: ${JSON.stringify(expiryState[0])}`);
  }

  const issuance = await Promise.allSettled([
    loadCustomerCredit({ customerId: CUSTOMER_ONE, amountCents: 800, currencyCode: 'USD', idempotencyKey: runKey('issuance-1'), actorUserId: ADMIN_ID, reason: 'Synthetic issuance cap race one', referenceType: 'isolated_race', referenceId: runKey('issuance-reference-1') }),
    loadCustomerCredit({ customerId: '77777777-7777-4777-8777-777777777777', amountCents: 800, currencyCode: 'USD', idempotencyKey: runKey('issuance-2'), actorUserId: ADMIN_ID, reason: 'Synthetic issuance cap race two', referenceType: 'isolated_race', referenceId: runKey('issuance-reference-2') }),
  ]);
  assertOneSuccess(issuance, 'issuance cap');
  if (!issuance.some((result) => result.status === 'rejected' && result.reason?.code === 'credit_total_issuance_limit')) throw new Error(`Issuance cap race did not reject the excess load: ${JSON.stringify(issuance.map(outcome))}`);
  const { rows: issuanceState } = await query(`SELECT COALESCE(SUM(balance_cents), 0)::int AS total_cents FROM oxsteed_credit_accounts WHERE account_type = 'customer_wallet' AND currency_code = 'USD'`);
  if (Number(issuanceState[0]?.total_cents) > currentIssuedCents + bootstrapCents + 800) throw new Error(`Issuance cap was exceeded: ${JSON.stringify(issuanceState[0])}`);

  const quoteArgs = {
    sourceCurrencyCode: 'USD', targetCurrencyCode: 'JPY', sourceAmountMinorUnits: 700, targetAmountMinorUnits: 700,
    feeAmountMinorUnits: 0, rateNumerator: '1', rateDenominator: '1', roundingMode: 'half_up', provider: 'synthetic',
    expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(), actorUserId: ADMIN_ID, reason: 'Synthetic conversion cap race',
  };
  const quoteOne = await createCurrencyQuote({ ...quoteArgs, providerQuoteReference: runKey('conversion-cap-1'), idempotencyKey: runKey('quote-1') });
  const quoteTwo = await createCurrencyQuote({ ...quoteArgs, providerQuoteReference: runKey('conversion-cap-2'), idempotencyKey: runKey('quote-2') });
  const conversions = await Promise.allSettled([
    convertCustomerCredit({ customerId: CUSTOMER_ONE, quoteId: quoteOne.quote.id, sourceAmountMinorUnits: 700, idempotencyKey: runKey('conversion-1'), actorUserId: CUSTOMER_ONE }),
    convertCustomerCredit({ customerId: CUSTOMER_ONE, quoteId: quoteTwo.quote.id, sourceAmountMinorUnits: 700, idempotencyKey: runKey('conversion-2'), actorUserId: CUSTOMER_ONE }),
  ]);
  assertOneSuccess(conversions, 'conversion cap');
  if (!conversions.some((result) => result.status === 'rejected' && result.reason?.code === 'credit_daily_conversion_limit')) throw new Error(`Conversion cap race did not reject the excess conversion: ${JSON.stringify(conversions.map(outcome))}`);
  const { rows: conversionState } = await query(`SELECT COUNT(*)::int AS conversion_count, COALESCE(SUM(source_amount_minor_units), 0)::int AS source_cents FROM oxsteed_credit_currency_conversions WHERE customer_id = $1 AND created_at >= CURRENT_DATE`, [CUSTOMER_ONE]);
  if (Number(conversionState[0]?.conversion_count) - baselineConversionCount !== 1
    || Number(conversionState[0]?.source_cents) - baselineConversionCents !== 700) throw new Error(`Conversion cap produced invalid totals: ${JSON.stringify(conversionState[0])}`);

  const settlementArgs = {
    partnerId: PARTNER_ONE, agreementId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', periodStart: new Date(Date.now() - 10000).toISOString(), periodEnd: new Date(Date.now() - 9000).toISOString(), actorUserId: ADMIN_ID, paymentReference: null, reason: 'Synthetic settlement overlap race', metadata: {},
  };
  const settlements = await Promise.allSettled([
    createSettlement({ ...settlementArgs, idempotencyKey: runKey('settlement-1') }),
    createSettlement({ ...settlementArgs, idempotencyKey: runKey('settlement-2') }),
  ]);
  assertOneSuccess(settlements, 'settlement/settlement');
  if (!settlements.some((result) => result.status === 'rejected' && result.reason?.code === 'credit_settlement_period_overlap')) throw new Error(`Settlement overlap race did not reject the duplicate period: ${JSON.stringify(settlements.map(outcome))}`);

  const permissionRace = await Promise.allSettled([
    createCreditHold({ customerId: CUSTOMER_ONE, partnerId: PARTNER_ONE, amountCents: 100, currencyCode: 'USD', idempotencyKey: runKey('permission-1'), actorUserId: CUSTOMER_ONE, orderType: 'pickup', purpose: 'Synthetic authorized restaurant race', referenceType: 'isolated_race', referenceId: runKey('permission-reference-1') }),
    createCreditHold({ customerId: CUSTOMER_ONE, partnerId: 902, amountCents: 100, currencyCode: 'USD', idempotencyKey: runKey('permission-2'), actorUserId: CUSTOMER_ONE, orderType: 'pickup', purpose: 'Synthetic unauthorized restaurant race', referenceType: 'isolated_race', referenceId: runKey('permission-reference-2') }),
  ]);
  assertOneSuccess(permissionRace, 'restaurant permission');
  const permissionSuccess = permissionRace.find((result) => result.status === 'fulfilled')?.value;
  if (String(permissionSuccess?.hold?.partnerId) !== String(PARTNER_ONE) || !permissionRace.some((result) => result.status === 'rejected' && result.reason?.code === 'credit_partner_not_eligible')) throw new Error(`Restaurant permission race produced an invalid result: ${JSON.stringify(permissionRace.map(outcome))}`);
  await releaseCreditHold({ customerId: CUSTOMER_ONE, holdId: permissionSuccess.hold.id, actorUserId: CUSTOMER_ONE, reason: 'Synthetic permission race cleanup' });

  const purchase = await purchaseWithCredit({
    customerId: CUSTOMER_ONE, partnerId: PARTNER_ONE, amountCents: 400, currencyCode: 'USD',
    idempotencyKey: runKey('refund-purchase'), actorUserId: CUSTOMER_ONE, actorType: 'customer',
    orderType: 'pickup', referenceType: 'isolated_race', referenceId: runKey('refund-purchase-reference'),
  });
  const refunds = await Promise.allSettled([
    refundCredit({ purchaseTransactionId: purchase.transaction.id, amountCents: 250, idempotencyKey: runKey('refund-1'), actorUserId: ADMIN_ID, reason: 'Synthetic refund race one' }),
    refundCredit({ purchaseTransactionId: purchase.transaction.id, amountCents: 250, idempotencyKey: runKey('refund-2'), actorUserId: ADMIN_ID, reason: 'Synthetic refund race two' }),
  ]);
  assertOneSuccess(refunds, 'refund/refund');
  const { rows: refundState } = await query(
    `SELECT COUNT(*)::int AS refund_count, COALESCE(SUM(amount_cents), 0)::int AS refunded_cents
       FROM oxsteed_credit_transactions WHERE transaction_type = 'refund' AND status = 'posted' AND reference_id = $1`, [String(purchase.transaction.id)]
  );
  if (Number(refundState[0]?.refund_count) !== 1 || Number(refundState[0]?.refunded_cents) !== 250) {
    throw new Error(`Refund race produced invalid totals: ${JSON.stringify(refundState[0])}`);
  }

  const sameRequest = {
    customerId: CUSTOMER_ONE, partnerId: PARTNER_ONE, amountCents: 100, currencyCode: 'USD',
    idempotencyKey: runKey('identical-key'), actorUserId: CUSTOMER_ONE, actorType: 'customer',
    orderType: 'pickup', referenceType: 'isolated_race', referenceId: runKey('same-key-reference'),
  };
  const sameKey = await Promise.allSettled([purchaseWithCredit(sameRequest), purchaseWithCredit(sameRequest)]);
  if (sameKey.some((result) => result.status === 'rejected')) throw new Error(`Identical idempotency requests did not both resolve: ${JSON.stringify(sameKey.map(outcome))}`);
  const sameTransactions = new Set(sameKey.map((result) => String(result.value.transaction.id)));
  if (sameTransactions.size !== 1 || !sameKey.some((result) => result.value.replayed === true)) throw new Error(`Identical idempotency requests did not replay one transaction: ${JSON.stringify(sameKey.map(outcome))}`);
  const conflictingRequest = await Promise.allSettled([purchaseWithCredit({ ...sameRequest, amountCents: 101 })]);
  if (conflictingRequest[0].status !== 'rejected' || conflictingRequest[0].reason?.code !== 'credit_idempotency_conflict') throw new Error(`Conflicting idempotency request was not rejected safely: ${JSON.stringify(conflictingRequest.map(outcome))}`);

  const { rows: finalState } = await query(
    `SELECT a.balance_cents, a.reserved_cents,
            (SELECT COUNT(*) FROM oxsteed_credit_transactions WHERE idempotency_key = $3)::int AS same_key_transactions,
            (SELECT COUNT(*) FROM oxsteed_credit_transactions WHERE transaction_type = 'refund' AND reference_id = $1)::int AS refunds
       FROM oxsteed_credit_accounts a WHERE a.customer_id = $2 AND a.currency_code = 'USD' AND a.account_type = 'customer_wallet'`,
    [String(purchase.transaction.id), CUSTOMER_ONE, runKey('identical-key')]
  );
  if (!finalState[0] || Number(finalState[0].reserved_cents) !== 0 || Number(finalState[0].same_key_transactions) !== 1 || Number(finalState[0].refunds) !== 1) throw new Error(`Final race invariants failed: ${JSON.stringify(finalState[0])}`);

  console.log(JSON.stringify({
    ok: true, database: databaseName, railEnabledOnlyInIsolatedFixture: true,
    races: {
      captureRelease: { successfulTransitions: 1, finalStatus: captureReleaseState[0].status },
      expiryCapture: { successfulTransitions: expiryTransitions, finalStatus: expiryState[0].status },
      refundRefund: { successfulTransitions: 1, refundCount: Number(refundState[0].refund_count), refundedCents: Number(refundState[0].refunded_cents) },
      identicalIdempotency: { transactionCount: Number(finalState[0].same_key_transactions), replayObserved: true },
      conflictingIdempotency: { rejectedCode: conflictingRequest[0].reason.code },
      issuanceCap: { successfulTransitions: 1, totalCents: Number(issuanceState[0].total_cents) },
      conversionCap: { successfulTransitions: 1, convertedCents: Number(conversionState[0].source_cents) },
      settlementOverlap: { successfulTransitions: 1, rejectedCode: 'credit_settlement_period_overlap' },
      restaurantPermission: { successfulTransitions: 1, authorizedPartnerId: PARTNER_ONE, rejectedCode: 'credit_partner_not_eligible' },
    },
    finalAccount: { balanceCents: Number(finalState[0].balance_cents), reservedCents: Number(finalState[0].reserved_cents) },
  }, null, 2));
}

if (require.main === module) {
  run()
    .catch((error) => {
      console.error(`Isolated concurrency verification failed: ${error.message} (${error.code || 'no_code'})`);
      if (error.fields && Object.keys(error.fields).length) console.error(`Validation fields: ${JSON.stringify(error.fields)}`);
      process.exitCode = 1;
    })
    .finally(async () => { await pool.end().catch(() => {}); });
}

module.exports = { countTransitionSuccesses };
