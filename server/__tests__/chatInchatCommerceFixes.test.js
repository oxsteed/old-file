'use strict';

/**
 * chatInchatCommerceFixes.test.js
 *
 * Regression tests for the P2-10 in-chat commerce bundle (B-inchat):
 * - F02: createMessengerGuestBooking authenticated branch honors clientRequestId
 * - F03: guest booking creates the durable booking_request before the appointment
 * - F05: reviseQuote refuses to supersede accepted/approved quotes
 * - F06: reviseAgreement refuses to revert an accepted/acknowledged agreement
 * - F07: quote payment metadata requires thread + provider ownership
 * - F08: refundChatCreditPayment rolls back quote paid metadata
 * - F11: respondAgreement fans out over socket for token-only acceptance
 * - F13: intakes support provider follow-up rounds; responses merge
 */

const { mockQuery, resetMocks } = require('./setup');

jest.mock('../services/chatThreadAccess', () => {
  const CUSTOMER = '00000000-0000-4000-8000-000000000c01';
  const HELPER = '00000000-0000-4000-8000-000000000d02';
  const CONV = '00000000-0000-4000-8000-000000000e03';
  const conv = { id: CONV, customer_id: CUSTOMER, helper_id: HELPER, business_id: null };
  return {
    assertConversationParticipant: jest.fn(async (userId) => (userId ? conv : null)),
    assertGuestInquiryAccess: jest.fn(async () => null),
    assertBusinessAccess: jest.fn(async () => null),
    resolveGuestFromRequest: jest.fn(async () => null),
    isProviderOnConversation: jest.fn((userId, c) => String(userId) === String((c || {}).helper_id)),
    isCustomerOnConversation: jest.fn((userId, c) => String(userId) === String((c || {}).customer_id)),
    __ids: { CUSTOMER, HELPER, CONV },
  };
});
jest.mock('../services/messageNotificationService', () => ({
  enqueueConversationMessageNotifications: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../services/bookingRequestLifecycle', () => ({
  validateBookingSlot: jest.fn(async () => ({ ok: true })),
  emitBookingEvent: jest.fn(async () => undefined),
}));
jest.mock('../services/oxsteedCreditService', () => ({
  refundCreditInTransaction: jest.fn(async () => ({ transaction: { id: 'refund-txn-1' } })),
  refundCreditForReferenceInTransaction: jest.fn(async () => ({ transaction: { id: 'refund-txn-1' } })),
}));

const socketService = require('../services/socketService');
const { __ids } = require('../services/chatThreadAccess');

function mockRes() {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
}

beforeEach(() => {
  resetMocks();
  jest.clearAllMocks();
});

// ---------------------------------------------------------------------------
// F05: reviseQuote status gate
// ---------------------------------------------------------------------------
describe('F05 reviseQuote status gate', () => {
  const quotesCtl = require('../controllers/chatQuotesController');

  function routeForRevise(parent) {
    mockQuery.mockImplementation(async (sql, params = []) => {
      const text = String(sql);
      if (text.includes('FROM business_quotes WHERE id = $1')) return { rows: [parent] };
      if (text.includes('FROM businesses b')) {
        return { rows: [{ id: 'b1', user_id: __ids.HELPER, business_name: 'Biz' }] };
      }
      if (text.includes('FROM conversations c')) {
        return { rows: [{ id: __ids.CONV, customer_id: __ids.CUSTOMER, helper_id: __ids.HELPER, business_id: null }] };
      }
      if (text.includes('SET superseded_at = NOW()')) return { rows: [] };
      return { rows: [] };
    });
  }

  test('accepted quote cannot be revised (409 quote_locked), no supersede write', async () => {
    routeForRevise({
      id: 'q1', status: 'approved', version: 1, superseded_at: null,
      business_id: 'b1', conversation_id: __ids.CONV, guest_session_id: null,
      booking_request_id: null, line_items: [], tax_rate: 0,
      title: 'T', client_name: 'C', client_email: 'c@x.com', valid_until: null,
    });
    const req = {
      params: { kind: 'business', id: 'q1' },
      body: { title: 'New' },
      user: { id: __ids.HELPER, first_name: 'H', last_name: 'P' },
    };
    const res = mockRes();
    const next = jest.fn();
    await quotesCtl.reviseQuote(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'quote_locked' }),
    );
    const writes = mockQuery.mock.calls.filter(([sql]) =>
      /SET superseded_at|INSERT INTO (business|helper)_quotes/.test(String(sql)));
    expect(writes).toHaveLength(0);
  });

  test('declined quote stays revisable (reaches supersede write)', async () => {
    routeForRevise({
      id: 'q1', status: 'declined', version: 1, superseded_at: null,
      business_id: 'b1', conversation_id: __ids.CONV, guest_session_id: null,
      booking_request_id: null, line_items: [], tax_rate: 0,
      title: 'T', client_name: 'C', client_email: 'c@x.com', valid_until: null,
    });
    const req = {
      params: { kind: 'business', id: 'q1' },
      body: {
        title: 'New',
        reshare: false,
        line_items: [{ description: 'Labor', quantity: 1, unit_price_cents: 5000 }],
      },
      user: { id: __ids.HELPER, first_name: 'H', last_name: 'P' },
    };
    const res = mockRes();
    const next = jest.fn();
    await quotesCtl.reviseQuote(req, res, next).catch(() => {});
    const supersede = mockQuery.mock.calls.filter(([sql]) =>
      /SET superseded_at = NOW\(\), updated_at = NOW\(\) WHERE id/.test(String(sql)));
    expect(supersede.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// F06: reviseAgreement status gate
// ---------------------------------------------------------------------------
describe('F06 reviseAgreement status gate', () => {
  const agreementsCtl = require('../controllers/chatAgreementsController');

  function routeForRevise(parent) {
    mockQuery.mockImplementation(async (sql) => {
      const text = String(sql);
      if (text.includes('FROM chat_agreements WHERE id = $1')) return { rows: [parent] };
      return { rows: [] };
    });
  }

  test('accepted agreement cannot be revised (409 agreement_locked), no supersede write', async () => {
    routeForRevise({
      id: 'a1', status: 'accepted', version: 1, superseded_at: null,
      conversation_id: __ids.CONV, guest_session_id: null,
      business_id: null, helper_id: __ids.HELPER, title: 'T',
    });
    const req = {
      params: { id: 'a1' },
      body: { title: 'New terms' },
      user: { id: __ids.HELPER, first_name: 'H', last_name: 'P' },
    };
    const res = mockRes();
    const next = jest.fn();
    await agreementsCtl.reviseAgreement(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'agreement_locked' }),
    );
    const writes = mockQuery.mock.calls.filter(([sql]) =>
      /SET status = 'superseded'|INSERT INTO chat_agreements/.test(String(sql)));
    expect(writes).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// F07: quote payment metadata thread/ownership validation
// ---------------------------------------------------------------------------
describe('F07 requestPayment quote validation', () => {
  const payCtl = require('../controllers/chatOxsteedCreditPaymentController');

  function routeForRequest(quoteRow) {
    mockQuery.mockImplementation(async (sql) => {
      const text = String(sql);
      if (/FROM (business|helper)_quotes WHERE id =/.test(text)) {
        return { rows: quoteRow ? [quoteRow] : [] };
      }
      if (text.includes('INSERT INTO chat_payment_requests')) {
        return { rows: [{ id: 'pr1', status: 'open', amount_cents: 5000, currency: 'USD', memo: null, quote_kind: 'helper', quote_id: 'q9', message_id: null }] };
      }
      if (text.includes('INSERT INTO messages')) {
        return { rows: [{ id: 'm1' }] };
      }
      return { rows: [] };
    });
  }

  function baseReq(overrides = {}) {
    return {
      body: {
        conversationId: __ids.CONV,
        amountCents: 5000,
        currency: 'USD',
        idempotencyKey: 'long-enough-idempotency-key-1',
        quoteKind: 'helper',
        quoteId: 'q9',
        ...overrides,
      },
      user: { id: __ids.HELPER, first_name: 'H', last_name: 'P' },
      get: () => null,
      headers: {},
      ip: '127.0.0.1',
    };
  }

  test('quote from another conversation is refused (403 quote_thread_mismatch)', async () => {
    routeForRequest({
      id: 'q9', conversation_id: 'other-conv', guest_session_id: null,
      business_id: null, helper_id: __ids.HELPER, status: 'sent',
    });
    const res = mockRes();
    const next = jest.fn();
    await payCtl.requestPayment(baseReq(), res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'quote_thread_mismatch' }),
    );
    const inserts = mockQuery.mock.calls.filter(([sql]) =>
      String(sql).includes('INSERT INTO chat_payment_requests'));
    expect(inserts).toHaveLength(0);
  });

  test('quote owned by another provider is refused', async () => {
    routeForRequest({
      id: 'q9', conversation_id: __ids.CONV, guest_session_id: null,
      business_id: null, helper_id: 'someone-else', status: 'sent',
    });
    const res = mockRes();
    const next = jest.fn();
    await payCtl.requestPayment(baseReq(), res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'quote_thread_mismatch' }),
    );
  });
});

// ---------------------------------------------------------------------------
// F08: refund rolls back quote paid metadata
// ---------------------------------------------------------------------------
describe('F08 refund rolls back quote paid metadata', () => {
  const payCtl = require('../controllers/chatOxsteedCreditPaymentController');

  test('full refund decrements amount_paid_cents and recomputes payment_status', async () => {
    const pop = {
      id: 'pop1', conversation_id: __ids.CONV, status: 'confirmed',
      amount_cents: 5000, refunded_amount_cents: 0, currency: 'USD',
      payment_method: 'oxsteed_credit', transaction_id: 'purchase-txn-1',
      credit_txn_id: 'purchase-txn-1', quote_kind: 'helper', quote_id: 'q9',
      payment_request_id: 'pr1',
    };
    const payReq = {
      id: 'pr1', conversation_id: __ids.CONV, status: 'paid',
      amount_cents: 5000, refunded_amount_cents: 0, currency: 'USD',
      credit_txn_id: 'purchase-txn-1', paid_pop_id: 'pop1',
      quote_kind: 'helper', quote_id: 'q9',
    };
    const decrementCalls = [];
    mockQuery.mockImplementation(async (sql, params = []) => {
      const text = String(sql);
      if (text.includes('FROM chat_payment_requests WHERE id = $1')) return { rows: [payReq] };
      if (text.includes('FROM chat_proof_of_payments WHERE id = $1')) return { rows: [pop] };
      if (text.includes('FROM chat_credit_refunds')) return { rows: [] };
      if (text.includes('UPDATE chat_proof_of_payments')) return { rows: [{ ...pop, status: 'refunded', refunded_amount_cents: 5000 }] };
      if (text.includes('UPDATE chat_payment_requests')) return { rows: [{ ...payReq, status: 'refunded', refunded_amount_cents: 5000 }] };
      if (text.includes('UPDATE helper_quotes') && text.includes('amount_paid_cents = GREATEST')) {
        decrementCalls.push({ sql: text, params });
        return { rows: [{ id: 'q9', total_cents: 5000, amount_paid_cents: 0, status: 'accepted' }] };
      }
      if (text.includes('UPDATE helper_quotes') && text.includes('SET payment_status')) {
        return { rows: [] };
      }
      if (text.includes('INSERT INTO chat_credit_refunds')) {
        return { rows: [{ id: 'r1', amount_cents: 5000, currency: 'USD' }] };
      }
      if (text.includes('INSERT INTO messages')) return { rows: [{ id: 'm1' }] };
      return { rows: [] };
    });

    const req = {
      params: { id: 'pr1' },
      body: { reason: 'customer asked', idempotencyKey: 'long-enough-refund-key-1' },
      user: { id: __ids.HELPER, first_name: 'H', last_name: 'P' },
      get: () => null,
      headers: {},
      ip: '127.0.0.1',
    };
    const res = mockRes();
    const next = jest.fn();
    await payCtl.refundChatCreditPayment(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(201);
    // The quote paid metadata was rolled back by the refunded amount.
    expect(decrementCalls).toHaveLength(1);
    expect(decrementCalls[0].params[1]).toBe(5000);
    const statusUpdate = mockQuery.mock.calls.find(([sql]) =>
      String(sql).includes('UPDATE helper_quotes') && String(sql).includes('SET payment_status'));
    expect(statusUpdate).toBeTruthy();
    expect(statusUpdate[1][1]).toBe('unpaid');
  });
});

// ---------------------------------------------------------------------------
// F11: respondAgreement socket fan-out for token-only acceptance
// ---------------------------------------------------------------------------
describe('F11 respondAgreement token-only fan-out', () => {
  const agreementsCtl = require('../controllers/chatAgreementsController');

  test('token-only acceptance emits socket event to the conversation room', async () => {
    const row = {
      id: 'a1', token: 'tok123', status: 'shared', version: 1,
      conversation_id: __ids.CONV, guest_session_id: null,
      business_id: null, helper_id: __ids.HELPER, title: 'Terms',
      customer_id: null,
    };
    mockQuery.mockImplementation(async (sql) => {
      const text = String(sql);
      if (text.includes('FROM chat_agreements WHERE id = $1')) return { rows: [row] };
      if (text.includes('UPDATE chat_agreements')) {
        return { rows: [{ ...row, status: 'accepted' }] };
      }
      if (text.includes('INSERT INTO chat_agreement_responses')) return { rows: [] };
      return { rows: [] };
    });
    const req = {
      params: { id: 'a1' },
      body: { action: 'accept', token: 'tok123' },
      query: {},
      headers: {},
      ip: '127.0.0.1',
    };
    const res = mockRes();
    const next = jest.fn();
    await agreementsCtl.respondAgreement(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ evidence_recorded: true }),
    );
    const convoEmits = socketService.broadcastToConversation.mock.calls.filter(
      ([room]) => String(room) === String(__ids.CONV),
    );
    expect(convoEmits.length).toBeGreaterThan(0);
    expect(convoEmits[0][2]).toEqual(
      expect.objectContaining({ agreementEvent: true }),
    );
    expect(convoEmits[0][2].message).toEqual(
      expect.objectContaining({ agreementStatus: 'accepted' }),
    );
  });
});

// ---------------------------------------------------------------------------
// F02: authenticated messenger booking idempotency replay
// ---------------------------------------------------------------------------
describe('F02 authenticated messenger booking idempotency', () => {
  const chatCtl = require('../controllers/chatController');

  test('replay with the same clientRequestId returns the existing request (200, idempotent)', async () => {
    const existing = {
      id: 'br-existing', status: 'pending', customer_id: __ids.CUSTOMER,
      helper_id: __ids.HELPER, appointment_id: null,
      requested_date: '2026-10-20', requested_start_time: '10:00:00',
      requested_end_time: '11:00:00', service_name: 'Service request', service_id: null,
    };
    mockQuery.mockImplementation(async (sql) => {
      const text = String(sql);
      if (text.includes('FROM booking_requests') && text.includes('customer_id = $1 AND client_request_id = $2')) {
        return { rows: [existing] };
      }
      return { rows: [] };
    });
    const req = {
      body: {
        helperId: __ids.HELPER,
        requestedDate: '2026-10-20',
        requestedStartTime: '10:00',
        requestedEndTime: '11:00',
        clientRequestId: '11111111-1111-4111-8111-111111111111',
      },
      user: { id: __ids.CUSTOMER, first_name: 'C', last_name: 'U', email: 'c@x.com' },
      get: () => null,
      headers: {},
      guestSession: null,
    };
    const res = mockRes();
    const next = jest.fn();
    await chatCtl.createMessengerGuestBooking(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ bookingId: 'br-existing', idempotent: true }),
    );
    const inserts = mockQuery.mock.calls.filter(([sql]) =>
      String(sql).includes('INSERT INTO booking_requests'));
    expect(inserts).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// F13: intake follow-up rounds + response merging
// ---------------------------------------------------------------------------
describe('F13 intake follow-up rounds', () => {
  const intakeCtl = require('../controllers/chatClientIntakeController');

  test('provider can append a follow-up round; intake reopens with merged fields', async () => {
    const intake = {
      id: 'i1', session_id: 'gs1', helper_id: __ids.HELPER, business_id: null,
      title: 'T', description: null, status: 'completed',
      fields: [{ id: 'field_1', label: 'Q1', type: 'text', required: true, options: [] }],
      responses: { field_1: 'A1' },
    };
    mockQuery.mockImplementation(async (sql) => {
      const text = String(sql);
      if (text.includes('FROM guest_profile_chat_intakes WHERE id = $1')) return { rows: [intake] };
      if (text.includes('FROM guest_profile_chat_inbound g')) {
        return { rows: [{ id: 'gs1', helper_id: __ids.HELPER, business_id: null }] };
      }
      if (text.includes('UPDATE guest_profile_chat_intakes')) {
        return {
          rows: [{
            ...intake,
            status: 'open',
            fields: [...intake.fields, { id: 'field_2', label: 'Q2', type: 'text', required: true, options: [] }],
            responses: intake.responses,
          }],
        };
      }
      if (text.includes('INSERT INTO guest_profile_chat_messages')) return { rows: [{ id: 'm1', created_at: new Date() }] };
      return { rows: [] };
    });
    const req = {
      params: { id: 'i1' },
      body: { fields: [{ label: 'Q2', type: 'text', required: true }] },
      user: { id: __ids.HELPER, first_name: 'H', last_name: 'P' },
    };
    const res = mockRes();
    const next = jest.fn();
    await intakeCtl.addFollowUpRound(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(201);
    const updated = res.json.mock.calls[0][0].intake;
    expect(updated.status).toBe('open');
    expect(updated.fields).toHaveLength(2);
    expect(updated.fields[1].label).toBe('Q2');
    // Field ids must not collide with the existing round.
    expect(updated.fields[1].id).not.toBe('field_1');
    expect(updated.responses).toEqual({ field_1: 'A1' });
  });

  test('respondToIntake merges follow-up answers with prior responses', async () => {
    const intake = {
      id: 'i1', session_id: 'gs1',
      status: 'open',
      fields: [
        { id: 'field_1', label: 'Q1', type: 'text', required: true, options: [] },
        { id: 'field_2', label: 'Q2', type: 'text', required: true, options: [] },
      ],
      responses: { field_1: 'A1' },
    };
    let savedResponses = null;
    mockQuery.mockImplementation(async (sql, params = []) => {
      const text = String(sql);
      if (text.includes('FROM guest_profile_chat_intakes i')) return { rows: [intake] };
      if (text.includes('UPDATE guest_profile_chat_intakes')) {
        savedResponses = JSON.parse(params[1]);
        return { rows: [] };
      }
      if (text.includes('INSERT INTO guest_profile_chat_messages')) return { rows: [{ id: 'm1', created_at: new Date() }] };
      return { rows: [] };
    });
    const req = {
      params: { id: 'i1' },
      body: { responses: { field_2: 'A2' } },
      guestSession: { id: 'gs1', guest_name: 'G', guest_email: 'g@x.com' },
    };
    const res = mockRes();
    const next = jest.fn();
    await intakeCtl.respondToIntake(req, res, next);
    expect(next).not.toHaveBeenCalled();
    // Prior answer kept, new answer merged; required validation passed
    // without re-submitting the old answer.
    expect(savedResponses).toEqual({ field_1: 'A1', field_2: 'A2' });
  });
});
