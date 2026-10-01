'use strict';

// WS3 remediation tests: M7 (consulting payment idempotency / atomic insert) and
// M15 (caller-supplied attachment_key must be minted for the conversation scope).
// Unit-style: ../db (pg) and stripe are mocked via __tests__/setup.

require('./setup');

const { mockQuery, resetMocks } = require('./setup');

jest.mock('../utils/storage', () => {
  const actual = jest.requireActual('../utils/storage');
  return { ...actual, uploadFile: jest.fn(), getSignedDownloadUrl: jest.fn() };
});

jest.mock('../services/chatThreadAccess', () => ({
  assertConversationParticipant: jest.fn(),
  assertGuestInquiryAccess: jest.fn(),
  assertBusinessAccess: jest.fn(),
  resolveGuestFromRequest: jest.fn(),
  isProviderOnConversation: jest.fn(),
  isCustomerOnConversation: jest.fn(),
}));

jest.mock('../services/messageNotificationService', () => ({
  enqueueConversationMessageNotifications: jest.fn().mockResolvedValue([]),
}));

jest.mock('../services/businessConversationSync', () => ({
  mirrorLegacyMessage: jest.fn().mockResolvedValue(undefined),
}));

const storage = require('../utils/storage');
const chatThreadAccess = require('../services/chatThreadAccess');
const consultingPaymentController = require('../controllers/consultingPaymentController');
const chatPopController = require('../controllers/chatProofOfPaymentController');
const chatAgreementsController = require('../controllers/chatAgreementsController');

const stripeMock = require('stripe').__mockInstance;

function mockRes() {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
}

function mockReq(overrides = {}) {
  return {
    user: undefined,
    body: {},
    headers: {},
    ip: '127.0.0.1',
    get: jest.fn(() => null),
    ...overrides,
  };
}

const USER = { id: 'user-1', role: 'customer', first_name: 'Pat', last_name: 'Lee' };
const CONV = { id: 'conv-1', customer_id: 'customer-1', helper_id: 'helper-1', business_id: null };

beforeEach(() => {
  resetMocks();
  jest.clearAllMocks();
  chatThreadAccess.assertConversationParticipant.mockResolvedValue(CONV);
  chatThreadAccess.resolveGuestFromRequest.mockResolvedValue(null);
  chatThreadAccess.isProviderOnConversation.mockReturnValue(true);
});

describe('M7 - consulting createPaymentIntent', () => {
  const sessionRow = {
    id: 'sess-1',
    user_id: 'user-1',
    email: 'pat@example.com',
    first_name: 'Pat',
    last_name: 'Lee',
    service_tier: 'standard',
    scheduled_id: 'sched-1',
  };
  const packageRow = { id: 'pkg-9', service_tier: 'standard', package_name: 'Standard', base_price: 5000 };

  function queueHappyPath({ insertRows }) {
    mockQuery
      .mockResolvedValueOnce({ rows: [sessionRow] }) // session lookup
      .mockResolvedValueOnce({ rows: [] }) // fast-path guard: nothing processing
      .mockResolvedValueOnce({ rows: [packageRow] }) // package lookup
      .mockResolvedValueOnce({ rows: insertRows }); // atomic insert
  }

  test('passes a deterministic Stripe idempotency key and uses an atomic guarded INSERT', async () => {
    const paymentRow = {
      id: 'pay-1',
      session_scheduled_id: 'sched-1',
      amount_cents: 5000,
      service_tier: 'standard',
      status: 'processing',
      created_at: new Date().toISOString(),
    };
    queueHappyPath({ insertRows: [paymentRow] });
    stripeMock.paymentIntents.create.mockResolvedValue({ id: 'pi_1', client_secret: 'cs_1' });

    const req = mockReq({ user: USER, body: { sessionId: 'sess-1', packageId: 'pkg-9' } });
    const res = mockRes();
    await consultingPaymentController.createPaymentIntent(req, res);

    const createCall = stripeMock.paymentIntents.create.mock.calls[0];
    expect(createCall[1]).toEqual({ idempotencyKey: 'consulting:sched-1:pkg-9' });

    const insertSql = mockQuery.mock.calls[3][0];
    expect(insertSql).toMatch(/ON CONFLICT \(session_scheduled_id\)/);
    expect(insertSql).toMatch(/WHERE status IN \('pending', 'processing'\) DO NOTHING/);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ clientSecret: 'cs_1', payment: paymentRow })
    );
  });

  test('lost INSERT race re-reads the live payment and returns the same 409 shape', async () => {
    queueHappyPath({ insertRows: [] }); // ON CONFLICT DO NOTHING: another request won
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'pay-race', stripe_payment_intent_id: 'pi_1' }],
    }); // live re-query
    stripeMock.paymentIntents.create.mockResolvedValue({ id: 'pi_1', client_secret: 'cs_1' });

    const req = mockReq({ user: USER, body: { sessionId: 'sess-1', packageId: 'pkg-9' } });
    const res = mockRes();
    await consultingPaymentController.createPaymentIntent(req, res);

    expect(mockQuery).toHaveBeenCalledTimes(5);
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Payment already in progress for this session',
      paymentId: 'pay-race',
    });
  });

  test('fast-path guard still short-circuits before Stripe is called', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [sessionRow] })
      .mockResolvedValueOnce({ rows: [{ id: 'pay-live', stripe_payment_intent_id: 'pi_live' }] });

    const req = mockReq({ user: USER, body: { sessionId: 'sess-1', packageId: 'pkg-9' } });
    const res = mockRes();
    await consultingPaymentController.createPaymentIntent(req, res);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Payment already in progress for this session',
      paymentId: 'pay-live',
    });
    expect(stripeMock.paymentIntents.create).not.toHaveBeenCalled();
  });
});

describe('M15 - chat proof-of-payment attachment_key scoping', () => {
  const popRow = {
    id: 'pop-1',
    status: 'submitted',
    amount_cents: 1000,
    currency: 'USD',
    payment_method: 'Cash',
    transaction_id: null,
    paid_on: null,
    quote_kind: null,
    quote_id: null,
    notes: null,
    booking_request_id: null,
    conversation_id: 'conv-1',
    guest_session_id: null,
  };
  const messageRow = { id: 'msg-1', conversation_id: 'conv-1', content: 'x' };

  test('rejects a caller-supplied key minted for another conversation', async () => {
    const req = mockReq({
      user: USER,
      body: {
        conversationId: 'conv-1',
        amount_cents: 1000,
        payment_method: 'Cash',
        attachment_key: 'chat-pop/c-other-conv/abcdef1234567890abcdef1234567890.pdf',
      },
    });
    const res = mockRes();
    await chatPopController.sharePop(req, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      error: 'attachment_key was not issued for this conversation',
      code: 'attachment_key_not_issued_here',
    });
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test('rejects path-traversal style keys', async () => {
    const req = mockReq({
      user: USER,
      body: {
        conversationId: 'conv-1',
        amount_cents: 1000,
        attachment_key: 'chat-pop/c-conv-1/../../etc/passwd',
      },
    });
    const res = mockRes();
    await chatPopController.sharePop(req, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'attachment_key_not_issued_here' })
    );
  });

  test('accepts a key minted under this conversation scope', async () => {
    const scopedKey = 'chat-pop/c-conv-1/abcdef1234567890abcdef1234567890.pdf';
    mockQuery
      .mockResolvedValueOnce({ rows: [{ ...popRow, attachment_key: scopedKey }] }) // pop insert
      .mockResolvedValueOnce({ rows: [messageRow] }) // chat message insert
      .mockResolvedValueOnce({ rows: [] }) // conversation touch
      .mockResolvedValueOnce({ rows: [] }); // message_id update

    const req = mockReq({
      user: USER,
      body: { conversationId: 'conv-1', amount_cents: 1000, attachment_key: scopedKey },
    });
    const res = mockRes();
    await chatPopController.sharePop(req, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(201);
    const insertCall = mockQuery.mock.calls[0];
    expect(insertCall[1][13]).toBe(scopedKey);
  });

  test('uploaded file bytes win and are minted under the scoped folder', async () => {
    const mintedKey = 'chat-pop/c-conv-1/0123456789abcdef0123456789abcdef.pdf';
    storage.uploadFile.mockResolvedValue(mintedKey);
    mockQuery
      .mockResolvedValueOnce({ rows: [{ ...popRow, attachment_key: mintedKey }] })
      .mockResolvedValueOnce({ rows: [messageRow] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const req = mockReq({
      user: USER,
      body: { conversationId: 'conv-1', amount_cents: 1000 },
      file: { buffer: Buffer.from('fake-bytes'), originalname: 'receipt.pdf', mimetype: 'image/jpeg', size: 10 },
    });
    const res = mockRes();
    await chatPopController.sharePop(req, res, jest.fn());

    expect(storage.uploadFile).toHaveBeenCalledWith(
      expect.any(Buffer),
      'chat-pop/c-conv-1',
      'receipt.pdf',
      'image/jpeg'
    );
    expect(res.status).toHaveBeenCalledWith(201);
    expect(mockQuery.mock.calls[0][1][13]).toBe(mintedKey);
  });

  test('guest sessions get their own g- scope', async () => {
    const scopedKey = 'chat-pop/g-guest-9/abcdef1234567890abcdef1234567890.pdf';
    chatThreadAccess.resolveGuestFromRequest.mockResolvedValue({
      id: 'guest-9',
      guest_name: 'Guest',
      helper_id: 'helper-1',
      business_id: null,
    });
    mockQuery
      .mockResolvedValueOnce({ rows: [{ ...popRow, conversation_id: null, guest_session_id: 'guest-9', attachment_key: scopedKey }] })
      .mockResolvedValueOnce({ rows: [{ id: 'gmsg-1', session_id: 'guest-9' }] }) // guest message insert
      .mockResolvedValueOnce({ rows: [] }); // message_id update

    const req = mockReq({
      body: { guestSessionId: 'guest-9', amount_cents: 500, attachment_key: scopedKey },
    });
    const res = mockRes();
    await chatPopController.sharePop(req, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(201);
    expect(mockQuery.mock.calls[0][1][13]).toBe(scopedKey);

    // ...but a conversation-scoped key is rejected on the guest scope
    resetMocks();
    const badReq = mockReq({
      body: { guestSessionId: 'guest-9', amount_cents: 500, attachment_key: 'chat-pop/c-conv-1/x.pdf' },
    });
    const badRes = mockRes();
    await chatPopController.sharePop(badReq, badRes, jest.fn());
    expect(badRes.status).toHaveBeenCalledWith(400);
    expect(badRes.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'attachment_key_not_issued_here' })
    );
  });
});

describe('M15 - chat agreement attachment_key scoping', () => {
  const agreementRow = {
    id: 'agr-1',
    title: 'Scope of work',
    body_text: 'terms',
    version: 1,
    token: 'tok-1',
    status: 'shared',
    required_before_schedule: false,
    conversation_id: 'conv-1',
    guest_session_id: null,
    business_id: null,
    helper_id: 'helper-1',
    attachment_key: null,
  };
  const messageRow = { id: 'msg-2', conversation_id: 'conv-1', content: 'x' };

  test('shareAgreement rejects a caller-supplied key from another scope', async () => {
    const req = mockReq({
      user: USER,
      body: {
        conversationId: 'conv-1',
        title: 'Scope of work',
        body_text: 'terms',
        attachment_key: 'chat-agreements/c-other-conv/x.pdf',
      },
    });
    const res = mockRes();
    await chatAgreementsController.shareAgreement(req, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      error: 'attachment_key was not issued for this conversation',
      code: 'attachment_key_not_issued_here',
    });
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test('shareAgreement mints uploads under the scoped folder and accepts scoped keys', async () => {
    const scopedKey = 'chat-agreements/c-conv-1/abcdef1234567890abcdef1234567890.pdf';
    mockQuery
      .mockResolvedValueOnce({ rows: [{ ...agreementRow, attachment_key: scopedKey }] }) // agreement insert
      .mockResolvedValueOnce({ rows: [messageRow] }) // chat message insert
      .mockResolvedValueOnce({ rows: [] }) // conversation touch
      .mockResolvedValueOnce({ rows: [] }); // message_id update

    const req = mockReq({
      user: USER,
      body: { conversationId: 'conv-1', title: 'Scope of work', attachment_key: scopedKey },
    });
    const res = mockRes();
    await chatAgreementsController.shareAgreement(req, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(201);
    // attachment_key is the 9th value ($9) in the shareAgreement INSERT
    expect(mockQuery.mock.calls[0][1][8]).toBe(scopedKey);
  });

  test('shareAgreement uploads land in the scoped folder', async () => {
    const mintedKey = 'chat-agreements/c-conv-1/0123456789abcdef0123456789abcdef.pdf';
    storage.uploadFile.mockResolvedValue(mintedKey);
    mockQuery
      .mockResolvedValueOnce({ rows: [{ ...agreementRow, attachment_key: mintedKey }] })
      .mockResolvedValueOnce({ rows: [messageRow] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const req = mockReq({
      user: USER,
      body: { conversationId: 'conv-1', title: 'Scope of work', body_text: 'terms' },
      file: { buffer: Buffer.from('fake-bytes'), originalname: 'terms.pdf', mimetype: 'application/pdf', size: 10 },
    });
    const res = mockRes();
    await chatAgreementsController.shareAgreement(req, res, jest.fn());

    expect(storage.uploadFile).toHaveBeenCalledWith(
      expect.any(Buffer),
      'chat-agreements/c-conv-1',
      'terms.pdf',
      'application/pdf'
    );
    expect(res.status).toHaveBeenCalledWith(201);
  });

  test('reviseAgreement (second upload site) scopes uploads and rejects foreign keys', async () => {
    const parent = { ...agreementRow, attachment_key: 'chat-agreements/old-unscoped.pdf' };

    // Upload path: minted under the parent conversation scope
    const mintedKey = 'chat-agreements/c-conv-1/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.pdf';
    storage.uploadFile.mockResolvedValue(mintedKey);
    mockQuery
      .mockResolvedValueOnce({ rows: [parent] }) // loadAgreement
      .mockResolvedValueOnce({ rows: [] }) // supersede parent
      .mockResolvedValueOnce({ rows: [{ ...agreementRow, id: 'agr-2', version: 2, attachment_key: mintedKey }] })
      .mockResolvedValueOnce({ rows: [messageRow] }) // reshare message
      .mockResolvedValueOnce({ rows: [] }) // conversation touch
      .mockResolvedValueOnce({ rows: [] }); // message_id update

    const req = mockReq({
      user: USER,
      body: { title: 'Scope of work v2', body_text: 'new terms' },
      file: { buffer: Buffer.from('fake-bytes'), originalname: 'v2.pdf', mimetype: 'application/pdf', size: 10 },
      params: { id: 'agr-1' },
    });
    const res = mockRes();
    await chatAgreementsController.reviseAgreement(req, res, jest.fn());

    expect(storage.uploadFile).toHaveBeenCalledWith(
      expect.any(Buffer),
      'chat-agreements/c-conv-1',
      'v2.pdf',
      'application/pdf'
    );
    expect(res.status).toHaveBeenCalledWith(201);

    // Caller-supplied foreign key on revise is rejected; the parent key is untouched
    resetMocks();
    mockQuery.mockResolvedValueOnce({ rows: [parent] }); // loadAgreement
    const badReq = mockReq({
      user: USER,
      body: { title: 'Scope of work v2', attachment_key: 'chat-agreements/c-evil/x.pdf' },
      params: { id: 'agr-1' },
    });
    const badRes = mockRes();
    await chatAgreementsController.reviseAgreement(badReq, badRes, jest.fn());
    expect(badRes.status).toHaveBeenCalledWith(400);
    expect(badRes.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'attachment_key_not_issued_here' })
    );
  });
});
