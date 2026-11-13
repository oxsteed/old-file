'use strict';

/**
 * Domain 8 #17: the parked-batch incident must name the rows to reset.
 *
 * The growth-erasure worker parks a batch after repeated verification
 * failures and records a high incident. Before the fix the incident
 * details carried only { count, table, attempts }: an operator told to
 * reset the parked rows could not tell which rows they were without
 * guessing from the queue. The details must now carry the parked row
 * ids and subject keys.
 *
 * ClickHouse, the queue and the fence are mocked; the park path (and
 * the incident payload) run for real.
 */
jest.mock('../jobs/jobLockingService', () => ({
  withFencedJobLock: jest.fn(),
  LeaseLostError: class LeaseLostError extends Error {},
}));
jest.mock('../growth/queue', () => ({ eraseSubject: jest.fn(async () => {}) }));
jest.mock('../growth/clickhouse', () => ({ getClient: jest.fn() }));
jest.mock('../services/incidentStore', () => ({ recordIncident: jest.fn(async () => ({ persisted: true })) }));
jest.mock('../utils/logger', () => ({ warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() }));

const { mockQuery, resetMocks } = require('./setup');
const { withFencedJobLock } = require('../jobs/jobLockingService');
const { getClient } = require('../growth/clickhouse');
const { recordIncident } = require('../services/incidentStore');

process.env.GROWTH_CLICKHOUSE_URL = 'http://clickhouse-test:8123';

beforeEach(() => {
  resetMocks();
  jest.clearAllMocks();
});

test('parking a batch records an incident naming the row ids and subject keys', async () => {
  const queueRows = [
    { id: 11, subject_key: 'a'.repeat(64), device_keys: ['device-1'] },
    { id: 22, subject_key: 'b'.repeat(64), device_keys: ['device-2'] },
  ];
  withFencedJobLock.mockImplementationOnce(async (_name, fn) => fn({
    db: {
      query: jest.fn(async () => ({ rows: queueRows })),
    },
    assertActive: jest.fn(),
  }));
  getClient.mockReturnValue({
    command: jest.fn(async () => {}),
    query: jest.fn(async () => ({ json: async () => [{ remaining: 1 }] })),
  });
  // Bookkeeping pool: verification bump hits the cap (3), then the park
  // update runs.
  mockQuery
    .mockResolvedValueOnce({
      rows: [
        { id: 11, verification_attempts: 3 },
        { id: 22, verification_attempts: 3 },
      ],
    })
    .mockResolvedValueOnce({ rows: [] });

  const { run } = require('../jobs/growthErasure');
  const result = await run();

  expect(result).toMatchObject({ completed: 0, parked: 2, verificationAttempts: 3 });
  expect(recordIncident).toHaveBeenCalledWith(expect.objectContaining({
    type: 'growth_erasure_verification_parked',
    severity: 'high',
  }));
  const details = recordIncident.mock.calls[0][0].details;
  expect(details).toMatchObject({ count: 2, table: 'activity_events', attempts: 3 });
  expect(details.rowIds).toEqual([11, 22]);
  expect(details.subjectKeys).toEqual(['a'.repeat(64), 'b'.repeat(64)]);
});
