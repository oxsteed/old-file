'use strict';
const { mockQuery, resetMocks } = require('./setup');
const c = require('../controllers/directController');
beforeEach(() => resetMocks());

describe('customer schedule window checks (P1-180, P1-4-F02/F08 full crew)', () => {
  const req = { id: 5, assigned_to: '00000000-0000-4000-8000-000000000001' };
  const s = '2026-11-01T14:00:00Z';
  const e = '2026-11-01T15:00:00Z';
  // Query order inside checkDirectScheduleWindow: calendar blocks, crew
  // junction, overlap.
  test('rejects end before start', async () => {
    expect((await c._checkDirectScheduleWindow(req, e, s)).status).toBe(400);
  });
  test('rejects blackout blocks', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 1 }] });
    expect((await c._checkDirectScheduleWindow(req, s, e)).body.code).toBe('calendar_blocked');
  });
  test('rejects lead overlap', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] }) // blocks
      .mockResolvedValueOnce({ rows: [] }) // crew junction
      .mockResolvedValueOnce({ rows: [{ id: 9 }] }); // overlap
    expect((await c._checkDirectScheduleWindow(req, s, e)).body.code).toBe('schedule_conflict');
    const overlapCall = mockQuery.mock.calls[2];
    expect(overlapCall[1][3]).toEqual(['00000000-0000-4000-8000-000000000001']);
  });
  test('rejects overlap for crew member 2..N, not just the lead', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] }) // blocks
      .mockResolvedValueOnce({ rows: [{ user_id: '00000000-0000-4000-8000-000000000002' }] }) // crew junction
      .mockResolvedValueOnce({ rows: [{ id: 11 }] }); // overlap
    expect((await c._checkDirectScheduleWindow(req, s, e)).body.code).toBe('schedule_conflict');
    const overlapCall = mockQuery.mock.calls[2];
    expect(overlapCall[1][3].sort()).toEqual([
      '00000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000002',
    ]);
  });
  test('allows a free window', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    expect(await c._checkDirectScheduleWindow(req, s, e)).toBeNull();
  });
});
