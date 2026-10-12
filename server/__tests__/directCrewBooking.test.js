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
