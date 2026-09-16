'use strict';

jest.mock('../services/oxsteedCreditAdminService', () => ({
  reconcileCreditLedger: jest.fn(),
}));
jest.mock('../services/incidentStore', () => ({
  recordIncident: jest.fn().mockResolvedValue({ persisted: true, incident: { id: 1 }, notificationClaimed: true }),
}));
jest.mock('../jobs/jobLockingService', () => ({
  withJobLock: jest.fn(async (_jobName, handler) => handler()),
}));
jest.mock('../services/oxsteedCreditWorkerHeartbeat', () => ({
  recordOxsteedCreditWorkerRun: jest.fn().mockResolvedValue({ persisted: true }),
}));

const { reconcileCreditLedger } = require('../services/oxsteedCreditAdminService');
const incidentStore = require('../services/incidentStore');
const { withJobLock } = require('../jobs/jobLockingService');
const {
  CRON_EXPRESSION,
  CRON_TIMEZONE,
  previousUtcDay,
  runOxsteedCreditReconciliation,
  runOxsteedCreditReconciliations,
} = require('../jobs/oxsteedCreditReconciliation');

beforeEach(() => {
  jest.clearAllMocks();
});

test('uses the prior UTC day and records a balanced run under a distributed lock', async () => {
  reconcileCreditLedger.mockResolvedValueOnce({
    run: {
      id: 'run-1',
      status: 'balanced',
      currencyCode: 'USD',
      accountCount: 3,
      entryCount: 6,
    },
  });

  const result = await runOxsteedCreditReconciliation({ now: '2026-09-12T04:00:00.000Z' });

  expect(result).toMatchObject({
    locked: true,
    run: { id: 'run-1', status: 'balanced' },
    period: {
      start: '2026-09-11T00:00:00.000Z',
      end: '2026-09-12T00:00:00.000Z',
    },
  });
  expect(withJobLock).toHaveBeenCalledWith('oxsteed-credit-reconciliation', expect.any(Function), 300, { throwOnLockError: true });
  expect(reconcileCreditLedger).toHaveBeenCalledWith(expect.objectContaining({
    currencyCode: 'USD',
    actorUserId: null,
    periodStart: new Date('2026-09-11T00:00:00.000Z'),
    periodEnd: new Date('2026-09-12T00:00:00.000Z'),
  }));
  expect(incidentStore.recordIncident).not.toHaveBeenCalled();
});

test('creates a durable critical incident when balances differ', async () => {
  reconcileCreditLedger.mockResolvedValueOnce({
    run: {
      id: 'run-2',
      status: 'difference',
      currencyCode: 'USD',
      periodStart: '2026-09-11T00:00:00.000Z',
      periodEnd: '2026-09-12T00:00:00.000Z',
      accountBalanceCents: 1000,
      journalBalanceCents: 900,
      differenceCents: 100,
      accountCount: 3,
      entryCount: 6,
    },
  });

  const result = await runOxsteedCreditReconciliation({ now: '2026-09-12T04:00:00.000Z' });

  expect(result.run.status).toBe('difference');
  expect(incidentStore.recordIncident).toHaveBeenCalledWith(expect.objectContaining({
    type: 'oxsteed_credit_reconciliation_difference',
    severity: 'critical',
    details: expect.objectContaining({ runId: 'run-2', differenceCents: 100 }),
  }));
});

test('records a durable incident when reconciliation fails', async () => {
  reconcileCreditLedger.mockRejectedValueOnce(new Error('database unavailable'));

  await expect(runOxsteedCreditReconciliation({ now: '2026-09-12T04:00:00.000Z' })).resolves.toMatchObject({
    locked: true,
    run: null,
    error: 'database unavailable',
  });
  expect(incidentStore.recordIncident).toHaveBeenCalledWith(expect.objectContaining({
    type: 'oxsteed_credit_reconciliation_failed',
    severity: 'critical',
    details: expect.objectContaining({ error: 'database unavailable' }),
  }));
});

test('returns an unlocked result when another worker owns the lease', async () => {
  withJobLock.mockImplementationOnce(async () => undefined);

  const result = await runOxsteedCreditReconciliation({ now: '2026-09-12T04:00:00.000Z' });

  expect(result.locked).toBe(false);
  expect(reconcileCreditLedger).not.toHaveBeenCalled();
});

test('runs all configured currencies under one distributed lock', async () => {
  reconcileCreditLedger
    .mockResolvedValueOnce({ run: { id: 'usd-run', status: 'balanced', currencyCode: 'USD', accountCount: 1, entryCount: 2 } })
    .mockResolvedValueOnce({ run: { id: 'eur-run', status: 'balanced', currencyCode: 'EUR', accountCount: 1, entryCount: 2 } });

  const result = await runOxsteedCreditReconciliations({
    now: '2026-09-12T04:00:00.000Z',
    currencyCodes: ['USD', 'EUR'],
  });

  expect(result).toMatchObject({ locked: true, runs: [{ id: 'usd-run' }, { id: 'eur-run' }] });
  expect(withJobLock).toHaveBeenCalledTimes(1);
  expect(reconcileCreditLedger.mock.calls.map(([input]) => input.currencyCode)).toEqual(['USD', 'EUR']);
});

test('records a durable incident when the reconciliation lock store is unavailable', async () => {
  withJobLock.mockRejectedValueOnce(new Error('database unavailable'));

  const result = await runOxsteedCreditReconciliations({ now: '2026-09-12T04:00:00.000Z' });

  expect(result).toMatchObject({
    locked: false,
    errors: [{ currencyCode: 'all', error: 'database unavailable' }],
  });
  expect(incidentStore.recordIncident).toHaveBeenCalledWith(expect.objectContaining({
    type: 'oxsteed_credit_reconciliation_lock_failed',
    severity: 'critical',
  }));
});

test('exports a deterministic UTC schedule', () => {
  expect(CRON_EXPRESSION).toBe('10 2 * * *');
  expect(CRON_TIMEZONE).toBe('UTC');
  expect(previousUtcDay('2026-03-01T01:00:00.000Z')).toEqual({
    start: new Date('2026-02-28T00:00:00.000Z'),
    end: new Date('2026-03-01T00:00:00.000Z'),
  });
});

test.each([
  ['spring-forward boundary', '2026-03-08T07:30:00.000Z', '2026-03-07T00:00:00.000Z', '2026-03-08T00:00:00.000Z'],
  ['fall-back boundary', '2026-11-01T06:30:00.000Z', '2026-10-31T00:00:00.000Z', '2026-11-01T00:00:00.000Z'],
])('%s stays on complete UTC day boundaries', (_label, now, start, end) => {
  expect(previousUtcDay(now)).toEqual({
    start: new Date(start),
    end: new Date(end),
  });
});
