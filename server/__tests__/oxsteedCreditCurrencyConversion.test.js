'use strict';

const { mockQuery, resetMocks } = require('./setup');
const {
  calculateQuotedTargetAmount,
  assertDailyConversionCapacity,
  createCurrencyQuote,
  getCurrencyQuote,
  convertCustomerCredit,
} = require('../services/oxsteedCreditCurrencyConversionService');

const CUSTOMER_ID = '11111111-1111-4111-8111-111111111111';
const ADMIN_ID = '22222222-2222-4222-8222-222222222222';

beforeEach(resetMocks);

test('serializes per-customer daily conversion capacity before checking the cap', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [{ conversion_count: 20, conversion_cents: '0' }] });

  await expect(assertDailyConversionCapacity({ query: mockQuery }, {
    customerId: CUSTOMER_ID,
    currencyCode: 'USD',
    sourceAmount: 100,
  })).rejects.toMatchObject({ code: 'credit_daily_conversion_limit' });

  expect(mockQuery.mock.calls[0][0]).toContain('pg_advisory_xact_lock');
  expect(mockQuery.mock.calls[0][1]).toEqual([
    CUSTOMER_ID,
    'USD',
    `oxsteed-credit-conversion-limit:${CUSTOMER_ID}:USD`,
  ]);
});

test('calculates exact quote targets with integer half-up rounding', () => {
  expect(calculateQuotedTargetAmount({
    sourceAmountMinorUnits: 100,
    rateNumerator: '9',
    rateDenominator: '10',
  })).toBe(90);
  expect(calculateQuotedTargetAmount({
    sourceAmountMinorUnits: 5,
    rateNumerator: '1',
    rateDenominator: '2',
  })).toBe(3);
});

test('requires a future quote expiry and rejects mismatched quote math', async () => {
  await expect(createCurrencyQuote({
    customerId: CUSTOMER_ID,
    sourceCurrencyCode: 'USD',
    targetCurrencyCode: 'EUR',
    sourceAmountMinorUnits: 100,
    targetAmountMinorUnits: 90,
    rateNumerator: '9',
    rateDenominator: '10',
    provider: 'treasury-provider',
    providerQuoteReference: 'q-1',
    expiresAt: new Date(Date.now() - 1000).toISOString(),
    idempotencyKey: 'quote-1',
    actorUserId: ADMIN_ID,
    reason: 'Test quote',
  })).rejects.toMatchObject({ code: 'credit_conversion_quote_expiry_invalid' });

  await expect(createCurrencyQuote({
    customerId: CUSTOMER_ID,
    sourceCurrencyCode: 'USD',
    targetCurrencyCode: 'EUR',
    sourceAmountMinorUnits: 100,
    targetAmountMinorUnits: 91,
    rateNumerator: '9',
    rateDenominator: '10',
    provider: 'treasury-provider',
    providerQuoteReference: 'q-2',
    idempotencyKey: 'quote-2',
    actorUserId: ADMIN_ID,
    reason: 'Test quote',
  })).rejects.toMatchObject({ code: 'credit_conversion_quote_math_invalid' });
});

test('creates a quote only after the Credit rail is enabled', async () => {
  mockQuery
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [{ is_enabled: true }] })
    .mockResolvedValueOnce({ rows: [] }) // Phase 4: operator freeze check (oxsteed_credit_rail_freezes)
    .mockResolvedValueOnce({ rows: [{
      id: 7,
      source_currency_code: 'USD',
      target_currency_code: 'EUR',
      source_amount_minor_units: 100,
      target_amount_minor_units: 90,
      fee_amount_minor_units: 2,
      rate_numerator: '9',
      rate_denominator: '10',
      rounding_mode: 'half_up',
      provider: 'treasury-provider',
      provider_quote_reference: 'q-3',
      status: 'open',
      expires_at: new Date(Date.now() + 600000).toISOString(),
      reason: 'Test quote',
      metadata: {},
      created_at: new Date().toISOString(),
    }] });

  const result = await createCurrencyQuote({
    customerId: CUSTOMER_ID,
    sourceCurrencyCode: 'USD',
    targetCurrencyCode: 'EUR',
    sourceAmountMinorUnits: 100,
    targetAmountMinorUnits: 90,
    feeAmountMinorUnits: 2,
    rateNumerator: '9',
    rateDenominator: '10',
    provider: 'treasury-provider',
    providerQuoteReference: 'q-3',
    idempotencyKey: 'quote-3',
    actorUserId: ADMIN_ID,
    reason: 'Test quote',
  });

  expect(result).toMatchObject({ replayed: false, quote: { id: '7', status: 'open', sourceCurrencyCode: 'USD', targetCurrencyCode: 'EUR' } });
  expect(mockQuery.mock.calls.some(([sql]) => sql.includes('oxsteed_credit_currency_quotes'))).toBe(true);
});

test('returns terms-only quote data to customer reads', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [{
    id: 8,
    source_currency_code: 'USD',
    target_currency_code: 'EUR',
    source_amount_minor_units: 100,
    target_amount_minor_units: 90,
    fee_amount_minor_units: 2,
    rate_numerator: '9',
    rate_denominator: '10',
    rounding_mode: 'half_up',
    provider: 'treasury-provider',
    provider_quote_reference: 'internal-q-8',
    status: 'open',
    expires_at: new Date(Date.now() + 600000).toISOString(),
    consumed_at: null,
    reason: 'Internal treasury pricing note',
    metadata: { internal: true },
    created_at: new Date().toISOString(),
  }] });

  const result = await getCurrencyQuote({ quoteId: 8, audience: 'customer' });

  expect(result.quote).toMatchObject({
    id: '8',
    sourceCurrencyCode: 'USD',
    targetCurrencyCode: 'EUR',
    sourceAmountMinorUnits: 100,
    targetAmountMinorUnits: 90,
    feeAmountMinorUnits: 2,
    status: 'open',
  });
  expect(result.quote).not.toHaveProperty('provider');
  expect(result.quote).not.toHaveProperty('providerQuoteReference');
  expect(result.quote).not.toHaveProperty('reason');
  expect(result.quote).not.toHaveProperty('metadata');
});

test('rejects quote retries that change the exact rate even when the rounded target is unchanged', async () => {
  mockQuery
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [{
      id: 7,
      source_currency_code: 'USD',
      target_currency_code: 'EUR',
      source_amount_minor_units: 100,
      target_amount_minor_units: 90,
      fee_amount_minor_units: 0,
      rate_numerator: '9',
      rate_denominator: '10',
      rounding_mode: 'half_up',
      provider: 'treasury-provider',
      provider_quote_reference: 'q-4',
      customer_id: CUSTOMER_ID,
      status: 'open',
      expires_at: new Date(Date.now() + 600000).toISOString(),
      reason: 'Test quote',
      metadata: {},
      created_at: new Date().toISOString(),
    }] });

  await expect(createCurrencyQuote({
    customerId: CUSTOMER_ID,
    sourceCurrencyCode: 'USD',
    targetCurrencyCode: 'EUR',
    sourceAmountMinorUnits: 100,
    targetAmountMinorUnits: 90,
    rateNumerator: '18',
    rateDenominator: '20',
    provider: 'treasury-provider',
    providerQuoteReference: 'q-4',
    idempotencyKey: 'quote-4',
    actorUserId: ADMIN_ID,
    reason: 'Test quote',
  })).rejects.toMatchObject({ code: 'credit_conversion_quote_idempotency_conflict' });
});

test('replays a conversion by idempotency key without reposting journal legs', async () => {
  mockQuery
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [{
      id: 'conversion-1',
      customer_id: CUSTOMER_ID,
      quote_id: 7,
      source_currency_code: 'USD',
      target_currency_code: 'EUR',
      source_amount_minor_units: 100,
      target_amount_minor_units: 90,
      fee_amount_minor_units: 2,
      debit_transaction_id: 'debit-1',
      fee_transaction_id: null,
      credit_transaction_id: 'credit-1',
      idempotency_key: 'conversion-1-key',
      status: 'posted',
      actor_user_id: CUSTOMER_ID,
      metadata: {},
      created_at: new Date().toISOString(),
    }] })
    .mockResolvedValueOnce({ rows: [
      { id: 'debit-1', transaction_type: 'conversion_debit', status: 'posted', debit_account_id: 1, credit_account_id: 2, amount_cents: 100, currency_code: 'USD', idempotency_key: 'debit-key' },
      { id: 'credit-1', transaction_type: 'conversion_credit', status: 'posted', debit_account_id: 3, credit_account_id: 4, amount_cents: 90, currency_code: 'EUR', idempotency_key: 'credit-key' },
    ] });

  const result = await convertCustomerCredit({
    customerId: CUSTOMER_ID,
    quoteId: 7,
    sourceAmountMinorUnits: 100,
    idempotencyKey: 'conversion-1-key',
    actorUserId: CUSTOMER_ID,
  });

  expect(result).toMatchObject({ replayed: true, conversion: { id: 'conversion-1', quoteId: '7', targetAmountMinorUnits: 90 } });
  expect(mockQuery).toHaveBeenCalledTimes(3);
});

const OTHER_CUSTOMER_ID = '33333333-3333-4333-8333-333333333333';

test('refuses to issue a currency quote without an identified customer (M27a)', async () => {
  await expect(createCurrencyQuote({
    sourceCurrencyCode: 'USD',
    targetCurrencyCode: 'EUR',
    sourceAmountMinorUnits: 100,
    targetAmountMinorUnits: 90,
    rateNumerator: '9',
    rateDenominator: '10',
    provider: 'treasury-provider',
    providerQuoteReference: 'q-nocust',
    idempotencyKey: 'quote-no-customer',
    actorUserId: ADMIN_ID,
    reason: 'Missing customer',
  })).rejects.toMatchObject({ code: 'credit_conversion_quote_customer_required', status: 400 });
  expect(mockQuery).not.toHaveBeenCalled();
});

test('rejects consuming a quote issued for a different customer (M27a)', async () => {
  mockQuery.mockImplementation(async (text) => {
    const sql = String(text);
    if (sql.includes("FROM feature_flags WHERE key = 'oxsteed_credit_enabled'")) return { rows: [{ is_enabled: true }] };
    if (sql.includes('FROM oxsteed_credit_currency_quotes')) {
      return { rows: [{ id: 7, customer_id: CUSTOMER_ID, status: 'open', source_currency_code: 'USD', source_amount_minor_units: 100, target_currency_code: 'EUR', target_amount_minor_units: 90, fee_amount_minor_units: 2, expires_at: new Date(Date.now() + 600000).toISOString() }] };
    }
    return { rows: [], rowCount: 0 };
  });

  await expect(convertCustomerCredit({
    customerId: OTHER_CUSTOMER_ID,
    quoteId: 7,
    sourceAmountMinorUnits: 100,
    idempotencyKey: 'conversion-wrong-customer',
    actorUserId: OTHER_CUSTOMER_ID,
  })).rejects.toMatchObject({ code: 'credit_conversion_quote_customer_mismatch', status: 409 });
});

test('rejects consuming a legacy quote with no bound customer (M27a)', async () => {
  mockQuery.mockImplementation(async (text) => {
    const sql = String(text);
    if (sql.includes("FROM feature_flags WHERE key = 'oxsteed_credit_enabled'")) return { rows: [{ is_enabled: true }] };
    if (sql.includes('FROM oxsteed_credit_currency_quotes')) {
      return { rows: [{ id: 7, customer_id: null, status: 'open', source_currency_code: 'USD', source_amount_minor_units: 100, target_currency_code: 'EUR', target_amount_minor_units: 90, fee_amount_minor_units: 2, expires_at: new Date(Date.now() + 600000).toISOString() }] };
    }
    return { rows: [], rowCount: 0 };
  });

  await expect(convertCustomerCredit({
    customerId: CUSTOMER_ID,
    quoteId: 7,
    sourceAmountMinorUnits: 100,
    idempotencyKey: 'conversion-legacy-quote',
    actorUserId: CUSTOMER_ID,
  })).rejects.toMatchObject({ code: 'credit_conversion_quote_customer_mismatch', status: 409 });
});

test('concurrent quote creation loses the insert race and replays the winner (M26)', async () => {
  const winner = {
    id: 9, customer_id: CUSTOMER_ID, source_currency_code: 'USD', target_currency_code: 'EUR',
    source_amount_minor_units: 100, target_amount_minor_units: 90, fee_amount_minor_units: 2,
    rate_numerator: '9', rate_denominator: '10', rounding_mode: 'half_up',
    provider: 'treasury-provider', provider_quote_reference: 'q-race', status: 'open',
    expires_at: new Date(Date.now() + 600000).toISOString(), reason: 'Race quote', metadata: {},
    created_at: new Date().toISOString(),
  };
  let quoteLookupCalls = 0;
  mockQuery.mockImplementation(async (text) => {
    const sql = String(text);
    if (sql.includes('INSERT INTO oxsteed_credit_currency_quotes')) return { rows: [] }; // lost the race
    if (sql.includes('FROM oxsteed_credit_currency_quotes WHERE idempotency_key')) {
      quoteLookupCalls += 1;
      // The pre-insert replay check misses; the post-race re-read finds the winner.
      return quoteLookupCalls === 1 ? { rows: [] } : { rows: [winner] };
    }
    if (sql.includes("FROM feature_flags WHERE key = 'oxsteed_credit_enabled'")) return { rows: [{ is_enabled: true }] };
    return { rows: [], rowCount: 0 };
  });

  const result = await createCurrencyQuote({
    customerId: CUSTOMER_ID,
    sourceCurrencyCode: 'USD',
    targetCurrencyCode: 'EUR',
    sourceAmountMinorUnits: 100,
    targetAmountMinorUnits: 90,
    feeAmountMinorUnits: 2,
    rateNumerator: '9',
    rateDenominator: '10',
    provider: 'treasury-provider',
    providerQuoteReference: 'q-race',
    idempotencyKey: 'quote-race-1',
    actorUserId: ADMIN_ID,
    reason: 'Race quote',
  });

  expect(result.replayed).toBe(true);
  expect(result.quote.customerId).toBe(CUSTOMER_ID);
  expect(result.quote.id).toBe('9');
});
