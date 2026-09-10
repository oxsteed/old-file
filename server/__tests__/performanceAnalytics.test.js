'use strict';

const { mockQuery, resetMocks } = require('./setup');
const controller = require('../controllers/performanceAnalyticsController');

const USER_ID = '00000000-0000-4000-8000-000000000995';

function response() {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
  };
}

function requestFor(role = 'support_agent') {
  return {
    params: { businessId: '42', agentId: 'agent-7' },
    query: { days: '9999' },
    user: { id: USER_ID, role },
  };
}

beforeEach(() => resetMocks());

describe('performance analytics business boundaries', () => {
  test('blocks an unrelated support agent from reading a leaderboard', async () => {
    const req = requestFor();
    const res = response();

    await controller.getAgentLeaderboard(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(mockQuery.mock.calls.some(([sql]) => /agent_daily_performance/.test(sql))).toBe(false);
  });

  test('bounds business metric windows for authorized reads', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ total_created: '2' }] })
      .mockResolvedValueOnce({ rows: [{ metric_date: '2026-09-10' }] });
    const req = requestFor('super_admin');
    const res = response();

    await controller.getBusinessMetrics(req, res);

    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: {
        summary: { total_created: '2' },
        trends: [{ metric_date: '2026-09-10' }],
      },
    });
    expect(mockQuery.mock.calls[0][1]).toEqual(['42', 365]);
    expect(mockQuery.mock.calls[1][1]).toEqual(['42', 365]);
  });

  test('does not expose an agent from another business', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const req = requestFor('super_admin');
    const res = response();

    await controller.getAgentMetrics(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(mockQuery.mock.calls.some(([sql]) => /FROM agent_daily_performance/.test(sql))).toBe(false);
  });
});
