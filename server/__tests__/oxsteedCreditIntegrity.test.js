'use strict';

jest.mock('../db', () => ({ query: jest.fn() }));
jest.mock('../scripts/verify-oxsteed-credit', () => ({
  verifyEntryHashes: jest.fn(),
}));
jest.mock('../services/incidentStore', () => ({
  recordIncident: jest.fn().mockResolvedValue({ persisted: true, incident: { id: 'incident-1' } }),
}));
jest.mock('../jobs/jobLockingService', () => {
  // E03: fenced lock mock. The fence is healthy by default; db calls pass
  // through to the (mocked) db module so job logic is exercised.
  const fence = {
    isActive: () => true,
    assertActive: () => {},
    db: {
      query: (...args) => require('../db').query(...args),
      tx: (work) => work({ query: (...args) => require('../db').query(...args) }),
    },
    fencedQuery: (...args) => require('../db').query(...args),
    fencedTransaction: (work) => work({ query: (...args) => require('../db').query(...args) }),
  };
  return {
    withJobLock: jest.fn(async (_jobName, handler) => handler(fence)),
    withFencedJobLock: jest.fn(async (_jobName, handler) => handler(fence)),
    LeaseLostError: class LeaseLostError extends Error {},
  };
});
jest.mock('../services/oxsteedCreditWorkerHeartbeat', () => ({
  recordOxsteedCreditWorkerRun: jest.fn().mockResolvedValue({ persisted: true }),
}));

jest.mock('../services/oxsteedCreditService', () => {
  // Rail guard pinned to "enabled": these suites exercise job logic, not the
  // rail-disabled skip path (covered in oxsteedCreditRailDisabled.test.js).
  const actual = jest.requireActual('../services/oxsteedCreditService');
  return { ...actual, skipCreditJobWhenRailDisabled: jest.fn().mockResolvedValue(false), skipOversightJobWhenIdle: jest.fn().mockResolvedValue(false) };
});

const pool = require('../db');
const { verifyEntryHashes } = require('../scripts/verify-oxsteed-credit');
const incidentStore = require('../services/incidentStore');
const { withFencedJobLock } = require('../jobs/jobLockingService');
const {
  JOB_NAME,
  verifyCreditLedger,
  runOxsteedCreditIntegrity,
} = require('../jobs/oxsteedCreditIntegrity');

beforeEach(() => {
  jest.clearAllMocks();
});

// Routes the batched integrity queries by SQL text.
function routeQueries({ entries, accounts, invalidAudit }) {
  pool.query.mockImplementation(async (sql, params) => {
    if (/FROM oxsteed_credit_accounts/.test(sql)) return { rows: Number(params?.[0] || 0) === 0 ? accounts : [] };
    if (/FROM oxsteed_credit_transaction_entries/.test(sql)) return { rows: entries };
    if (/compute_oxsteed_credit_audit_event_hash/.test(sql)) return { rows: [{ invalid_count: String(invalidAudit) }] };
    return { rows: [] };
  });
}

test('verifies the complete posted journal and account heads under a distributed lock', async () => {
  routeQueries({
    entries: [{ transaction_id: 'tx-1', account_id: 7, sequence: 1 }],
    accounts: [{ id: 7, ledger_version: 1, last_entry_hash: 'hash-1' }],
    invalidAudit: 0,
  });
  verifyEntryHashes.mockReturnValueOnce({ invalidEntryHashes: 0, invalidHashChains: 0, invalidAccountHashHeads: 0 });

  const result = await runOxsteedCreditIntegrity();

  expect(result).toMatchObject({ locked: true, ok: true, verification: { invalidEntryHashes: 0 } });
  expect(withFencedJobLock).toHaveBeenCalledWith(JOB_NAME, expect.any(Function), 900, { throwOnLockError: true });
  expect(verifyEntryHashes).toHaveBeenCalledWith(
    [{ transaction_id: 'tx-1', account_id: 7, sequence: 1 }],
    [{ id: 7, ledger_version: 1, last_entry_hash: 'hash-1' }]
  );
  expect(pool.query.mock.calls.some(([sql]) => /compute_oxsteed_credit_audit_event_hash/.test(sql))).toBe(true);
  expect(incidentStore.recordIncident).not.toHaveBeenCalled();
});

test('records a critical incident when the journal hash chain is invalid', async () => {
  routeQueries({
    entries: [{ transaction_id: 'tx-2', account_id: 8, sequence: 2 }],
    accounts: [{ id: 8, ledger_version: 2, last_entry_hash: 'hash-2' }],
    invalidAudit: 0,
  });
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

test('records a critical incident when the audit event hash chain is invalid', async () => {
  routeQueries({ entries: [], accounts: [], invalidAudit: 1 });
  verifyEntryHashes.mockReturnValueOnce({ invalidEntryHashes: 0, invalidHashChains: 0, invalidAccountHashHeads: 0 });

  const result = await verifyCreditLedger();

  expect(result).toMatchObject({ ok: false, verification: { invalidAuditHashEvents: 1 } });
  expect(incidentStore.recordIncident).toHaveBeenCalledWith(expect.objectContaining({
    type: 'oxsteed_credit_integrity_failure',
    severity: 'critical',
  }));
});

test('does not run the integrity check when another worker owns the lease', async () => {
  withFencedJobLock.mockImplementationOnce(async () => undefined);

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
