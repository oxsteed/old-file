'use strict';
const { mockQuery, resetMocks } = require('./setup');
const c = require('../controllers/directController');
beforeEach(() => resetMocks());

describe('customer schedule window checks (P1-180)', () => {
  const req = { id: 5, assigned_to: '00000000-0000-4000-8000-000000000001' };
  const s = '2026-11-01T14:00:00Z';
  const e = '2026-11-01T15:00:00Z';
  test('rejects end before start', async () => {
    expect((await c._checkDirectScheduleWindow(req, e, s)).status).toBe(400);
  });
  test('rejects blackout blocks', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 1 }] });
    expect((await c._checkDirectScheduleWindow(req, s, e)).body.code).toBe('calendar_blocked');
  });
  test('rejects crew overlap', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{ id: 9 }] });
    expect((await c._checkDirectScheduleWindow(req, s, e)).body.code).toBe('schedule_conflict');
  });
  test('allows a free window', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [] });
    expect(await c._checkDirectScheduleWindow(req, s, e)).toBeNull();
  });
});
