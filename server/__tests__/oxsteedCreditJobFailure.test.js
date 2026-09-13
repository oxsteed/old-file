'use strict';

jest.mock('../services/incidentStore', () => ({
  recordIncident: jest.fn(),
}));

const incidentStore = require('../services/incidentStore');
const { errorMessage, recordOxsteedCreditJobFailure } = require('../jobs/oxsteedCreditJobFailure');

beforeEach(() => {
  jest.clearAllMocks();
});

test('records a deduplicated critical incident with safe worker context', async () => {
  incidentStore.recordIncident.mockResolvedValueOnce({
    persisted: true,
    incident: { id: 42 },
  });

  await expect(recordOxsteedCreditJobFailure({
    jobName: 'oxsteed-credit-hold-expiry',
    error: new Error('database unavailable'),
    details: { limit: 500 },
  })).resolves.toMatchObject({ persisted: true });

  expect(incidentStore.recordIncident).toHaveBeenCalledWith({
    type: 'oxsteed_credit_worker_failed',
    severity: 'critical',
    message: 'OxSteed Credit worker failed: oxsteed-credit-hold-expiry',
    dedupeKey: 'oxsteed-credit-worker:oxsteed-credit-hold-expiry:failed',
    details: {
      limit: 500,
      jobName: 'oxsteed-credit-hold-expiry',
      error: 'database unavailable',
    },
  });
});

test('does not throw when incident persistence fails', async () => {
  incidentStore.recordIncident.mockRejectedValueOnce(new Error('incident table unavailable'));

  await expect(recordOxsteedCreditJobFailure({
    jobName: 'oxsteed-credit-entitlement-expiry',
    error: 'worker timeout',
  })).resolves.toBeNull();
});

test('normalizes unknown errors for durable diagnostics', () => {
  expect(errorMessage(new Error('boom'))).toBe('boom');
  expect(errorMessage('timeout')).toBe('timeout');
  expect(errorMessage()).toBe('Unknown worker error');
});
