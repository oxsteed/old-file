'use strict';
const { mockQuery, resetMocks } = require('./setup');
const mockSendNotification = jest.fn(async () => ({ success: true }));
jest.mock('../services/notificationService', () => ({
  sendNotification: (...args) => mockSendNotification(...args),
}));
const { sweepNoShows } = require('../jobs/businessAppointmentNoShowSweeper');

beforeEach(() => { resetMocks(); mockSendNotification.mockClear(); });

describe('sweepNoShows (P3-8-F03)', () => {
  test('marks stale confirmed appointments no_show and notifies participants', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'appt-1', business_id: 7, no_show_marked_at: new Date().toISOString() }] }) // phase 1 set-based update
      .mockResolvedValueOnce({ rows: [{ id: 'appt-1', customer_id: 'cust-1', business_owner_id: 'owner-1' }] }) // batched notify lookup
      .mockResolvedValueOnce({ rows: [] }) // phase 2 select
      .mockResolvedValueOnce({ rows: [] }); // phase 3 select
    const result = await sweepNoShows();
    expect(result).toMatchObject({ marked: 1, autoCancelled: 0, expiredPending: 0 });
    const updateCall = mockQuery.mock.calls[0];
    expect(updateCall[0]).toMatch(/SET status = 'no_show', no_show_marked_at = NOW\(\)/);
    expect(updateCall[0]).toMatch(/FOR UPDATE OF ba SKIP LOCKED/);
    expect(updateCall[0]).toMatch(/LIMIT 200/);
    expect(updateCall[1]).toEqual([2]);
    const lookupCall = mockQuery.mock.calls[1];
    expect(lookupCall[0]).toMatch(/ba\.id = ANY\(\$1::bigint\[\]\)/);
    const notified = mockSendNotification.mock.calls.map(([arg]) => arg.userId).sort();
    expect(notified).toEqual(['cust-1', 'owner-1']);
    expect(mockSendNotification.mock.calls[0][0].type).toBe('appointment_no_show');
  });

  test('phase 1 marks many rows with one update and one recipient lookup (cost audit 2026-11-13 item 15)', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [
        { id: 'appt-1', business_id: 7, no_show_marked_at: new Date().toISOString() },
        { id: 'appt-2', business_id: 8, no_show_marked_at: new Date().toISOString() },
      ] }) // phase 1 set-based update
      .mockResolvedValueOnce({ rows: [
        { id: 'appt-1', customer_id: 'cust-1', business_owner_id: 'owner-1' },
        { id: 'appt-2', customer_id: 'cust-2', business_owner_id: 'owner-2' },
      ] }) // batched notify lookup
      .mockResolvedValueOnce({ rows: [] }) // phase 2 select
      .mockResolvedValueOnce({ rows: [] }); // phase 3 select
    const result = await sweepNoShows();
    expect(result).toMatchObject({ marked: 2, autoCancelled: 0, expiredPending: 0 });
    const updates = mockQuery.mock.calls.filter(([sql]) => /UPDATE business_appointments/.test(sql) && /no_show/.test(sql));
    expect(updates).toHaveLength(1);
    const lookups = mockQuery.mock.calls.filter(([sql]) => /business_owner_id/.test(sql));
    expect(lookups).toHaveLength(1);
    const notified = mockSendNotification.mock.calls.map(([arg]) => `${arg.data.appointment_id}:${arg.userId}`).sort();
    expect(notified).toEqual(['appt-1:cust-1', 'appt-1:owner-1', 'appt-2:cust-2', 'appt-2:owner-2']);
  });

  test('phase 1 only touches confirmed rows (pending is phase 3)', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    await sweepNoShows();
    const phase1 = mockQuery.mock.calls[0][0];
    expect(phase1).toMatch(/ba\.status = 'confirmed'/);
    const phase3 = mockQuery.mock.calls[2][0];
    expect(phase3).toMatch(/ba\.status = 'pending'/);
    expect(phase3).toMatch(/ba\.payment_status <> 'paid'/);
  });

  test('phase 2 auto-cancels aged no-shows only when the business opted in', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] }) // phase 1
      .mockResolvedValueOnce({ rows: [{ id: 'appt-2' }] }) // phase 2 select
      .mockResolvedValueOnce({ rowCount: 1 }) // phase 2 update
      .mockResolvedValueOnce({ rows: [] }); // phase 3
    const result = await sweepNoShows();
    expect(result).toMatchObject({ marked: 0, autoCancelled: 1, expiredPending: 0 });
    const phase2Select = mockQuery.mock.calls[1][0];
    expect(phase2Select).toMatch(/COALESCE\(r\.auto_cancel_no_show_hours, 0\) > 0/);
    const phase2Update = mockQuery.mock.calls[2];
    expect(phase2Update[0]).toMatch(/cancelled_by = 'system'/);
    expect(phase2Update[0]).toMatch(/cancellation_fee_cents = 0/);
    expect(phase2Update[1]).toEqual(['appt-2']);
  });

  test('phase 3 expires unpaid stale pendings but never paid ones', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] }) // phase 1
      .mockResolvedValueOnce({ rows: [] }) // phase 2
      .mockResolvedValueOnce({ rows: [{ id: 'appt-3' }] }) // phase 3 select
      .mockResolvedValueOnce({ rowCount: 1 }); // phase 3 update
    const result = await sweepNoShows();
    expect(result).toMatchObject({ expiredPending: 1 });
    const phase3Update = mockQuery.mock.calls[3];
    expect(phase3Update[0]).toMatch(/AND payment_status <> 'paid'/);
    expect(phase3Update[0]).toMatch(/cancellation_fee_cents = 0/);
  });
});
