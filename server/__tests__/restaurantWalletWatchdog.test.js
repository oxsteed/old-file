'use strict';

jest.mock('../db', () => ({ query: jest.fn() }));
jest.mock('../services/incidentStore', () => ({
  recordIncident: jest.fn().mockResolvedValue({ persisted: true, incident: { id: 'incident-1' } }),
  resolveOpenIncidentsByDedupeKeys: jest.fn().mockResolvedValue([]),
}));
jest.mock('../jobs/jobLockingService', () => ({
  withJobLock: jest.fn(async (_jobName, handler) => handler()),
}));
jest.mock('../services/oxsteedCreditWorkerHeartbeat', () => ({
  recordOxsteedCreditWorkerRun: jest.fn().mockResolvedValue({ persisted: true }),
}));

const db = require('../db');
const incidentStore = require('../services/incidentStore');
const { withJobLock } = require('../jobs/jobLockingService');
const { recordOxsteedCreditWorkerRun } = require('../services/oxsteedCreditWorkerHeartbeat');
const {
  JOB_NAME,
  CRON_EXPRESSION,
  PENDING_PAYMENT_STALE_MINUTES,
  FAILED_PAYMENT_WINDOW_MINUTES,
  INCIDENT_KEYS,
  inspectRestaurantWalletOperations,
  runRestaurantWalletWatchdog,
} = require('../jobs/restaurantWalletWatchdog');

function healthyRows() {
  return [
    { stale_count: 0, stale_amount_cents: 0, oldest_expires_at: null },
    { pending_count: 0, pending_amount_cents: 0, oldest_created_at: null },
    { failed_count: 0, failed_amount_cents: 0, last_failed_at: null },
    { drift_count: 0, drift_amount_cents: 0 },
    { lock_count: 0, last_locked_at: null },
    { drift_count: 0, drift_amount_cents: 0 },
  ];
}

beforeEach(() => jest.clearAllMocks());

test('returns healthy and resolves recovered wallet incidents', async () => {
  healthyRows().forEach((row) => db.query.mockResolvedValueOnce({ rows: [row] }));

  await expect(inspectRestaurantWalletOperations()).resolves.toMatchObject({
    status: 'healthy',
    checks: {
      staleQrSessions: { count: 0 },
      pendingPosPayments: { count: 0, staleAfterMinutes: PENDING_PAYMENT_STALE_MINUTES },
      failedPosPayments: { count: 0, windowMinutes: FAILED_PAYMENT_WINDOW_MINUTES },
      reservationDrift: { drift_count: 0, drift_amount_cents: 0 },
      balanceDrift: { drift_count: 0, drift_amount_cents: 0 },
      integrityLocks: { count: 0, windowMinutes: FAILED_PAYMENT_WINDOW_MINUTES },
    },
  });
  expect(incidentStore.recordIncident).not.toHaveBeenCalled();
  expect(incidentStore.resolveOpenIncidentsByDedupeKeys).toHaveBeenCalledWith(
    expect.arrayContaining([
      ...Object.values(INCIDENT_KEYS),
    ]),
    expect.any(String),
  );
});

test('records durable incidents for stale and inconsistent money operations', async () => {
  [
    { stale_count: 2, stale_amount_cents: '1800', oldest_expires_at: '2026-09-13T12:00:00.000Z' },
    { pending_count: 1, pending_amount_cents: '900', oldest_created_at: '2026-09-13T11:00:00.000Z' },
    { failed_count: 3, failed_amount_cents: '2700', last_failed_at: '2026-09-13T12:14:00.000Z' },
    { drift_count: 1, drift_amount_cents: '500' },
    { drift_count: 2, drift_amount_cents: '700' },
    { lock_count: 1, last_locked_at: '2026-09-13T12:14:00.000Z' },
  ].forEach((row) => db.query.mockResolvedValueOnce({ rows: [row] }));

  const result = await inspectRestaurantWalletOperations();

  expect(result.status).toBe('attention');
  expect(incidentStore.recordIncident).toHaveBeenCalledTimes(6);
  expect(incidentStore.recordIncident.mock.calls.map(([input]) => input.dedupeKey)).toEqual([
    INCIDENT_KEYS.staleQrSessions,
    INCIDENT_KEYS.pendingPayments,
    INCIDENT_KEYS.failedPayments,
    INCIDENT_KEYS.reservationDrift,
    INCIDENT_KEYS.balanceDrift,
    INCIDENT_KEYS.integrityLocks,
  ]);
  expect(incidentStore.recordIncident).toHaveBeenCalledWith(expect.objectContaining({
    type: 'restaurant_credit_balance_drift',
    severity: 'critical',
    details: { drift_count: 2, drift_amount_cents: 700 },
  }));
});

test('runs under the distributed lock and records an operational heartbeat', async () => {
  healthyRows().forEach((row) => db.query.mockResolvedValueOnce({ rows: [row] }));

  await expect(runRestaurantWalletWatchdog()).resolves.toMatchObject({ locked: true, status: 'healthy' });
  expect(withJobLock).toHaveBeenCalledWith(JOB_NAME, expect.any(Function), 120, { throwOnLockError: true });
  expect(recordOxsteedCreditWorkerRun).toHaveBeenCalledWith({
    jobName: JOB_NAME,
    result: { status: 'healthy', incidentCount: 0 },
    error: null,
  });
  expect(CRON_EXPRESSION).toBe('*/5 * * * *');
});

test('records a durable incident when the watchdog cannot query', async () => {
  db.query.mockRejectedValueOnce(new Error('database unavailable'));

  await expect(runRestaurantWalletWatchdog()).resolves.toMatchObject({
    locked: true,
    status: 'error',
    error: 'database unavailable',
  });
  expect(incidentStore.recordIncident).toHaveBeenCalledWith(expect.objectContaining({
    type: 'restaurant_credit_wallet_watchdog_failed',
    severity: 'critical',
    dedupeKey: INCIDENT_KEYS.watchdogFailure,
  }));
  expect(recordOxsteedCreditWorkerRun).toHaveBeenCalledWith(expect.objectContaining({
    jobName: JOB_NAME,
    error: expect.any(Error),
  }));
});
