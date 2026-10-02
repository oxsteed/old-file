'use strict';

/**
 * E04 — DB workload budgets.
 *
 * Failing reproduction: today every part of the app shares one pg Pool with
 * no statement timeout and no per-workload limits. A single runaway export
 * or a pile of cron workers can saturate the pool and take down the web
 * tier with it. There is also no shared "bounded pagination" helper, so
 * list endpoints each invent their own (or no) limits.
 *
 * The contract we need:
 *   1. Named workload budgets (web/jobs/exports/realtime): withDbBudget()
 *      runs work under a semaphore; when the budget is exhausted the call
 *      FAILS CLOSED with DbBudgetExhaustedError instead of queueing forever.
 *   2. budgetedQuery() runs a query with a session statement_timeout so a
 *      runaway query is killed by Postgres, and resets the timeout on
 *      release so the pooled connection is clean for the next workload.
 *   3. Unknown workloads fail closed (no silent unbounded default).
 *   4. parsePagination() clamps limit/offset so no list query is unbounded.
 */

const { mockQuery, resetMocks } = require('./setup');
const {
  DbBudgetExhaustedError,
  withDbBudget,
  budgetedQuery,
  configureBudget,
  getBudgetConfig,
} = require('../utils/dbBudgets');
const { parsePagination } = require('../utils/boundedPagination');

beforeEach(() => {
  resetMocks();
  mockQuery.mockImplementation(async () => ({ rows: [], rowCount: 0 }));
});

function deferred() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
}

describe('E04 workload budgets', () => {
  test('withDbBudget runs the work and releases the slot', async () => {
    configureBudget('e04-test', { maxConcurrent: 1, queueTimeoutMs: 1000 });
    const result = await withDbBudget('e04-test', async () => 'ok');
    expect(result).toBe('ok');
    // Slot released: a second run works immediately.
    await expect(withDbBudget('e04-test', async () => 'again')).resolves.toBe('again');
    expect(getBudgetConfig('e04-test').maxConcurrent).toBe(1);
  });

  test('budget exhaustion fails closed instead of queueing forever', async () => {
    configureBudget('e04-tight', { maxConcurrent: 1, queueTimeoutMs: 50 });
    const gate = deferred();
    const holder = withDbBudget('e04-tight', () => gate.promise);
    await new Promise((r) => setImmediate(r)); // let the holder acquire

    await expect(withDbBudget('e04-tight', async () => 'never'))
      .rejects.toThrow(DbBudgetExhaustedError);
    const err = await withDbBudget('e04-tight', async () => 'never').catch((e) => e);
    expect(err.code).toBe('DB_BUDGET_EXHAUSTED');

    gate.resolve();
    await holder;
    // After release, work flows again.
    await expect(withDbBudget('e04-tight', async () => 'recovered')).resolves.toBe('recovered');
  });

  test('unknown workloads fail closed', async () => {
    await expect(withDbBudget('no-such-workload', async () => 'x'))
      .rejects.toThrow(/unknown.*workload/i);
  });

  test('budgetedQuery sets a statement timeout and resets it on release', async () => {
    configureBudget('e04-q', { maxConcurrent: 2, queueTimeoutMs: 1000, statementTimeoutMs: 45000 });
    await budgetedQuery('e04-q', 'SELECT 1');

    const statements = mockQuery.mock.calls.map(([sql]) => String(sql));
    expect(statements[0]).toMatch(/SET statement_timeout = 45000/);
    expect(statements).toContain('SELECT 1');
    expect(statements[statements.length - 1]).toMatch(/RESET statement_timeout/);
  });

  test('budgetedQuery fails closed when the budget is exhausted', async () => {
    configureBudget('e04-qfull', { maxConcurrent: 1, queueTimeoutMs: 50 });
    const gate = deferred();
    const holder = withDbBudget('e04-qfull', () => gate.promise);
    await new Promise((r) => setImmediate(r));

    await expect(budgetedQuery('e04-qfull', 'SELECT 1'))
      .rejects.toThrow(DbBudgetExhaustedError);
    // The refused query never reached the database.
    expect(mockQuery).not.toHaveBeenCalled();

    gate.resolve();
    await holder;
  });
});

describe('E04 pool-level guardrails', () => {
  test('the shared pool carries statement timeout guardrails', () => {
    const { Pool } = require('pg');
    require('../db'); // constructs the (mocked) pool
    const config = Pool.mock.calls[0][0];
    expect(config.statement_timeout).toBe(30000);
    expect(config.idle_in_transaction_session_timeout).toBe(60000);
  });
});

describe('E04 bounded pagination', () => {  test('clamps an excessive limit to the max', () => {
    expect(parsePagination({ limit: '100000', page: '1' }, { maxLimit: 200 }))
      .toMatchObject({ limit: 200 });
  });

  test('rejects negative offsets and non-numeric input with safe defaults', () => {
    expect(parsePagination({ limit: 'abc', offset: '-5' }, { defaultLimit: 50, maxLimit: 200 }))
      .toMatchObject({ limit: 50, offset: 0 });
  });

  test('page-based input converts to offset', () => {
    expect(parsePagination({ limit: '25', page: '3' }, { maxLimit: 200 }))
      .toMatchObject({ limit: 25, offset: 50 });
  });
});
