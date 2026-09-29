'use strict';

const { mockQuery, resetMocks } = require('./setup');
const { computeServiceSlots, expireHolds, createHold } = require('../services/directSlotEngine');
const db = require('../db');

beforeEach(() => resetMocks());

describe('directSlotEngine', () => {
  test('returns empty slots when assignee pool is empty', async () => {
    const now = new Date();
    const later = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    mockQuery
      .mockResolvedValueOnce({
        rows: [{
          id: 'svc-1',
          slug: 'wiring',
          name_i18n: { en: 'Wiring' },
          booking_slot_minutes: 120,
          required_crew_size: 1,
          lifecycle_status: 'live',
          is_operationally_available: true,
          is_bookable: true,
          category_id: 'cat-1',
          category_slug: 'electrical',
          category_lifecycle_status: 'live',
          category_is_active: true,
          category_name_i18n: { en: 'Electrical' },
        }],
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const result = await computeServiceSlots({
      serviceId: 'svc-1',
      from: now.toISOString(),
      to: later.toISOString(),
    });

    expect(result.assigneePoolSize).toBe(0);
    expect(result.slots).toEqual([]);
    expect(result.reason).toBe('bookable_without_pool');
  });

  test('omits overlapping busy assignee capacity (one electrician)', async () => {
    const start = new Date();
    start.setUTCMinutes(0, 0, 0);
    start.setUTCHours(start.getUTCHours() + 2);
    const endWindow = new Date(start.getTime() + 4 * 60 * 60 * 1000);
    const slotEnd = new Date(start.getTime() + 2 * 60 * 60 * 1000);

    mockQuery
      .mockResolvedValueOnce({
        rows: [{
          id: 'svc-1',
          slug: 'wiring',
          name_i18n: { en: 'Wiring' },
          booking_slot_minutes: 120,
          required_crew_size: 1,
          lifecycle_status: 'live',
          is_operationally_available: true,
          is_bookable: true,
          category_id: 'cat-1',
          category_slug: 'electrical',
          category_lifecycle_status: 'live',
          category_is_active: true,
          category_name_i18n: { en: 'Electrical' },
        }],
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ user_id: '00000000-0000-4000-8000-000000000001' }] })
      .mockResolvedValueOnce({
        rows: [{
          id: '00000000-0000-4000-8000-000000000001',
          first_name: 'Eli',
          last_name: 'Electric',
          email: 'eli@ox.test',
          role: 'helper',
        }],
      })
      .mockResolvedValueOnce({
        rows: [{
          id: 1,
          block_type: 'availability',
          title: 'Open',
          starts_at: start.toISOString(),
          ends_at: endWindow.toISOString(),
        }],
      })
      .mockResolvedValueOnce({
        rows: [{
          id: 9,
          assigned_to: '00000000-0000-4000-8000-000000000001',
          scheduled_start_at: start.toISOString(),
          scheduled_end_at: slotEnd.toISOString(),
          status: 'scheduled',
        }],
      })
      .mockResolvedValueOnce({ rows: [] });

    const result = await computeServiceSlots({
      serviceId: 'svc-1',
      from: start.toISOString(),
      to: endWindow.toISOString(),
      maxSlots: 10,
    });

    expect(result.assigneePoolSize).toBe(1);
    const busyStarts = result.slots.filter((s) => s.start === start.toISOString());
    expect(busyStarts).toHaveLength(0);
    expect(result.slots.every((s) => s.freeAssigneeCount >= 1)).toBe(true);
  });


  test('expireHolds deletes expired rows in a bounded batch and returns count', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'hold-1' }, { id: 'hold-2' }],
      rowCount: 2,
    });

    const result = await expireHolds(db, { limit: 50 });
    expect(result).toEqual({ count: 2, ids: ['hold-1', 'hold-2'] });
    expect(mockQuery).toHaveBeenCalledTimes(1);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/DELETE FROM direct_slot_holds/i);
    expect(sql).toMatch(/expires_at <= CURRENT_TIMESTAMP/i);
    expect(sql).toMatch(/LIMIT \$1/i);
    expect(params).toEqual([50]);
  });

  test('createHold re-checks capacity after advisory lock (race)', async () => {
    const start = new Date();
    start.setUTCMinutes(0, 0, 0);
    start.setUTCHours(start.getUTCHours() + 3);
    const end = new Date(start.getTime() + 2 * 60 * 60 * 1000);
    const userId = '00000000-0000-4000-8000-000000000001';

    // createHold uses pool.connect() → same mockQuery sequence:
    // BEGIN, expireHolds DELETE, loadServiceRow, loadAssignee roles, assignees,
    // resolveEligibleAssignees, loadCalendarBlocks, loadBusy jobs, holds,
    // (slot match found), loadAssignee again, resolve again, busy again,
    // advisory lock, busyAfter → occupied → 409
    mockQuery
      .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // BEGIN
      .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // expireHolds
      .mockResolvedValueOnce({
        rows: [{
          id: 'svc-1',
          slug: 'wiring',
          name_i18n: { en: 'Wiring' },
          booking_slot_minutes: 120,
          required_crew_size: 1,
          lifecycle_status: 'live',
          is_operationally_available: true,
          is_bookable: true,
          category_id: 'cat-1',
          category_slug: 'electrical',
          category_lifecycle_status: 'live',
          category_is_active: true,
          category_name_i18n: { en: 'Electrical' },
        }],
      })
      .mockResolvedValueOnce({ rows: [] }) // roles
      .mockResolvedValueOnce({ rows: [{ user_id: userId }] }) // assignees
      .mockResolvedValueOnce({
        rows: [{ id: userId, first_name: 'Eli', last_name: 'Electric', email: 'eli@ox.test', role: 'helper' }],
      })
      .mockResolvedValueOnce({
        rows: [{
          id: 1,
          block_type: 'availability',
          title: 'Open',
          starts_at: start.toISOString(),
          ends_at: end.toISOString(),
        }],
      })
      .mockResolvedValueOnce({ rows: [] }) // busy jobs (slot scan)
      .mockResolvedValueOnce({ rows: [] }) // busy holds (slot scan)
      // second pass inside createHold after slot match
      .mockResolvedValueOnce({ rows: [] }) // roles
      .mockResolvedValueOnce({ rows: [{ user_id: userId }] })
      .mockResolvedValueOnce({
        rows: [{ id: userId, first_name: 'Eli', last_name: 'Electric', email: 'eli@ox.test', role: 'helper' }],
      })
      .mockResolvedValueOnce({ rows: [] }) // busy jobs before lock
      .mockResolvedValueOnce({ rows: [] }) // busy holds before lock
      .mockResolvedValueOnce({ rows: [{ pg_advisory_xact_lock: 1 }] }) // lock
      .mockResolvedValueOnce({ rows: [] }) // busyAfter jobs
      .mockResolvedValueOnce({
        rows: [{
          id: 'other-hold',
          reserved_user_id: userId,
          starts_at: start.toISOString(),
          ends_at: end.toISOString(),
        }],
      }) // busyAfter holds — race lost
      .mockResolvedValueOnce({ rows: [], rowCount: 0 }); // ROLLBACK

    await expect(createHold({
      serviceId: 'svc-1',
      startsAt: start.toISOString(),
      endsAt: end.toISOString(),
    })).rejects.toMatchObject({
      statusCode: 409,
      code: 'capacity_exhausted',
    });
  });

});
