'use strict';
// Cost audit 2026-11-13 item 11: the growth writer and the policy-notice
// delivery worker must wake on a Postgres NOTIFY channel (with the
// interval kept as a slow safety sweep), and queue.enqueue must emit the
// writer's wakeup when it accepts stream entries.
const { resetMocks } = require('./setup');

const mockEval = jest.fn(async () => '1-0');
jest.mock('ioredis', () =>
  jest.fn().mockImplementation(() => ({
    on: jest.fn(),
    status: 'ready',
    connect: jest.fn(),
    eval: mockEval,
  })),
);
const mockDbQuery = jest.fn(async () => ({ rows: [] }));
jest.mock('../db', () => ({ query: mockDbQuery }));

const prevEnv = {
  off: process.env.GROWTH_TRACKING_HARD_OFF,
  notice: process.env.GROWTH_POLICY_NOTICE_DELIVERY_ENABLED,
  redis: process.env.GROWTH_REDIS_URL,
  pepper: process.env.GROWTH_SUBJECT_PEPPER,
};

beforeEach(() => {
  resetMocks();
  jest.clearAllMocks();
  mockEval.mockResolvedValue('1-0');
  process.env.GROWTH_REDIS_URL = 'redis://127.0.0.1:6379';
  process.env.GROWTH_SUBJECT_PEPPER = 'p'.repeat(32);
});

afterEach(() => {
  for (const [k, v] of Object.entries(prevEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe('growth worker schedule notify channels', () => {
  test('writer and policy notice wake on NOTIFY with a 60s safety sweep', () => {
    process.env.GROWTH_TRACKING_HARD_OFF = 'false';
    process.env.GROWTH_POLICY_NOTICE_DELIVERY_ENABLED = 'true';
    const { entries } = require('../growth/workerSchedule');
    const byName = new Map(entries().map(([name, fn, interval, options]) => [name, { fn, interval, options }]));
    expect(byName.get('growthActivityWriter')).toMatchObject({
      interval: 60 * 1000,
      options: { notifyChannel: 'oxsteed_activity_ingest' },
    });
    expect(byName.get('growthPolicyNotice')).toMatchObject({
      interval: 60 * 1000,
      options: { notifyChannel: 'oxsteed_policy_notice' },
    });
    // The relay's channel (Nov 4 item 7) is unchanged.
    expect(byName.get('growthActivityRelay')).toMatchObject({
      options: { notifyChannel: 'oxsteed_activity_outbox' },
    });
  });
});

describe('queue.enqueue writer wakeup', () => {
  test('an accepted enqueue notifies the writer channel once', async () => {
    const queue = require('../growth/queue');
    const result = await queue.enqueue(
      [{ userId: 'user-a', event: { name: 'ui.test' } }],
      { domain: false },
    );
    expect(result).toEqual({ accepted: 1, dropped: 0 });
    expect(mockDbQuery).toHaveBeenCalledTimes(1);
    expect(mockDbQuery).toHaveBeenCalledWith("SELECT pg_notify('oxsteed_activity_ingest', '')");
  });

  test('a fully dropped enqueue does not notify', async () => {
    mockEval.mockResolvedValue(0);
    const queue = require('../growth/queue');
    const result = await queue.enqueue(
      [{ userId: 'user-a', event: { name: 'ui.test' } }],
      { domain: false },
    );
    expect(result).toEqual({ accepted: 0, dropped: 1 });
    expect(mockDbQuery).not.toHaveBeenCalled();
  });

  test('a notify failure never fails the enqueue', async () => {
    mockDbQuery.mockRejectedValueOnce(new Error('db down'));
    const queue = require('../growth/queue');
    const result = await queue.enqueue(
      [{ userId: 'user-a', event: { name: 'ui.test' } }],
      { domain: false },
    );
    expect(result).toEqual({ accepted: 1, dropped: 0 });
  });
});
