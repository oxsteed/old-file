'use strict';

const { mockQuery, resetMocks } = require('./setup');
const controller = require('../controllers/calendarNotificationController');

function response() {
  return { json: jest.fn(), status: jest.fn().mockReturnThis() };
}

beforeEach(() => resetMocks());

test('lists failed calendar notifications for operators', async () => {
  const res = response();
  mockQuery.mockResolvedValueOnce({ rows: [{ id: 9, status: 'failed', attempts: 3 }] });

  await controller.getFailedNotifications({}, res, jest.fn());

  expect(res.json).toHaveBeenCalledWith([{ id: 9, status: 'failed', attempts: 3 }]);
  expect(mockQuery.mock.calls[0][0]).toContain("WHERE cn.status = 'failed'");
});

test('requeues one failed calendar notification with a fresh retry budget', async () => {
  const res = response();
  mockQuery.mockResolvedValueOnce({ rows: [{ id: 9, status: 'pending', attempts: 0 }] });

  await controller.retryFailedNotification({ params: { id: '9' } }, res, jest.fn());

  expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining("SET status = 'pending'"), ['9']);
  expect(res.json).toHaveBeenCalledWith({ id: 9, status: 'pending', attempts: 0 });
});

test('scheduler query includes retryable failed rows', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [] });

  await controller.processReminderNotifications();

  expect(mockQuery.mock.calls[0][0]).toContain("cn.status IN ('pending', 'failed')");
  expect(mockQuery.mock.calls[0][0]).toContain('cn.attempts < 5');
});
