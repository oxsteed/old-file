'use strict';

const { mockQuery, resetMocks } = require('./setup');
// Cross-surface busy/buffers have their own tests; keep this suite's query
// sequence focused on the Direct tables.
jest.mock('../services/crossSurfaceBusy', () => ({
  loadCrossSurfaceBusy: jest.fn(async () => []),
  loadBookingBuffers: jest.fn(async () => new Map()),
}));
const { computeServiceSlots, expireHolds, createHold, resolveEligibleAssignees, filterBookingAllowed, loadMemberTemplates, freeMembersForSlot } = require('../services/directSlotEngine');
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
      .mockResolvedValueOnce({ rows: [] }) // filterBookingAllowed: nobody opted out
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
      .mockResolvedValueOnce({ rows: [] }) // busy holds
      .mockResolvedValueOnce({ rows: [] }) // member templates: none configured
      .mockResolvedValueOnce({ rows: [] }) // template overrides
      .mockResolvedValueOnce({ rows: [] }); // member timezones

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
    // resolveEligibleAssignees, filterBookingAllowed, loadCalendarBlocks,
    // loadBusy jobs, holds, member templates (slot match found), loadAssignee
    // again, resolve again, filterBookingAllowed, busy again, member templates,
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
      .mockResolvedValueOnce({ rows: [] }) // filterBookingAllowed: nobody opted out
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
      .mockResolvedValueOnce({ rows: [] }) // member templates (slot scan)
      .mockResolvedValueOnce({ rows: [] }) // template overrides (slot scan)
      .mockResolvedValueOnce({ rows: [] }) // member timezones (slot scan)
      // Bookable gate: second loadServiceRow
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
      // second pass inside createHold after slot match
      .mockResolvedValueOnce({ rows: [] }) // roles
      .mockResolvedValueOnce({ rows: [{ user_id: userId }] })
      .mockResolvedValueOnce({
        rows: [{ id: userId, first_name: 'Eli', last_name: 'Electric', email: 'eli@ox.test', role: 'helper' }],
      })
      .mockResolvedValueOnce({ rows: [] }) // filterBookingAllowed: nobody opted out
      .mockResolvedValueOnce({ rows: [] }) // busy jobs before lock
      .mockResolvedValueOnce({ rows: [] }) // busy holds before lock
      .mockResolvedValueOnce({ rows: [] }) // member templates before lock
      .mockResolvedValueOnce({ rows: [] }) // template overrides before lock
      .mockResolvedValueOnce({ rows: [] }) // member timezones before lock
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

  // ITEM 18: role expansion must be bounded by the service's real roster
  // (direct_service_assignees) — never a platform-wide LIMIT 500 pull.
  test('resolveEligibleAssignees bounds role expansion to the roster (no LIMIT 500)', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{
        id: '00000000-0000-4000-8000-000000000001',
        first_name: 'Rita',
        last_name: 'Roster',
        email: 'rita@ox.test',
        role: 'helper',
      }],
    });

    const members = await resolveEligibleAssignees(
      'svc-1',
      { roles: ['helper'], userIds: ['00000000-0000-4000-8000-000000000001'] },
      db
    );

    expect(members).toHaveLength(1);
    expect(members[0].id).toBe('00000000-0000-4000-8000-000000000001');
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/direct_service_assignees/);
    expect(sql).not.toMatch(/LIMIT 500/);
    expect(params[0]).toBe('svc-1');
  });

  test('resolveEligibleAssignees returns an empty pool when the roster is empty', async () => {
    // Roles configured but nobody on the roster: must NOT expand to all
    // platform users with that role. The users query would return rows only
    // for roster members; an empty roster means zero rows.
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const members = await resolveEligibleAssignees('svc-1', { roles: ['helper'], userIds: [] }, db);

    expect(members).toEqual([]);
    const [sql] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/direct_service_assignees/);
  });

  // Review P1-6-F03: helpers who switched booking off never enter dispatch.
  test('filterBookingAllowed drops opted-out helpers, keeps everyone else', async () => {
    const optedOut = '00000000-0000-4000-8000-0000000000a1';
    const noRow = '00000000-0000-4000-8000-0000000000a2';
    const allowed = '00000000-0000-4000-8000-0000000000a3';
    mockQuery.mockResolvedValueOnce({ rows: [{ user_id: optedOut }] });
    const members = [
      { id: optedOut, name: 'Off' },
      { id: noRow, name: 'NoRow' },
      { id: allowed, name: 'On' },
    ];
    const kept = await filterBookingAllowed(members, db);
    expect(kept.map((m) => m.id).sort()).toEqual([allowed, noRow].sort());
    const [sql] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/helper_profiles/);
    expect(sql).toMatch(/allow_booking/);
  });

  test('filterBookingAllowed is a no-op when nobody opted out', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const members = [{ id: '00000000-0000-4000-8000-0000000000a1', name: 'A' }];
    const kept = await filterBookingAllowed(members, db);
    expect(kept).toHaveLength(1);
  });

  // Review P1-5-F03: crew availability templates bound dispatch.
  describe('member availability templates', () => {
    // Monday 2030-01-07 (UTC); member works Mon 09:00-17:00 in UTC.
    const MEMBER = '00000000-0000-4000-8000-0000000000b1';
    const OTHER = '00000000-0000-4000-8000-0000000000b2';
    const mondayAt = (h, m = 0) => new Date(Date.UTC(2030, 0, 7, h, m, 0));
    const sundayAt = (h) => new Date(Date.UTC(2030, 0, 6, h, 0, 0));

    function templateMap(overrides) {
      return new Map([[
        MEMBER,
        {
          byDay: new Map([[1, [{ start: 540, end: 1020 }]]]),
          overrides: overrides || new Map(),
          timeZone: 'UTC',
        },
      ]]);
    }

    const busy = { jobs: [], holds: [] };
    const members = [
      { id: MEMBER, name: 'Templated' },
      { id: OTHER, name: 'NoTemplate' },
    ];

    test('member with a template is only free inside it', () => {
      const templates = templateMap();
      const freeIn = freeMembersForSlot(members, busy, mondayAt(10), mondayAt(12), templates);
      expect(freeIn.map((m) => m.id).sort()).toEqual([MEMBER, OTHER].sort());
      const freeOut = freeMembersForSlot(members, busy, mondayAt(18), mondayAt(19), templates);
      expect(freeOut.map((m) => m.id)).toEqual([OTHER]);
      const freeSunday = freeMembersForSlot(members, busy, sundayAt(10), sundayAt(12), templates);
      expect(freeSunday.map((m) => m.id)).toEqual([OTHER]);
    });

    test('whole-day blocked override removes the member', () => {
      const templates = templateMap(new Map([['2030-01-07', [{ isBlocked: true, start: null, end: null }]]]));
      const free = freeMembersForSlot(members, busy, mondayAt(10), mondayAt(12), templates);
      expect(free.map((m) => m.id)).toEqual([OTHER]);
    });

    test('opening override adds availability outside the template', () => {
      const templates = templateMap(new Map([['2030-01-06', [{ isBlocked: false, start: 600, end: 720 }]]]));
      const free = freeMembersForSlot(members, busy, sundayAt(10), sundayAt(12), templates);
      expect(free.map((m) => m.id).sort()).toEqual([MEMBER, OTHER].sort());
    });

    test('no templates map means no filtering (back-compat)', () => {
      const free = freeMembersForSlot(members, busy, sundayAt(10), sundayAt(12));
      expect(free.map((m) => m.id).sort()).toEqual([MEMBER, OTHER].sort());
    });

    test('loadMemberTemplates builds the per-member template map', async () => {
      mockQuery.mockImplementation(async (sql) => {
        if (/FROM helper_availability_overrides/.test(sql)) return { rows: [] };
        if (/FROM helper_availability/.test(sql)) {
          return { rows: [{ user_id: MEMBER, day_of_week: 1, start_min: 540, end_min: 1020 }] };
        }
        if (/FROM users/.test(sql)) return { rows: [{ user_id: MEMBER, timezone: 'UTC' }] };
        return { rows: [] };
      });
      const map = await loadMemberTemplates([MEMBER, OTHER], mondayAt(0), mondayAt(23), db);
      expect(map.has(MEMBER)).toBe(true);
      expect(map.has(OTHER)).toBe(false);
      const entry = map.get(MEMBER);
      expect(entry.byDay.get(1)).toEqual([{ start: 540, end: 1020 }]);
      expect(entry.timeZone).toBe('UTC');
    });
  });

});
