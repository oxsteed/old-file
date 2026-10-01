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

const {
  resolveChatPurchaseOrderType,
  normalizeCreditRefundPayload,
  buildCreditRefundMarker,
  parseCreditRefundMarker,
  stripCreditRefundMarkers,
} = require('../services/chatOxsteedCreditPayment');

describe('chat credit refund + order-type helpers', () => {
  test('resolveChatPurchaseOrderType prefers service then first allowed', () => {
    expect(resolveChatPurchaseOrderType([])).toBe('service');
    expect(resolveChatPurchaseOrderType(['service', 'pickup'])).toBe('service');
    expect(resolveChatPurchaseOrderType(['pickup', 'delivery'])).toBe('pickup');
  });

  test('normalizeCreditRefundPayload requires reason + idempotency', () => {
    expect(normalizeCreditRefundPayload({}).code).toBeTruthy();
    expect(normalizeCreditRefundPayload({ reason: 'too short?' }).code).toBeTruthy();
    const ok = normalizeCreditRefundPayload({
      reason: 'Customer cancelled the job',
      amountCents: 1500,
      idempotencyKey: 'refund-key-12345',
      popId: 'pop-1',
    });
    expect(ok.error).toBeUndefined();
    expect(ok.amountCents).toBe(1500);
    expect(ok.popId).toBe('pop-1');
  });

  test('credit refund marker round-trip', () => {
    const marker = buildCreditRefundMarker({
      id: 'rf1',
      amountCents: 2500,
      currency: 'USD',
      status: 'posted',
      popId: 'pop9',
      refundTxnId: 'txn9',
    });
    const parsed = parseCreditRefundMarker(`Refunded\n${marker}`);
    expect(parsed.id).toBe('rf1');
    expect(parsed.amountCents).toBe(2500);
    expect(parsed.popId).toBe('pop9');
    expect(stripCreditRefundMarkers(`Hi\n${marker}\nBye`)).not.toMatch(/\[credit_refund:/);
  });
});

jest.mock('../services/chatThreadAccess', () => ({
  assertConversationParticipant: jest.fn(),
  assertGuestInquiryAccess: jest.fn(),
  assertBusinessAccess: jest.fn(),
  isProviderOnConversation: jest.fn(),
  isCustomerOnConversation: jest.fn(),
}));

describe('chat credit refund transaction binding (M10)', () => {
  const chatThreadAccess = require('../services/chatThreadAccess');
  const controller = require('../controllers/chatOxsteedCreditPaymentController');
  const { mockQuery, resetMocks } = require('./setup');

  function mockReqRes(body) {
    const res = {};
    res.status = jest.fn().mockReturnValue(res);
    res.json = jest.fn().mockReturnValue(res);
    const req = { params: {}, body, query: {}, user: { id: 'help-1' }, headers: {}, ip: '127.0.0.1', socket: {} };
    return { req, res, next: jest.fn() };
  }

  beforeEach(() => {
    resetMocks();
    jest.clearAllMocks();
    chatThreadAccess.assertConversationParticipant.mockResolvedValue({ id: 'conv-1', customer_id: 'cust-1', helper_id: 'help-1' });
    chatThreadAccess.isProviderOnConversation.mockReturnValue(true);
    chatThreadAccess.assertBusinessAccess.mockResolvedValue(true);
  });

  test('rejects a body-supplied creditTxnId that differs from the pop transaction', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{
      id: 'pop-1', conversation_id: 'conv-1', credit_txn_id: 'txn-real',
      amount_cents: 1000, refunded_amount_cents: 0,
    }] });
    const { req, res, next } = mockReqRes({
      popId: 'pop-1',
      creditTxnId: 'txn-evil',
      reason: 'Customer cancelled the job',
      idempotencyKey: 'refund-key-m10-1',
    });

    await controller.refundChatCreditPayment(req, res, next);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'credit_txn_mismatch' }));
    expect(next).not.toHaveBeenCalled();
  });

  test('rejects a pop that belongs to a different conversation', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{
      id: 'pop-1', conversation_id: 'conv-1', credit_txn_id: 'txn-real',
      amount_cents: 1000, refunded_amount_cents: 0,
    }] });
    const { req, res, next } = mockReqRes({
      popId: 'pop-1',
      conversationId: 'conv-2',
      reason: 'Customer cancelled the job',
      idempotencyKey: 'refund-key-m10-2',
    });

    await controller.refundChatCreditPayment(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'forbidden' }));
  });

  test('rejects a standalone creditTxnId that is not a chat payment for this conversation', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{
      id: 'txn-x', reference_type: 'purchase', reference_id: 'some-other-conv', metadata: {},
    }] });
    const { req, res, next } = mockReqRes({
      creditTxnId: 'txn-x',
      conversationId: 'conv-1',
      reason: 'Customer cancelled the job',
      idempotencyKey: 'refund-key-m10-3',
    });

    await controller.refundChatCreditPayment(req, res, next);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'credit_txn_mismatch' }));
  });
});
