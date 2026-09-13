'use strict';

jest.mock('../db', () => ({ query: jest.fn() }));
jest.mock('../scripts/verify-oxsteed-credit', () => ({
  verifyEntryHashes: jest.fn(),
}));
jest.mock('../services/incidentStore', () => ({
  recordIncident: jest.fn().mockResolvedValue({ persisted: true, incident: { id: 'incident-1' } }),
}));
jest.mock('../jobs/jobLockingService', () => ({
  withJobLock: jest.fn(async (_jobName, handler) => handler()),
}));

const pool = require('../db');
const { verifyEntryHashes } = require('../scripts/verify-oxsteed-credit');
const incidentStore = require('../services/incidentStore');
const { withJobLock } = require('../jobs/jobLockingService');
const {
  JOB_NAME,
  verifyCreditLedger,
  runOxsteedCreditIntegrity,
} = require('../jobs/oxsteedCreditIntegrity');

beforeEach(() => {
  jest.clearAllMocks();
});

test('verifies the complete posted journal and account heads under a distributed lock', async () => {
  pool.query
    .mockResolvedValueOnce({ rows: [{ transaction_id: 'tx-1', account_id: 7, sequence: 1 }] })
    .mockResolvedValueOnce({ rows: [{ id: 7, ledger_version: 1, last_entry_hash: 'hash-1' }] });
  verifyEntryHashes.mockReturnValueOnce({ invalidEntryHashes: 0, invalidHashChains: 0, invalidAccountHashHeads: 0 });

  const result = await runOxsteedCreditIntegrity();

  expect(result).toMatchObject({ locked: true, ok: true, verification: { invalidEntryHashes: 0 } });
  expect(withJobLock).toHaveBeenCalledWith(JOB_NAME, expect.any(Function), 900);
  expect(verifyEntryHashes).toHaveBeenCalledWith(
    [{ transaction_id: 'tx-1', account_id: 7, sequence: 1 }],
    [{ id: 7, ledger_version: 1, last_entry_hash: 'hash-1' }]
  );
  expect(incidentStore.recordIncident).not.toHaveBeenCalled();
});

test('records a critical incident when the journal hash chain is invalid', async () => {
  pool.query
    .mockResolvedValueOnce({ rows: [{ transaction_id: 'tx-2', account_id: 8, sequence: 2 }] })
    .mockResolvedValueOnce({ rows: [{ id: 8, ledger_version: 2, last_entry_hash: 'hash-2' }] });
  verifyEntryHashes.mockReturnValueOnce({ invalidEntryHashes: 1, invalidHashChains: 0, invalidAccountHashHeads: 1 });

  const result = await verifyCreditLedger();

  expect(result).toMatchObject({ ok: false, verification: { invalidEntryHashes: 1, invalidAccountHashHeads: 1 } });
  expect(incidentStore.recordIncident).toHaveBeenCalledWith(expect.objectContaining({
    type: 'oxsteed_credit_integrity_failure',
    severity: 'critical',
    dedupeKey: 'oxsteed-credit-integrity:hash-chain',
    details: expect.objectContaining({ postedEntryCount: 1, accountCount: 1 }),
  }));
});

test('does not run the integrity check when another worker owns the lease', async () => {
  withJobLock.mockImplementationOnce(async () => undefined);

  const result = await runOxsteedCreditIntegrity();

  expect(result).toEqual({ locked: false, ok: false, verification: null, incident: null });
  expect(pool.query).not.toHaveBeenCalled();
});

test('records a critical incident when the integrity scan cannot complete', async () => {
  pool.query.mockRejectedValueOnce(new Error('database unavailable'));

  const result = await runOxsteedCreditIntegrity();

  expect(result).toMatchObject({ locked: true, ok: false, verification: null });
  expect(incidentStore.recordIncident).toHaveBeenCalledWith(expect.objectContaining({
    type: 'oxsteed_credit_integrity_check_failed',
    severity: 'critical',
    details: { error: 'database unavailable' },
  }));
});
