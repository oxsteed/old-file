'use strict';

const { mockQuery, resetMocks } = require('./setup');
const controller = require('../controllers/slaMetricsController');

const USER_ID = '00000000-0000-4000-8000-000000000994';

function response() {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
  };
}

function requestFor(role = 'support_agent') {
  return {
    params: { businessId: '42', conversationId: 'conversation-7' },
    query: { days: '9999', hours: '9999' },
    user: { id: USER_ID, role },
  };
}

beforeEach(() => resetMocks());

describe('SLA metrics business boundaries', () => {
  test('blocks an unrelated support agent from reading SLA data', async () => {
    const req = requestFor();
    const res = response();

    await controller.getSLADashboard(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(mockQuery.mock.calls.some(([sql]) => /FROM support_conversations/.test(sql))).toBe(false);
  });

  test('bounds reporting windows for authorized reads', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ total_conversations: '1' }] });
    const req = requestFor('super_admin');
    const res = response();

    await controller.getSLADashboard(req, res);

    expect(res.json).toHaveBeenCalledWith({ success: true, data: { total_conversations: '1' } });
    expect(mockQuery.mock.calls[0][1]).toEqual(['42', 365]);
  });

  test('does not update a conversation outside the requested business', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const req = requestFor('super_admin');
    const res = response();

    await controller.updateSLAStatus(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(mockQuery.mock.calls.some(([sql]) => /UPDATE support_conversations/.test(sql))).toBe(false);
  });
});
