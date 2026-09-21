'use strict';

const {
  normalizeCreditPayPayload,
  normalizePaymentRequestPayload,
  normalizeIdempotencyKey,
  parsePositiveAmountCents,
  buildPaymentRequestMarker,
  parsePaymentRequestMarker,
  stripPaymentRequestMarkers,
  canPayWithOxsteedCredit,
  deriveQuotePaymentStatus,
  assertMembershipForCustomerPay,
  CREDIT_PAY_METHOD,
} = require('../services/chatOxsteedCreditPayment');

describe('chatOxsteedCreditPayment helpers', () => {
  test('amount validation rejects zero/negative/non-integer', () => {
    expect(parsePositiveAmountCents(0).code).toBe('invalid_amount');
    expect(parsePositiveAmountCents(-5).code).toBe('invalid_amount');
    expect(parsePositiveAmountCents(10.5).code).toBe('invalid_amount');
    expect(parsePositiveAmountCents(2500).amountCents).toBe(2500);
  });

  test('normalizeCreditPayPayload requires conversation + idempotency + amount', () => {
    expect(normalizeCreditPayPayload({}).code).toBe('validation_failed');
    expect(
      normalizeCreditPayPayload({ conversationId: 'c1', amountCents: 100 }).code,
    ).toBe('idempotency_required');
    const ok = normalizeCreditPayPayload({
      conversationId: 'c1',
      amountCents: 1500,
      currency: 'usd',
      idempotencyKey: 'idem-key-12345',
      quoteKind: 'helper',
      quoteId: 'q9',
      payeeBusinessId: 42,
    });
    expect(ok.error).toBeUndefined();
    expect(ok.amountCents).toBe(1500);
    expect(ok.currency).toBe('USD');
    expect(ok.payeeBusinessId).toBe(42);
    expect(ok.quoteKind).toBe('helper');
  });

  test('idempotency key helper enforces min length', () => {
    expect(normalizeIdempotencyKey('short').code).toBe('idempotency_required');
    expect(normalizeIdempotencyKey('long-enough-key').idempotencyKey).toBe('long-enough-key');
  });

  test('membership: only conversation customer may pay', () => {
    const conv = { customer_id: 'cust-1', helper_id: 'help-1' };
    expect(assertMembershipForCustomerPay('cust-1', conv).ok).toBe(true);
    expect(assertMembershipForCustomerPay('help-1', conv).code).toBe('customer_only');
    expect(assertMembershipForCustomerPay('x', null).code).toBe('forbidden');
  });

  test('guests cannot pay with credit unless guest credit exists', () => {
    expect(canPayWithOxsteedCredit({ isAuthenticated: true }).ok).toBe(true);
    expect(
      canPayWithOxsteedCredit({ isAuthenticated: false, guestVerified: true }).reason,
    ).toBe('auth_required_for_credit');
    expect(
      canPayWithOxsteedCredit({
        isAuthenticated: false,
        guestVerified: true,
        guestCreditAvailable: true,
      }).ok,
    ).toBe(true);
  });

  test('payment request marker round-trip', () => {
    const marker = buildPaymentRequestMarker({
      id: 'pr1',
      amountCents: 9900,
      currency: 'USD',
      status: 'open',
      memo: 'Deposit please',
      quoteKind: 'business',
      quoteId: '77',
    });
    const parsed = parsePaymentRequestMarker(`Please pay\n${marker}`);
    expect(parsed.id).toBe('pr1');
    expect(parsed.amountCents).toBe(9900);
    expect(parsed.memo).toBe('Deposit please');
    expect(parsed.quoteKind).toBe('business');
    expect(stripPaymentRequestMarkers(`Hi\n${marker}\nBye`)).not.toMatch(/\[payment_req:/);
  });

  test('normalizePaymentRequestPayload', () => {
    expect(normalizePaymentRequestPayload({ amountCents: 100 }).code).toBe('validation_failed');
    const ok = normalizePaymentRequestPayload({
      conversationId: 'c1',
      amount: 12.5,
      memo: 'Deposit',
    });
    expect(ok.amountCents).toBe(1250);
    expect(ok.memo).toBe('Deposit');
  });

  test('deriveQuotePaymentStatus', () => {
    expect(deriveQuotePaymentStatus(10000, 0)).toBe('unpaid');
    expect(deriveQuotePaymentStatus(10000, 5000)).toBe('partially_paid');
    expect(deriveQuotePaymentStatus(10000, 10000)).toBe('paid');
    expect(deriveQuotePaymentStatus(10000, 12000)).toBe('paid');
  });

  test('CREDIT_PAY_METHOD constant', () => {
    expect(CREDIT_PAY_METHOD).toBe('oxsteed_credit');
  });
});
