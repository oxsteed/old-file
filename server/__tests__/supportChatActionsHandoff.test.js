'use strict';

// Support chat improvements PR B: handoff context (3), confirm-card in-chat
// actions (4) and server memory in the panel (10).

const express = require('express');
const request = require('supertest');
const { mockQuery, resetMocks } = require('./setup');

jest.mock('../services/scopeModel', () => ({ resolveBusinessAccess: jest.fn().mockResolvedValue(null) }));
jest.mock('../services/supportNotificationService', () => ({ scheduleSupportMessageNotifications: jest.fn() }));
jest.mock('../controllers/customer360Controller', () => ({ notifyWatchers: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../services/socketService', () => ({
  broadcastToAdmins: jest.fn(),
  broadcastToUser: jest.fn(),
  broadcastGuestChatMessage: jest.fn(),
}));
jest.mock('../utils/storage', () => ({
  uploadFile: jest.fn().mockResolvedValue('support-tickets/shot.png'),
  getSignedDownloadUrl: jest.fn().mockResolvedValue('https://files.example/signed'),
  deleteFile: jest.fn(),
}));
jest.mock('../services/supportChatThreads', () => ({
  getSupportThread: jest.fn().mockResolvedValue([]),
  appendSupportThread: jest.fn(),
  clearSupportThread: jest.fn(),
}));

const actions = require('../services/supportChatActions');
const snap = require('../services/supportAccountSnapshot');
const chatController = require('../controllers/chatController');
const supportController = require('../controllers/supportController');
const supportChatThreads = require('../services/supportChatThreads');
const storage = require('../utils/storage');
const { buildSupportPrompt, ACTION_RULES } = require('../services/assistantGuide');
const { errorHandler } = require('../middleware/errorHandler');

const USER = '00000000-0000-4000-8000-0000000000e1';
const ACTION_ID = '22222222-2222-4222-8222-222222222222';

beforeEach(() => {
  resetMocks();
  jest.clearAllMocks();
  snap._resetSnapshotCacheForTests();
  supportChatThreads.getSupportThread.mockResolvedValue([]);
});

function appWith(userId, mount) {
  const app = express();
  app.use(express.json({ limit: '4mb' }));
  app.use((req, _res, next) => { if (userId) req.user = { id: userId, role: 'customer' }; next(); });
  mount(app);
  app.use(errorHandler);
  return app;
}

describe('item 4: action proposals', () => {
  test('marker is stripped and a valid proposal is normalised', () => {
    const out = actions.extractActionProposal('I can reopen it for you.\n[[action:{"type":"reopen_ticket","ticket_id":"tk-9"}]]');
    expect(out.reply).toBe('I can reopen it for you.');
    expect(out.proposal).toEqual({ type: 'reopen_ticket', params: { ticket_id: 'tk-9' } });
  });

  test('unknown, money-moving or malformed proposals are dropped but still stripped', () => {
    for (const raw of [
      '[[action:{"type":"refund_order","order_id":"1"}]]',
      '[[action:{"type":"approve_credit","id":"1"}]]',
      '[[action:{"type":"navigate","target":"wallet_transfer","id":"1"}]]',
      '[[action:{"type":"reopen_ticket","ticket_id":"../../etc"}]]',
      '[[action:{not json}]]',
    ]) {
      const out = actions.extractActionProposal(`Text ${raw}`);
      expect(out.proposal).toBeNull();
      expect(out.reply).toBe('Text');
    }
    expect(actions.ACTION_TYPES.join(' ')).not.toMatch(/refund|payout|credit|transfer|pay/);
  });

  test('only the first proposal survives; reply text is capped', () => {
    const out = actions.extractActionProposal(`a [[action:{"type":"open_cookie_preferences"}]] b [[action:{"type":"open_ticket"}]]`);
    expect(out.proposal.type).toBe('open_cookie_preferences');
    expect(out.reply).toBe('a  b');
    const long = actions.extractActionProposal(`[[action:{"type":"reply_ticket","ticket_id":"t1","message":"${'x'.repeat(700)}"}]]`);
    expect(long.proposal.params.message).toHaveLength(700);
  });

  test('cancel_booking_request: own pending unpaid only, never with a deposit', async () => {
    const q = jest.fn();
    q.mockResolvedValueOnce({ rows: [{ id: 'b1', status: 'pending', payment_status: null }] });
    expect((await actions.checkAction(USER, 'cancel_booking_request', { booking_id: 'b1' }, q)).ok).toBe(true);
    expect(q.mock.calls[0][0]).toMatch(/customer_id = \$2/);
    for (const ps of ['paid', 'processing', 'requires_payment']) {
      q.mockResolvedValueOnce({ rows: [{ id: 'b1', status: 'pending', payment_status: ps }] });
      expect(await actions.checkAction(USER, 'cancel_booking_request', { booking_id: 'b1' }, q)).toEqual({ ok: false, reason: 'has_deposit' });
    }
    q.mockResolvedValueOnce({ rows: [{ id: 'b1', status: 'accepted', payment_status: null }] });
    expect((await actions.checkAction(USER, 'cancel_booking_request', { booking_id: 'b1' }, q)).reason).toBe('not_pending');
    q.mockResolvedValueOnce({ rows: [] });
    expect((await actions.checkAction(USER, 'cancel_booking_request', { booking_id: 'b1' }, q)).reason).toBe('not_found');
  });

  test('ticket and navigate checks are scoped to the caller', async () => {
    const q = jest.fn();
    q.mockResolvedValueOnce({ rows: [{ id: 't1', ticket_number: 77, status: 'open' }] });
    expect((await actions.checkAction(USER, 'reopen_ticket', { ticket_id: 't1' }, q)).reason).toBe('not_closed');
    q.mockResolvedValueOnce({ rows: [{ id: 't1', ticket_number: 77, status: 'closed' }] });
    expect(await actions.checkAction(USER, 'reopen_ticket', { ticket_id: 't1' }, q)).toEqual({ ok: true, display: { ticketNumber: 77 } });
    q.mockResolvedValueOnce({ rows: [{ id: 't1', ticket_number: 77, status: 'resolved' }] });
    expect((await actions.checkAction(USER, 'reply_ticket', { ticket_id: 't1', message: 'hi' }, q)).reason).toBe('ticket_closed');
    expect(q.mock.calls[0][1]).toEqual(['t1', USER]);

    q.mockResolvedValueOnce({ rows: [{ id: 501 }] });
    expect(await actions.checkAction(USER, 'navigate', { target: 'order', id: '501' }, q)).toEqual({ ok: true, display: { path: '/orders/501' } });
    expect(q.mock.calls[3][0]).toMatch(/customer_id = \$2/);
    q.mockResolvedValueOnce({ rows: [] });
    expect((await actions.checkAction(USER, 'navigate', { target: 'dispute', id: '9' }, q)).reason).toBe('not_found');

    q.mockResolvedValueOnce({ rows: [{ email_verified: true }] });
    expect((await actions.checkAction(USER, 'resend_verification_email', {}, q)).reason).toBe('already_verified');
  });

  test('execution plans call existing endpoints only', () => {
    const plan = (action_type, params) => actions.executionPlan({ id: ACTION_ID, action_type, params });
    expect(plan('reopen_ticket', { ticket_id: 't1' })).toEqual({ kind: 'api', method: 'post', url: '/support/my-tickets/t1/reopen', body: {} });
    expect(plan('reply_ticket', { ticket_id: 't1', message: 'hi' })).toEqual({ kind: 'api', method: 'post', url: '/support/my-tickets/t1/reply', body: { content: 'hi', clientMessageId: ACTION_ID } });
    expect(plan('resend_verification_email', {}).url).toBe('/auth/resend-verification');
    expect(plan('cancel_booking_request', { booking_id: 'b1' }).url).toBe('/bookings/b1/cancel');
    expect(plan('open_cookie_preferences', {})).toEqual({ kind: 'client', name: 'open_cookie_preferences' });
    expect(plan('open_ticket', {})).toEqual({ kind: 'handoff' });
  });

  test('prompt lists the actions only for signed-in snapshot turns, without contradiction', () => {
    const p = buildSupportPrompt({ hasSnapshot: true, actions: true });
    expect(p).toContain(ACTION_RULES);
    expect(p).not.toMatch(/You still cannot change/);
    expect(p).toMatch(/Apart from proposing the confirm-card actions/);
    expect(p).toMatch(/Never propose or imply any action that moves money/);
    expect(buildSupportPrompt({ hasSnapshot: true })).not.toContain('In-chat Actions');
    expect(buildSupportPrompt({ hasSnapshot: false, actions: true })).not.toContain('In-chat Actions');
  });
});

describe('item 4: chat turn returns a stored proposal', () => {
  function snapshotAndActionRows(sql) {
    if (/SELECT first_name, email_verified FROM users/.test(sql)) return { rows: [{ first_name: 'Ana', email_verified: true }] };
    if (/FROM support_tickets WHERE id = \$1 AND user_id = \$2/.test(sql)) return { rows: [{ id: 'tk-9', ticket_number: 1042, status: 'closed' }] };
    if (/INSERT INTO support_chat_actions/.test(sql)) return { rows: [{ id: ACTION_ID, action_type: 'reopen_ticket', params: { ticket_id: 'tk-9' }, status: 'proposed' }] };
    if (/FROM support_tickets/.test(sql)) return { rows: [{ id: 'tk-9', status: 'closed', n: 1 }] };
    return { rows: [] };
  }

  test('signed-in: reply stripped, proposal validated + stored, card payload returned', async () => {
    mockQuery.mockImplementation(async (sql) => snapshotAndActionRows(sql));
    process.env.OPENROUTER_API_KEY = 'k';
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ choices: [{ message: { content: 'I can reopen it.\n[[action:{"type":"reopen_ticket","ticket_id":"tk-9"}]]' } }] }) });
    const req = { user: { id: USER, role: 'customer' }, body: { messages: [{ role: 'user', content: 'reopen my ticket' }], pageContext: { path: '/support' } } };
    const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await chatController.chatMessage(req, res, jest.fn());
    const body = res.json.mock.calls[0][0];
    expect(body.reply).toBe('I can reopen it.');
    expect(body.proposed_action).toEqual({ id: ACTION_ID, type: 'reopen_ticket', params: { ticket_id: 'tk-9' }, display: { ticketNumber: 1042 }, status: 'proposed' });
    const insert = mockQuery.mock.calls.find(([sql]) => /INSERT INTO support_chat_actions/.test(sql));
    expect(insert[1]).toEqual([USER, 'reopen_ticket', JSON.stringify({ ticket_id: 'tk-9' }), '/support']);
    const system = JSON.parse(global.fetch.mock.calls[0][1].body).messages[0].content;
    expect(system).toMatch(/In-chat Actions/);
    expect(supportChatThreads.appendSupportThread).toHaveBeenCalledWith(USER, 'reopen my ticket', 'I can reopen it.');
    delete global.fetch;
  });

  test('guests never get a proposal and never see the action rules', async () => {
    mockQuery.mockImplementation(async () => ({ rows: [] }));
    process.env.OPENROUTER_API_KEY = 'k';
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ choices: [{ message: { content: 'Sure [[action:{"type":"open_cookie_preferences"}]]' } }] }) });
    const req = { body: { messages: [{ role: 'user', content: 'cookies' }] } };
    const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await chatController.chatMessage(req, res, jest.fn());
    const body = res.json.mock.calls[0][0];
    expect(body.reply).toBe('Sure');
    expect(body.proposed_action).toBeUndefined();
    expect(JSON.parse(global.fetch.mock.calls[0][1].body).messages[0].content).not.toMatch(/In-chat Actions/);
    delete global.fetch;
  });
});

describe('item 4: confirm / result / dismiss endpoints', () => {
  const app = () => appWith(USER, (a) => {
    a.post('/actions/:actionId/confirm', chatController.confirmSupportAction);
    a.post('/actions/:actionId/result', chatController.recordSupportActionResult);
    a.post('/actions/:actionId/dismiss', chatController.dismissSupportAction);
  });
  const row = (over = {}) => ({ id: ACTION_ID, user_id: USER, action_type: 'cancel_booking_request', params: { booking_id: 'b1' }, status: 'proposed', expires_at: new Date(Date.now() + 60000), ...over });

  test('confirm re-checks state server-side and returns the existing endpoint', async () => {
    mockQuery.mockImplementation(async (sql) => {
      if (/FROM support_chat_actions WHERE id::text = \$1 AND user_id = \$2/.test(sql)) return { rows: [row()] };
      if (/FROM booking_requests/.test(sql)) return { rows: [{ id: 'b1', status: 'pending', payment_status: null }] };
      if (/SET status = 'confirmed'/.test(sql)) return { rows: [row({ status: 'confirmed' })] };
      return { rows: [] };
    });
    const res = await request(app()).post(`/actions/${ACTION_ID}/confirm`);
    expect(res.status).toBe(200);
    expect(res.body.plan).toEqual({ kind: 'api', method: 'post', url: '/bookings/b1/cancel', body: {} });
    const lookup = mockQuery.mock.calls.find(([sql]) => /FROM support_chat_actions/.test(sql));
    expect(lookup[1]).toEqual([ACTION_ID, USER]);
  });

  test('confirm rejects when the booking gained a deposit since the proposal', async () => {
    mockQuery.mockImplementation(async (sql) => {
      if (/FROM support_chat_actions WHERE/.test(sql)) return { rows: [row()] };
      if (/FROM booking_requests/.test(sql)) return { rows: [{ id: 'b1', status: 'pending', payment_status: 'paid' }] };
      return { rows: [] };
    });
    const res = await request(app()).post(`/actions/${ACTION_ID}/confirm`);
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ code: 'action_not_allowed', reason: 'has_deposit' });
    const reject = mockQuery.mock.calls.find(([sql]) => /SET status = 'rejected'/.test(sql));
    expect(reject[1]).toEqual([ACTION_ID, 'has_deposit']);
  });

  test("someone else's, handled or expired proposals cannot be confirmed", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    expect((await request(app()).post(`/actions/${ACTION_ID}/confirm`)).status).toBe(404);
    mockQuery.mockResolvedValueOnce({ rows: [row({ status: 'succeeded' })] });
    expect((await request(app()).post(`/actions/${ACTION_ID}/confirm`)).status).toBe(409);
    mockQuery.mockResolvedValueOnce({ rows: [row({ expires_at: new Date(Date.now() - 1000) })] }).mockResolvedValueOnce({ rows: [] });
    expect((await request(app()).post(`/actions/${ACTION_ID}/confirm`)).status).toBe(410);
    expect((await request(app()).post('/actions/not%20an%20id/confirm')).status).toBe(404);
  });

  test('result is logged once for a confirmed action and drops the cached snapshot', async () => {
    const spy = jest.spyOn(snap, 'invalidateSupportSnapshot');
    mockQuery.mockResolvedValueOnce({ rows: [row({ status: 'confirmed' })] }).mockResolvedValueOnce({ rows: [] });
    const res = await request(app()).post(`/actions/${ACTION_ID}/result`).send({ ok: true, status_code: 200 });
    expect(res.status).toBe(200);
    const update = mockQuery.mock.calls[1];
    expect(update[0]).toMatch(/SET status = \$2, result_code = \$3/);
    expect(update[1]).toEqual([ACTION_ID, 'succeeded', 200]);
    mockQuery.mockResolvedValueOnce({ rows: [row({ status: 'proposed' })] });
    expect((await request(app()).post(`/actions/${ACTION_ID}/result`).send({ ok: true })).status).toBe(409);
    spy.mockRestore();
  });

  test('dismiss marks the proposal dismissed', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [row()] }).mockResolvedValueOnce({ rows: [] });
    expect((await request(app()).post(`/actions/${ACTION_ID}/dismiss`)).status).toBe(200);
    expect(mockQuery.mock.calls[1][0]).toMatch(/SET status = 'dismissed'/);
  });

  test('routes are authenticated and the confirm step rejects impersonation', () => {
    const src = require('fs').readFileSync(require('path').join(__dirname, '../routes/chat.js'), 'utf8');
    expect(src).toMatch(/router\.post\('\/actions\/:actionId\/confirm', chatLimiter, authenticate, rejectImpersonated, confirmSupportAction\)/);
    expect(src).toMatch(/router\.post\('\/actions\/:actionId\/result', chatLimiter, authenticate,/);
    expect(src).toMatch(/router\.get\('\/support-thread', chatLimiter, authenticate, getSupportThread\)/);
  });
});

describe('item 10: saved server conversation', () => {
  test('GET returns the signed-in user\'s turns, no-store', async () => {
    supportChatThreads.getSupportThread.mockResolvedValue([
      { role: 'user', content: 'Where is my payout?', ts: '2026-10-19T12:00:00Z' },
      { role: 'assistant', content: 'See /wallet.', ts: '2026-10-19T12:00:01Z' },
    ]);
    const res = await request(appWith(USER, (a) => a.get('/support-thread', chatController.getSupportThread))).get('/support-thread');
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body.messages).toHaveLength(2);
    expect(supportChatThreads.getSupportThread).toHaveBeenCalledWith(USER);
  });

  test('guests get 401', async () => {
    const res = await request(appWith(null, (a) => a.get('/support-thread', chatController.getSupportThread))).get('/support-thread');
    expect(res.status).toBe(401);
  });
});

describe('item 3: handoff carries page, account summary and screenshot', () => {
  const PNG = `data:image/png;base64,${Buffer.from('fake-png').toString('base64')}`;
  function handoffRows() {
    mockQuery.mockImplementation(async (sql, params) => {
      if (/SELECT first_name, last_name, email FROM users/.test(sql)) return { rows: [{ first_name: 'Ana', last_name: 'Ruiz', email: 'ana@example.com' }] };
      if (/INSERT INTO support_tickets/.test(sql)) return { rows: [{ id: 't-1', ticket_number: 'OX-7', subject: params[3], priority: 'high', name: params[1], created_at: 'now' }] };
      if (/INSERT INTO support_messages/.test(sql)) return { rows: [{ id: 'm-1' }] };
      if (/main_app_payout_requests/.test(sql)) return { rows: [{ amount_cents: 4000, currency_code: 'USD', payout_method: 'bank', status: 'failed', requested_at: '2026-10-18', processed_at: null }] };
      return { rows: [] };
    });
  }
  const app = () => appWith(USER, (a) => a.post('/chat-escalation', supportController.createChatEscalation));
  const base = { subject: 'Chat escalation from /wallet', transcript: [{ role: 'user', content: 'payout?' }], page: '/wallet', clientRequestId: '33333333-3333-4333-8333-333333333333' };

  test('summary in metadata + staff-only note; screenshot uploaded and linked', async () => {
    handoffRows();
    const res = await request(app()).post('/chat-escalation').send({ ...base, image: PNG });
    expect(res.status).toBe(201);
    const ticketInsert = mockQuery.mock.calls.find(([sql]) => /INSERT INTO support_tickets/.test(sql));
    const meta = JSON.parse(ticketInsert[1][5]);
    expect(meta.page).toBe('/wallet');
    expect(meta.snapshot_summary).toMatch(/payout/i);
    const note = mockQuery.mock.calls.find(([sql]) => /INSERT INTO support_messages/.test(sql) && /true, false\)/.test(sql));
    expect(note[1][1]).toMatch(/Page: \/wallet/);
    expect(note[1][1]).toMatch(/screenshot/);
    expect(storage.uploadFile).toHaveBeenCalledWith(expect.any(Buffer), 'support-tickets', 'chat-screenshot.png', 'image/png');
    const link = mockQuery.mock.calls.find(([sql]) => /jsonb_build_object\('image_key'/.test(sql));
    expect(link[1]).toEqual(['t-1', 'support-tickets/shot.png', 'image/png']);
  });

  test('invalid or oversized images are ignored, not stored', async () => {
    handoffRows();
    const huge = `data:image/png;base64,${'A'.repeat(3 * 1024 * 1024)}`;
    for (const image of ['data:text/html;base64,PGI+', huge, 'not-a-data-url']) {
      storage.uploadFile.mockClear();
      const res = await request(app()).post('/chat-escalation').send({ ...base, image, clientRequestId: undefined });
      expect(res.status).toBe(201);
      expect(storage.uploadFile).not.toHaveBeenCalled();
    }
  });

  test('admin ticket view gets a signed screenshot link', async () => {
    mockQuery.mockImplementation(async (sql) => {
      if (/FROM support_tickets t/.test(sql)) return { rows: [{ id: 't-1', user_id: USER, metadata: { image_key: 'support-tickets/shot.png', page: '/wallet' } }] };
      return { rows: [] };
    });
    const adminApp = express();
    adminApp.use((req, _res, next) => { req.user = { id: 'adm', role: 'super_admin' }; req.isSuper = true; next(); });
    adminApp.get('/t/:ticketId', supportController.getTicketAdmin);
    const res = await request(adminApp).get('/t/t-1');
    expect(res.status).toBe(200);
    expect(res.body.handoff_image_url).toBe('https://files.example/signed');
    expect(storage.getSignedDownloadUrl).toHaveBeenCalledWith('support-tickets/shot.png', 3600);
  });

  test('the handoff route accepts the 2 MB image body (route-scoped parser)', () => {
    const { CHAT_IMAGE_ROUTES } = require('../middleware/chatMessageBodyParser');
    expect(CHAT_IMAGE_ROUTES).toEqual(['/api/chat/message', '/api/support/chat-escalation']);
  });
});
