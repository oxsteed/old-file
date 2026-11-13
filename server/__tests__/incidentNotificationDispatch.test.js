'use strict';

/**
 * Domain 7 #28 — one failing row aborts the whole incident-dispatch batch.
 *
 * Repro: three claimed critical incidents in one tick, the first row's
 * dispatch throws (e.g. the lease-clear UPDATE inside
 * dispatchRecordedIncident). Before the fix the throw propagates out of
 * dispatchPendingIncidentNotifications and rows 2-3 are never dispatched
 * until the next 60s tick. After the fix each row is attempted, the failure
 * is logged and counted, and the remaining rows still dispatch.
 */

jest.mock('../services/incidentAlertService', () => ({
  dispatchRecordedIncident: jest.fn(),
}));
jest.mock('../utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

const alerts = require('../services/incidentAlertService');
const { dispatchPendingIncidentNotifications } = require('../jobs/incidentNotificationDispatch');

const ROWS = [
  { id: 1, type: 'audit_failure', severity: 'critical', last_seen_at: new Date().toISOString() },
  { id: 2, type: 'audit_failure', severity: 'critical', last_seen_at: new Date().toISOString() },
  { id: 3, type: 'audit_failure', severity: 'critical', last_seen_at: new Date().toISOString() },
];

function fakeDb() {
  return { query: jest.fn().mockResolvedValue({ rows: ROWS }) };
}

beforeEach(() => {
  jest.clearAllMocks();
});

test('one failing row does not abort the remaining dispatches in the tick', async () => {
  alerts.dispatchRecordedIncident
    .mockRejectedValueOnce(new Error('lease-clear UPDATE failed'))
    .mockResolvedValue({ dispatched: true });

  const result = await dispatchPendingIncidentNotifications({ db: fakeDb() });

  expect(alerts.dispatchRecordedIncident).toHaveBeenCalledTimes(3);
  expect(alerts.dispatchRecordedIncident).toHaveBeenNthCalledWith(
    2,
    expect.objectContaining({ id: 2 }),
  );
  expect(alerts.dispatchRecordedIncident).toHaveBeenNthCalledWith(
    3,
    expect.objectContaining({ id: 3 }),
  );
  expect(result).toEqual({ examined: 3, dispatched: 2, failed: 1 });
});

test('all rows failing still resolves with a failed count instead of throwing', async () => {
  alerts.dispatchRecordedIncident.mockRejectedValue(new Error('downstream down'));

  const result = await dispatchPendingIncidentNotifications({ db: fakeDb() });

  expect(alerts.dispatchRecordedIncident).toHaveBeenCalledTimes(3);
  expect(result).toEqual({ examined: 3, dispatched: 0, failed: 3 });
});
