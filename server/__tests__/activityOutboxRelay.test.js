'use strict';
// Cost audit 2026-11-04 item 14: the activity outbox relay must build
// gate contexts once per batch (not once per row) and decide per row in
// memory, while preserving per-row trusted-signals semantics.
const { mockQuery, resetMocks } = require('./setup');

const mockConn = {
  query: jest.fn(async (sql) => {
    if (sql.includes('FROM activity_outbox ORDER BY')) return { rows: mockClaimRows };
    if (sql.includes('DELETE FROM activity_outbox')) return { rowCount: 1 };
    return { rows: [] };
  }),
};
let mockClaimRows = [];

jest.mock('../jobs/jobLockingService', () => ({
  withFencedJobLock: jest.fn((name, fn) => fn({
    assertActive: jest.fn(),
    fencedTransaction: (tx) => tx(mockConn),
  })),
}));
jest.mock('../growth/gate', () => ({
  contexts: jest.fn(async (ids, { trustedSignals }) => new Map(ids.map((id) => [id, {
    user: { preferred_language: 'en' },
    trustedSignals: trustedSignals instanceof Map ? trustedSignals.get(id) : trustedSignals,
    consents: {},
  }]))),
  allow: jest.fn(async (ctx) => ({ allowed: true, context: ctx })),
}));
jest.mock('../growth/queue', () => ({
  enqueue: jest.fn().mockResolvedValue(undefined),
}));

const gate = require('../growth/gate');
const queue = require('../growth/queue');
const { run } = require('../jobs/activityOutboxRelay');

const prevHardOff = process.env.GROWTH_TRACKING_HARD_OFF;
beforeEach(() => {
  resetMocks();
  jest.clearAllMocks();
  process.env.GROWTH_TRACKING_HARD_OFF = 'false';
  mockQuery.mockResolvedValueOnce({ rows: [{ one: 1 }] });
});
afterAll(() => {
  if (prevHardOff === undefined) delete process.env.GROWTH_TRACKING_HARD_OFF;
  else process.env.GROWTH_TRACKING_HARD_OFF = prevHardOff;
});

function row(id, userId, signals) {
  return {
    id, user_id: userId, trusted_signals: signals, event_id: `ev-${id}`,
    event_name: 'job.posted', occurred_at: new Date('2026-11-04T10:00:00Z'), props: {},
  };
}

test('one batched contexts call covers rows sharing signals, allow per row', async () => {
  mockClaimRows = [row(1, 'user-a', ['s1']), row(2, 'user-a', ['s1']), row(3, 'user-b', ['s1'])];
  expect(await run()).toBe(3);
  expect(gate.contexts).toHaveBeenCalledTimes(1);
  expect(gate.contexts).toHaveBeenCalledWith(['user-a', 'user-b'], expect.objectContaining({ db: mockConn }));
  const signals = gate.contexts.mock.calls[0][1].trustedSignals;
  expect(signals).toBeInstanceOf(Map);
  expect(signals.get('user-a')).toEqual(['s1']);
  expect(gate.allow).toHaveBeenCalledTimes(3);
  expect(queue.enqueue).toHaveBeenCalledTimes(3);
  expect(mockConn.query).toHaveBeenCalledTimes(4);
});

test('a user with divergent signals gets one contexts call per signal set', async () => {
  mockClaimRows = [row(1, 'user-a', ['s1']), row(2, 'user-a', ['s2'])];
  expect(await run()).toBe(2);
  expect(gate.contexts).toHaveBeenCalledTimes(2);
  expect(gate.contexts).toHaveBeenNthCalledWith(1, ['user-a'], expect.objectContaining({ db: mockConn }));
  expect(gate.contexts).toHaveBeenNthCalledWith(2, ['user-a'], expect.objectContaining({ db: mockConn }));
  expect(gate.contexts.mock.calls[0][1].trustedSignals.get('user-a')).toEqual(['s1']);
  expect(gate.contexts.mock.calls[1][1].trustedSignals.get('user-a')).toEqual(['s2']);
  expect(gate.allow).toHaveBeenCalledTimes(2);
  expect(queue.enqueue).toHaveBeenCalledTimes(2);
});
