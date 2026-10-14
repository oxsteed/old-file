'use strict';

/**
 * chatPopPaymentRequestLink.test.js
 *
 * Review P2-10-F01: the off-platform (proof-of-payment) path must carry the
 * same close/reject guards as the credit-pay path.
 * - sharePop accepts an optional payment_request_id: the request must exist,
 *   belong to the conversation, still be open, and match the POP amount
 *   (409 otherwise); the provider cannot submit proof for their own request.
 * - confirmPop closes the linked request open -> paid with AND
 *   status='open', so a POP confirm can never double-pay a request the
 *   credit path already closed. Rejects leave the request open.
 */

const express = require('express');
const request = require('supertest');
const { mockQuery, resetMocks } = require('./setup');
const { errorHandler } = require('../middleware/errorHandler');

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
    __ids: { CUSTOMER, HELPER, CONV },
  };
});
jest.mock('../services/messageNotificationService', () => ({
  enqueueConversationMessageNotifications: jest.fn().mockResolvedValue(undefined),
}));

const chatPop = require('../controllers/chatProofOfPaymentController');
const { __ids } = require('../services/chatThreadAccess');

const PAY_REQ_ID = '00000000-0000-4000-8000-000000000f04';

function payRequest(overrides = {}) {
  return {
    id: PAY_REQ_ID,
    conversation_id: __ids.CONV,
    guest_session_id: null,
    status: 'open',
    amount_cents: 5000,
    currency: 'USD',
    ...overrides,
  };
}

function popRow(overrides = {}) {
  return {
    id: 'pop-1',
    conversation_id: __ids.CONV,
    guest_session_id: null,
    business_id: null,
    helper_id: __ids.HELPER,
    status: 'submitted',
    amount_cents: 5000,
    currency: 'USD',
    payment_method: 'Zelle',
    payment_request_id: null,
    submitted_by: __ids.CUSTOMER,
    ...overrides,
  };
}

let currentPayRequest = null;
let currentPop = null;

function routeQueries() {
  mockQuery.mockImplementation(async (sql, params = []) => {
    const text = String(sql).trim();
    if (text.includes('FROM chat_payment_requests WHERE id = $1')) {
      return { rows: currentPayRequest ? [currentPayRequest] : [] };
    }
    if (text.startsWith('INSERT INTO chat_proof_of_payments')) {
      const row = popRow({
        payment_request_id: params[20] || null,
        submitted_by: params[17] || null,
      });
      currentPop = row;
      return { rows: [row] };
    }
    if (text.startsWith('SELECT * FROM chat_proof_of_payments WHERE id = $1')) {
      return { rows: currentPop ? [currentPop] : [] };
    }
    if (text.startsWith('UPDATE chat_proof_of_payments') && text.includes('SET status = $1')) {
      currentPop = { ...currentPop, status: params[0], confirmed_by: params[1] };
      return { rows: [currentPop] };
    }
    if (text.startsWith('UPDATE chat_proof_of_payments')) {
      currentPop = { ...currentPop, message_id: params[0] };
      return { rows: [currentPop] };
    }
    if (text.startsWith('UPDATE chat_payment_requests')) {
      return { rows: [] };
    }
    if (text.startsWith('INSERT INTO messages')) {
      return { rows: [{ id: 'm1', conversation_id: __ids.CONV }] };
    }
    return { rows: [], rowCount: 0 };
  });
}

function buildApp(userId) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: userId, first_name: 'Test', last_name: 'User' };
    next();
  });
  app.post('/api/chat/pop/share', chatPop.sharePop);
  app.post('/api/chat/pop/:id/confirm', chatPop.confirmPop);
  app.use(errorHandler);
  return app;
}

function shareBody(overrides = {}) {
  return {
    conversationId: __ids.CONV,
    payment_method: 'Zelle',
    transaction_id: 'txn-1',
    amount_cents: 5000,
    currency: 'USD',
    ...overrides,
  };
}

beforeEach(() => {
  resetMocks();
  jest.clearAllMocks();
  currentPayRequest = payRequest();
  currentPop = null;
  routeQueries();
});

describe('sharePop payment-request linkage', () => {
  test('links the POP to an open request for the same conversation', async () => {
    const res = await request(buildApp(__ids.CUSTOMER))
      .post('/api/chat/pop/share')
      .send(shareBody({ payment_request_id: PAY_REQ_ID }));

    expect([200, 201]).toContain(res.status);
    expect(currentPop.payment_request_id).toBe(PAY_REQ_ID);
    const insertCall = mockQuery.mock.calls.find(([sql]) => String(sql).startsWith('INSERT INTO chat_proof_of_payments'));
    expect(insertCall[0]).toContain('payment_request_id');
  });

  test('rejects a non-open request with 409', async () => {
    currentPayRequest = payRequest({ status: 'paid' });
    const res = await request(buildApp(__ids.CUSTOMER))
      .post('/api/chat/pop/share')
      .send(shareBody({ payment_request_id: PAY_REQ_ID }));

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('invalid_status');
    expect(currentPop).toBeNull();
  });

  test('rejects an amount mismatch with 409', async () => {
    const res = await request(buildApp(__ids.CUSTOMER))
      .post('/api/chat/pop/share')
      .send(shareBody({ payment_request_id: PAY_REQ_ID, amount_cents: 4999 }));

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('amount_mismatch');
    expect(currentPop).toBeNull();
  });

  test('rejects a request from another conversation with 403', async () => {
    currentPayRequest = payRequest({ conversation_id: '00000000-0000-4000-8000-999999999999' });
    const res = await request(buildApp(__ids.CUSTOMER))
      .post('/api/chat/pop/share')
      .send(shareBody({ payment_request_id: PAY_REQ_ID }));

    expect(res.status).toBe(403);
    expect(currentPop).toBeNull();
  });

  test('rejects an unknown request with 404', async () => {
    currentPayRequest = null;
    const res = await request(buildApp(__ids.CUSTOMER))
      .post('/api/chat/pop/share')
      .send(shareBody({ payment_request_id: PAY_REQ_ID }));

    expect(res.status).toBe(404);
    expect(currentPop).toBeNull();
  });

  test('provider cannot submit proof for their own request', async () => {
    const res = await request(buildApp(__ids.HELPER))
      .post('/api/chat/pop/share')
      .send(shareBody({ payment_request_id: PAY_REQ_ID }));

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('provider_only');
    expect(currentPop).toBeNull();
  });
});

describe('confirmPop closes the linked payment request', () => {
  async function submitLinkedPop() {
    const res = await request(buildApp(__ids.CUSTOMER))
      .post('/api/chat/pop/share')
      .send(shareBody({ payment_request_id: PAY_REQ_ID }));
    expect([200, 201]).toContain(res.status);
  }

  test('confirm closes the request open -> paid with AND status=open', async () => {
    await submitLinkedPop();
    const res = await request(buildApp(__ids.HELPER))
      .post('/api/chat/pop/pop-1/confirm')
      .send({ action: 'confirm' });

    expect(res.status).toBe(200);
    const closeCall = mockQuery.mock.calls.find(
      ([sql]) => String(sql).startsWith('UPDATE chat_payment_requests')
        && String(sql).includes("SET status = 'paid'")
    );
    expect(closeCall).toBeDefined();
    expect(closeCall[0]).toContain("AND status = 'open'");
    expect(closeCall[0]).toContain('expires_at > NOW()');
    expect(closeCall[1]).toEqual([PAY_REQ_ID, 'pop-1', null]);
  });

  test('reject leaves the request open (no close)', async () => {
    await submitLinkedPop();
    const res = await request(buildApp(__ids.HELPER))
      .post('/api/chat/pop/pop-1/confirm')
      .send({ action: 'reject', reason: 'illegible' });

    expect(res.status).toBe(200);
    const closeCall = mockQuery.mock.calls.find(
      ([sql]) => String(sql).startsWith('UPDATE chat_payment_requests')
        && String(sql).includes("SET status = 'paid'")
    );
    expect(closeCall).toBeUndefined();
  });
});
