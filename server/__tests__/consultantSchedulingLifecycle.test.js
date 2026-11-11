'use strict';

const { mockQuery, resetMocks } = require('./setup');
const controller = require('../controllers/consultantSchedulingController');

function mockRes() {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
}

beforeEach(() => resetMocks());

test('rejects scheduling against an inactive or soft-deleted consultant', async () => {
  mockQuery
    .mockResolvedValueOnce({ rows: [{ id: 7, user_id: 'customer-1', consultant_assigned_id: null }] })
    .mockResolvedValueOnce({ rows: [] });

  const res = mockRes();
  await controller.createScheduledSession({
    user: { id: 'customer-1', role: 'customer' },
    body: { consultingSessionId: 7, consultantId: 'consultant-9' },
  }, res);

  expect(res.status).toHaveBeenCalledWith(404);
  expect(res.json).toHaveBeenCalledWith({ error: 'Consultant not found' });
  expect(mockQuery.mock.calls[1][0]).toMatch(/is_active = TRUE/);
  expect(mockQuery.mock.calls[1][0]).toMatch(/deleted_at IS NULL/);
  expect(mockQuery.mock.calls.some(([sql]) => /INSERT INTO consulting_sessions_scheduled/.test(sql))).toBe(false);
});
