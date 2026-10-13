'use strict';

// P2-8-F06/F07: quiet_hours_enabled must be settable via
// PUT /calendar/notification-preferences (it was only ever read, never
// written), and the endpoint must accept the quiet-hours fields.

const { mockQuery, resetMocks } = require('./setup');
const ctrl = require('../controllers/availabilityController');

function mockReq(body) {
  return { user: { id: 'user-1' }, body };
}
function mockRes() {
  const res = {};
  res.json = jest.fn(() => res);
  res.status = jest.fn(() => res);
  return res;
}

beforeEach(() => {
  resetMocks();
  jest.clearAllMocks();
});

function queuePutResult(row) {
  mockQuery
    .mockResolvedValueOnce({ rows: [] })       // INSERT ... ON CONFLICT DO NOTHING
    .mockResolvedValueOnce({ rows: [row] });  // UPDATE ... RETURNING *
}

function updateCall() {
  const calls = mockQuery.mock.calls.filter((c) => /UPDATE notification_preferences/i.test(c[0]));
  expect(calls.length).toBe(1);
  return { text: calls[0][0], params: calls[0][1] };
}

describe('PUT /calendar/notification-preferences quiet hours', () => {
  test('accepts and persists quiet_hours_enabled=true', async () => {
    const res = mockRes();
    queuePutResult({ user_id: 'user-1', quiet_hours_enabled: true });
    await ctrl.updateNotificationPreferences(
      mockReq({ quiet_hours_enabled: true, quiet_hours_start: '22:00', quiet_hours_end: '07:00' }),
      res,
      (e) => { throw e; }
    );
    const { text, params } = updateCall();
    expect(text).toMatch(/quiet_hours_enabled/);
    expect(params).toContain(true);
    expect(params).toContain('22:00');
    expect(params).toContain('07:00');
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ quiet_hours_enabled: true }));
  });

  test('rejects non-boolean quiet_hours_enabled with 400', async () => {
    const res = mockRes();
    const next = jest.fn();
    await ctrl.updateNotificationPreferences(
      mockReq({ quiet_hours_enabled: 'yes' }),
      res,
      next
    );
    expect(next).toHaveBeenCalledTimes(1);
    const err = next.mock.calls[0][0];
    expect(err.statusCode).toBe(400);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test('omitted quiet_hours_enabled leaves the column untouched', async () => {
    const res = mockRes();
    queuePutResult({ user_id: 'user-1', quiet_hours_enabled: false });
    await ctrl.updateNotificationPreferences(
      mockReq({ quiet_hours_start: '23:00', quiet_hours_end: '06:00' }),
      res,
      (e) => { throw e; }
    );
    const { params } = updateCall();
    // COALESCE(NULL, quiet_hours_enabled) keeps the stored value.
    const idx = params.findIndex((p) => p === undefined);
    expect(idx).toBe(-1);
    expect(params).toContain(null);
  });
});
