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

test('public availability rejects inactive, unverified, or non-consultant users before slot generation', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [] });
  const res = mockRes();
  await controller.getAvailableSlots(
    { params: { consultantId: 'consultant-9' }, query: { date: '2026-11-20' } },
    res,
  );

  expect(res.status).toHaveBeenCalledWith(404);
  expect(res.json).toHaveBeenCalledWith({ error: 'Consultant not found' });
  expect(mockQuery.mock.calls[0][0]).toMatch(/default_mode = 'consultant'/);
  expect(mockQuery.mock.calls[0][0]).toMatch(/email_verified = TRUE/);
  expect(mockQuery.mock.calls[0][0]).toMatch(/onboarding_completed = TRUE/);
  expect(mockQuery.mock.calls).toHaveLength(1);
});

test('public availability still filters booked slots after the consultant gate', async () => {
  mockQuery
    .mockResolvedValueOnce({ rows: [{ id: 'consultant-9' }] })
    .mockResolvedValueOnce({ rows: [{ slot_start: '09:00', slot_end: '10:00', is_available: true }] })
    .mockResolvedValueOnce({ rows: [] });
  const res = mockRes();
  await controller.getAvailableSlots(
    { params: { consultantId: 'consultant-9' }, query: { date: '2026-11-20' } },
    res,
  );

  expect(res.json).toHaveBeenCalledWith([
    { slot_start: '09:00', slot_end: '10:00', is_available: true },
  ]);
  expect(mockQuery.mock.calls).toHaveLength(3);
});

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
