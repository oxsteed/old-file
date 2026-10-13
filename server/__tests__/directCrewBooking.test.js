'use strict';
require('./setup');
const { pickCrew } = require('../services/directSlotEngine');

describe('Direct crew selection (P1-174/175)', () => {
  const members = [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'c', name: 'C' }];
  test('picks the required crew size, least loaded first (jobs and holds both count)', () => {
    const busy = { jobs: [{ userId: 'a' }], holds: [{ userId: 'b' }, { userId: 'b' }] };
    expect(pickCrew(members, busy, 2).map((m) => m.id)).toEqual(['c', 'a']);
  });
  test('returns fewer than required when the pool is short (caller rejects)', () => {
    expect(pickCrew(members.slice(0, 1), { jobs: [], holds: [] }, 2)).toHaveLength(1);
  });
});

describe('Direct sees helper time off and buffers (P1-194)', () => {
  const { mockQuery, resetMocks } = require('./setup');
  const { loadBusyIntervals } = require('../services/directSlotEngine');
  beforeEach(() => resetMocks());
  test('personal blocks count as busy and Direct jobs are padded by the buffer', async () => {
    const u = '00000000-0000-4000-8000-0000000000bb';
    const t = (h) => new Date(Date.UTC(2030, 0, 7, h)).toISOString();
    mockQuery.mockImplementation(async (sql) => {
      if (/FROM direct_slot_holds/.test(sql)) return { rows: [] };
      if (/FROM helper_profiles/.test(sql)) return { rows: [{ user_id: u, buffer: 30 }] };
      if (/FROM appointments/.test(sql)) return { rows: [{ user_id: u, starts_at: t(14), ends_at: t(15), source: 'helper_block' }] };
      if (/FROM quote_requests/.test(sql)) return { rows: [{ assigned_to: u, scheduled_start_at: t(10), scheduled_end_at: t(11) }] };
      return { rows: [] };
    });
    const busy = await loadBusyIntervals([u], new Date(t(8)), new Date(t(18)));
    const direct = busy.jobs.find((j) => j.source === 'direct');
    expect(direct.startsAt.toISOString()).toBe(new Date(Date.UTC(2030, 0, 7, 9, 30)).toISOString());
    expect(busy.jobs.some((j) => j.source === 'helper_block' && j.startsAt.toISOString() === t(14))).toBe(true);
  });
});
