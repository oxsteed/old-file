'use strict';

const { mockQuery, resetMocks } = require('./setup');
const controller = require('../controllers/queueController');

const USER_ID = '00000000-0000-4000-8000-000000000997';

function response() {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
  };
}

function requestFor(role = 'support_agent') {
  return {
    params: { businessId: '42', conversationId: 'conversation-7' },
    query: { hours: '9999' },
    body: {},
    user: { id: USER_ID, role },
  };
}

beforeEach(() => resetMocks());

describe('support queue business boundaries', () => {
  test('blocks an unrelated support agent from queue status', async () => {
    const req = requestFor();
    const res = response();

    await controller.getQueueStatus(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(mockQuery.mock.calls.some(([sql]) => /FROM support_queue/.test(sql))).toBe(false);
  });

  test('bounds queue analytics windows for platform admins', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ total_conversations_routed: '4' }] });
    const req = requestFor('super_admin');
    const res = response();

    await controller.getQueueAnalytics(req, res);

    expect(res.json).toHaveBeenCalledWith({ success: true, data: { total_conversations_routed: '4' } });
    expect(mockQuery.mock.calls[0][1]).toEqual(['42', 168]);
  });

  test('keeps queue removal reason bounded', async () => {
    const req = requestFor('super_admin');
    req.body.reason = 'x'.repeat(501);
    const res = response();

    await controller.removeFromQueue(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockQuery.mock.calls.some(([sql]) => /UPDATE support_queue/.test(sql))).toBe(false);
  });
});
