'use strict';

// Background-jobs audit (Oct 30 item 9): the refund reconcilers used to
// re-queue a failing refund forever with no terminal state and no
// escalation. They now mirror the payment refund cap: after 48 attempts
// the row is terminal 'failed' and a critical exception is raised.
// All mocked: the fence is faked, the provider check always fails, the
// exception sink is a jest.fn.

jest.mock('../jobs/jobLockingService', () => ({
  withFencedJobLock: jest.fn(),
}));
jest.mock('../services/reconciliationExceptions', () => ({
  recordException: jest.fn(async () => ({ persisted: true })),
}));
jest.mock('../services/externalRefundService', () => ({
  reconcileExternalRefundAttempt: jest.fn(async () => { throw new Error('provider down'); }),
}));
jest.mock('../services/marketplaceRefundService', () => ({
  reconcileMarketplaceRefundReservation: jest.fn(async () => { throw new Error('provider down'); }),
}));

const { withFencedJobLock } = require('../jobs/jobLockingService');
const { recordException } = require('../services/reconciliationExceptions');
const { runExternalRefundReconciliation } = require('../jobs/externalRefundReconciliation');
const { runMarketplaceRefundReconciliation } = require('../jobs/marketplaceRefundReconciliation');

function fakeFenceDb(selectRows) {
  const queries = [];
  const db = {
    query: jest.fn(async (sql, params) => {
      queries.push([String(sql), params]);
      if (String(sql).includes('SELECT')) return { rows: selectRows, rowCount: selectRows.length };
      return { rows: [], rowCount: 1 };
    }),
  };
  return { db, queries };
}

beforeEach(() => {
  jest.clearAllMocks();
  withFencedJobLock.mockImplementation(async (_name, handler) => {
    await handler({ assertActive: jest.fn(), db: global.__fakeDb });
    return { completed: true };
  });
});

describe('refund reconciliation terminal cap (Oct 30 item 9)', () => {
  test('external: the 48th failed attempt goes terminal failed with a critical exception', async () => {
    const { db, queries } = fakeFenceDb([{ id: 'att-1', reconciliation_attempts: 47 }]);
    global.__fakeDb = db;
    const result = await runExternalRefundReconciliation();
    expect(result).toMatchObject({ inspected: 1, failed: 1 });
    const terminalUpdate = queries.find(
      ([sql, params]) => sql.includes('UPDATE external_refund_attempts') && sql.includes("CASE WHEN $3 THEN 'failed'")
    );
    expect(terminalUpdate).toBeTruthy();
    expect(terminalUpdate[1]).toEqual(['att-1', 'provider down', true]);
    expect(recordException).toHaveBeenCalledWith(expect.objectContaining({
      domain: 'external_refund',
      referenceId: 'att-1',
      severity: 'critical',
      summary: expect.stringContaining('failed permanently after 48 tries'),
    }));
  });

  test('external: below the cap the row stays pending and the exception is a warning', async () => {
    const { db, queries } = fakeFenceDb([{ id: 'att-2', reconciliation_attempts: 1 }]);
    global.__fakeDb = db;
    const result = await runExternalRefundReconciliation();
    expect(result).toMatchObject({ inspected: 1, failed: 1 });
    const terminalUpdate = queries.find(
      ([sql]) => sql.includes('UPDATE external_refund_attempts') && sql.includes("CASE WHEN $3 THEN 'failed'")
    );
    expect(terminalUpdate[1]).toEqual(['att-2', 'provider down', false]);
    expect(recordException).toHaveBeenCalledWith(expect.objectContaining({
      severity: 'warning',
      summary: expect.not.stringContaining('failed permanently'),
    }));
  });

  test('marketplace: the 48th failed attempt goes terminal failed with a critical exception', async () => {
    const { db, queries } = fakeFenceDb([{
      id: 'ref-1', reconciliation_attempts: 47, order_id: 'ord-1', order_status: 'paid',
      transaction_id: 'txn-1', transaction_payment_intent_id: 'pi_1',
      transaction_amount_cents: 10000, transaction_refunded_amount_cents: 0,
      transaction_currency: 'USD', transaction_status: 'succeeded',
    }]);
    global.__fakeDb = db;
    const result = await runMarketplaceRefundReconciliation();
    expect(result).toMatchObject({ inspected: 1, failed: 1 });
    const terminalUpdate = queries.find(
      ([sql, params]) => sql.includes('UPDATE marketplace_transaction_refunds') && sql.includes("CASE WHEN $3 THEN 'failed'")
    );
    expect(terminalUpdate).toBeTruthy();
    expect(terminalUpdate[1]).toEqual(['ref-1', 'provider down', true]);
    expect(recordException).toHaveBeenCalledWith(expect.objectContaining({
      domain: 'marketplace_refund',
      referenceId: 'ref-1',
      severity: 'critical',
      summary: expect.stringContaining('failed permanently after 48 tries'),
    }));
  });
});
