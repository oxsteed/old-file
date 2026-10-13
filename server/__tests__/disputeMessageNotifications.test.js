'use strict';
jest.unmock('../utils/transaction');
const { mockQuery, resetMocks } = require('./setup');
jest.mock('../services/notificationService', () => ({ sendNotification: jest.fn().mockResolvedValue({ success: true }) }));
jest.mock('../services/socketService', () => ({ broadcastToUser: jest.fn() }));
const { sendNotification } = require('../services/notificationService');
const { broadcastToUser } = require('../services/socketService');
const { sendDisputeMessage } = require('../controllers/disputeController');
const KEY = '00000000-0000-4000-8000-000000000001';
function route({ replay = false, fail = false } = {}) {
  mockQuery.mockImplementation(async (sql) => {
    if (/SELECT d\.\*/.test(sql)) return { rows: [{ id: 7, opened_by: 'customer', against_user: 'helper', client_id: 'customer', assigned_helper_id: 'helper' }] };
    if (/INSERT INTO dispute_messages/.test(sql)) {
      if (fail) throw new Error('synthetic insertion failure');
      return { rows: replay ? [] : [{ id: 42 }] };
    }
    if (/SELECT \* FROM dispute_messages/.test(sql)) return { rows: [{ id: 42 }] };
    return { rows: [] };
  });
}
async function send(id = 'customer', role = 'customer') {
  const req = { user: { id, role }, params: { disputeId: 7 }, body: { message: 'Private evidence text' }, get: () => KEY };
  const res = { status: jest.fn().mockReturnThis(), json: jest.fn() }; const next = jest.fn();
  await sendDisputeMessage(req, res, next);
  return { res, next };
}
beforeEach(() => { resetMocks(); jest.clearAllMocks(); });
test.each([['customer', 'customer', ['helper']], ['helper', 'helper', ['customer']], ['admin', 'admin', ['customer', 'helper']]])(
  '%s message notifies each other party once after commit', async (id, role, recipients) => {
    route();
    const committedAtDelivery = [];
    sendNotification.mockImplementation(async () => {
      committedAtDelivery.push(mockQuery.mock.calls.some(([sql]) => sql === 'COMMIT'));
      return { success: true };
    });
    const { next } = await send(id, role);
    expect(next).not.toHaveBeenCalled();
    expect(committedAtDelivery).toEqual(recipients.map(() => true));
    expect(sendNotification.mock.calls.map(([n]) => n.userId).sort()).toEqual(recipients);
    for (const [n] of sendNotification.mock.calls) {
      expect(n).toEqual({ userId: n.userId, type: 'dispute_update', data: { dispute_id: '7', message_id: '42' },
        action_url: '/disputes/7', idempotencyKey: `dispute:7:message:42:${n.userId}` });
      expect(JSON.stringify(n)).not.toContain('Private evidence text');
    }
  });
test('message retry reuses the delivery key so missed delivery can recover without a duplicate', async () => {
  route(); await send(); const first = sendNotification.mock.calls[0][0];
  sendNotification.mockClear(); route({ replay: true });
  const { res, next } = await send();
  expect(next).not.toHaveBeenCalled(); expect(res.status).toHaveBeenCalledWith(200);
  expect(sendNotification).toHaveBeenCalledWith(first);
});
test('failed insertion and unauthorized callers send no notification', async () => {
  route({ fail: true }); expect((await send()).next).toHaveBeenCalled();
  expect(sendNotification).not.toHaveBeenCalled();
  route(); expect((await send('stranger')).next).toHaveBeenCalledWith(expect.objectContaining({ code: 'forbidden' }));
  expect(sendNotification).not.toHaveBeenCalled();
});
test.each([['customer', 'customer', ['customer', 'helper']], ['helper', 'helper', ['customer', 'helper']], ['admin', 'admin', ['admin', 'customer', 'helper']]])(
  'emits dispute:message to each party room plus the sender (%s)', async (id, role, expectedRecipients) => {
    route();
    const { next } = await send(id, role);
    expect(next).not.toHaveBeenCalled();
    // The DisputeDetail page listens for 'dispute:message' with { disputeId, message }.
    expect(broadcastToUser.mock.calls.map(([userId, event]) => [userId, event]).sort())
      .toEqual(expectedRecipients.sort().map((userId) => [userId, 'dispute:message']));
    for (const [, , payload] of broadcastToUser.mock.calls) {
      expect(payload).toEqual({
        disputeId: '7',
        message: expect.objectContaining({ id: 42, sender_name: null }),
      });
    }
  });
test('failed insertion emits no realtime event', async () => {
  route({ fail: true });
  expect((await send()).next).toHaveBeenCalled();
  expect(broadcastToUser).not.toHaveBeenCalled();
});
