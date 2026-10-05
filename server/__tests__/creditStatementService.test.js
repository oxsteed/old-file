'use strict';

const { mockQuery, resetMocks } = require('./setup');
const { Pool } = require('pg');
const service = require('../services/creditStatementService');

const OWNER = '11111111-1111-4111-8111-111111111111';
const NOW = '2026-10-05T12:00:00.000Z';
const MONTH = { from: '2026-09-01', to: '2026-09-30' };
const row = (overrides = {}) => ({ id: 'txn-fixture', date: '2026-09-12T12:00:00Z',
  type: 'load', amount_cents: '1000', balance_after_cents: '1000', direction: 'credit',
  description: 'Synthetic fixture', ...overrides });
let account, opening, closing, rows, holds, saved, calls;

beforeEach(() => {
  resetMocks(); Pool.mockConnect.mockClear(); Pool.mockRelease.mockClear();
  account = { id: '41', currency_code: 'USD', created_at: '2026-01-01T00:00:00Z',
    owner_name: 'Synthetic Customer', account_label: 'OxSteed Credit' };
  opening = '0'; closing = '1000'; rows = [row()]; holds = []; saved = null; calls = [];
  mockQuery.mockImplementation(async (sql, values) => {
    calls.push([sql, values]);
    if (sql.includes('transaction_timestamp()')) return { rows: [{ now: NOW }] };
    if (sql.includes('AS owner_name')) return { rows: account ? [account] : [] };
    if (sql.includes('SELECT document, content_hash')) return { rows: saved ? [saved] : [] };
    if (sql.includes('SELECT e.balance_after_cents')) {
      return { rows: [{ balance_after_cents: values.length === 3 ? opening : closing }] };
    }
    if (sql.includes(' AS type,')) return { rows };
    if (sql.includes("status='active'")) return { rows: holds };
    return { rows: [] };
  });
});

describe('period validation uses UTC calendar days', () => {
  test('defaults to previous complete month across January/year rollover', () => {
    expect(service.periodFor(undefined, undefined, new Date('2026-01-01T00:00:01Z')))
      .toEqual({ from: '2025-12-01', to: '2025-12-31', kind: 'monthly' });
  });
  test('leap February is a complete monthly period', () => {
    expect(service.periodFor('2024-02-01', '2024-02-29', new Date(NOW)).kind).toBe('monthly');
  });
  test.each([
    ['2026-02-30', '2026-03-01'], ['2026-09-01', '2026-09-31'],
    ['2026-09-02', '2026-09-01'], ['2026-10-01', '2026-10-06'],
    ['2024-01-01', '2026-01-01'], ['1999-12-31', '2000-01-01'],
    ['', '2026-09-30'], [null, '2026-09-30'], [['2026-09-01'], '2026-09-30'],
    ['2026-09-01T00:00:00Z', '2026-09-30'], ['2026-9-01', '2026-09-30'],
  ])('rejects malformed/unsupported interval %p to %p', (from, to) => {
    expect(() => service.periodFor(from, to, new Date(NOW))).toThrow(expect.objectContaining({ code: 'statement_invalid_period' }));
  });
  test('ongoing and custom closed periods remain interim', () => {
    expect(service.periodFor('2026-10-01', '2026-10-05', new Date(NOW)).kind).toBe('interim');
    expect(service.periodFor('2026-09-02', '2026-09-30', new Date(NOW)).kind).toBe('interim');
  });
  test('maximum 366-day interval accepted, 367 rejected', () => {
    expect(service.periodFor('2024-01-01', '2024-12-31', new Date(NOW)).kind).toBe('interim');
    expect(() => service.periodFor('2024-01-01', '2025-01-01', new Date(NOW))).toThrow();
  });
});

describe('exact minor-unit accounting', () => {
  test.each(['0', '-500', '9007199254740991', -1, 1000, 1000n])('accepts exact integer %p', value => {
    expect(service.exactMoney(value)).toBe(Number(value));
  });
  test.each(['9007199254740992', 9007199254740992, '1.5', 1.5, '1e3', NaN, Infinity, null, undefined, true, ''])
  ('rejects unsafe or noninteger amount %p', value => {
    expect(() => service.exactMoney(value)).toThrow(expect.objectContaining({ code: 'statement_integrity_failed' }));
  });
  test('refund and fee directions, not labels, determine balance changes', () => {
    const result = service.reconcileRows([
      row({ type: 'refund', amount_cents: '250', balance_after_cents: '1250' }),
      row({ type: 'fee', direction: 'debit', amount_cents: '50', balance_after_cents: '1200' }),
      row({ type: 'chargeback', direction: 'debit', amount_cents: '200', balance_after_cents: '1000' }),
    ], '1000');
    expect(result).toMatchObject({ closingBalanceCents: 1000, totalCreditsCents: 250, totalDebitsCents: 250 });
    expect(result.transactions[1]).toMatchObject({ debitCents: 50, creditCents: 0, balanceAfterCents: 1200 });
  });
  test('no-activity period carries original posted balance forward', () => {
    expect(service.reconcileRows([], '1250')).toEqual({ transactions: [], closingBalanceCents: 1250,
      totalCreditsCents: 0, totalDebitsCents: 0 });
  });
  test.each([
    { amount_cents: '0' }, { amount_cents: '-1' }, { direction: 'pending' },
    { balance_after_cents: '999' }, { balance_after_cents: '9007199254740992' },
  ])('rejects nonreconciling/invalid ledger row %p', override => {
    expect(() => service.reconcileRows([row(override)], '0')).toThrow(expect.objectContaining({ code: 'statement_integrity_failed' }));
  });
  test('rejects aggregate overflow even when each individual movement is safe', () => {
    expect(() => service.reconcileRows([
      row({ amount_cents: '9007199254740991', balance_after_cents: '9007199254740991' }),
      row({ direction: 'debit', amount_cents: '9007199254740991', balance_after_cents: '0' }),
      row({ amount_cents: '1', balance_after_cents: '1' }),
    ], '0')).toThrow(expect.objectContaining({ code: 'statement_integrity_failed' }));
  });
  test('removes control characters and bounds descriptions without leaking source metadata', () => {
    const transaction = service.reconcileRows([row({ description: 'hello\nworld\u0000' + 'x'.repeat(500), metadata: { private: true } })], '0').transactions[0];
    expect(transaction.description).toHaveLength(255);
    expect(transaction.description).not.toMatch(/[\x00-\x1f\x7f]/);
    expect(transaction).not.toHaveProperty('metadata');
  });
});

test('document hash ignores key insertion order and its own contentHash', () => {
  expect(service.hashDocument({ b: [{ z: 2, a: 1 }], a: 3, contentHash: 'ignored' }))
    .toBe(service.hashDocument({ a: 3, b: [{ a: 1, z: 2 }] }));
  expect(service.hashDocument({ a: 3 })).not.toBe(service.hashDocument({ a: 4 }));
});

test('monthly issuance reconciles, is masked, bounded, and commits one snapshot', async () => {
  const statement = await service.getStatement(OWNER, MONTH);
  expect(statement).toMatchObject({ kind: 'monthly', openingBalanceCents: 0, closingBalanceCents: 1000,
    totalCreditsCents: 1000, totalDebitsCents: 0, accountReference: 'OC-••••0041', holds: [], holdsAsOf: null });
  expect(statement.contentHash).toBe(service.hashDocument(statement));
  expect(calls[0][0]).toBe('BEGIN ISOLATION LEVEL REPEATABLE READ');
  expect(calls.some(([sql]) => sql.includes('statement_timeout'))).toBe(true);
  const activity = calls.find(([sql]) => sql.includes(' AS type,'));
  expect(activity[1]).toEqual(['41', 'USD', '2026-09-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z', NOW, service.MAX_ROWS + 1]);
  expect(activity[0]).toContain("t.status IN ('posted', 'reversed')");
  expect(calls.filter(([sql]) => sql.includes('INSERT INTO credit_statement_documents'))).toHaveLength(1);
  expect(calls.at(-1)[0]).toBe('COMMIT'); expect(Pool.mockRelease).toHaveBeenCalledTimes(1);
});

test('restaurant query scopes every read to restaurant wallet account and currency', async () => {
  account.account_label = 'Synthetic Restaurant';
  const statement = await service.getStatement(OWNER, { ...MONTH, product: 'restaurant', restaurantId: '99', currencyCode: 'eur' });
  expect(statement.currencyCode).toBe('EUR');
  expect(calls.find(([sql]) => sql.includes('AS owner_name'))[1]).toEqual([OWNER, '99', 'EUR']);
  for (const [sql, values] of calls.filter(([sql]) => sql.includes('FROM food_customer_wallet_ledger'))) {
    expect(sql).toContain('e.account_id=$1'); expect(sql).toContain('e.currency_code=$2');
    expect(values.slice(0, 2)).toEqual(['41', 'EUR']);
  }
  expect(calls.some(([sql]) => sql.includes('oxsteed_credit_transaction_entries'))).toBe(false);
});

test.each([
  [{ product: 'other' }, 'statement_invalid_product'],
  [{ currencyCode: 'US' }, 'statement_invalid_account'],
  [{ currencyCode: ['USD', 'EUR'] }, 'statement_invalid_account'],
  [{ product: 'restaurant', restaurantId: '0' }, 'statement_invalid_account'],
  [{ product: 'restaurant', restaurantId: '1 OR 1=1' }, 'statement_invalid_account'],
])('invalid account selection rolls back and releases %p', async (options, code) => {
  await expect(service.getStatement(OWNER, { ...MONTH, ...options })).rejects.toMatchObject({ code });
  expect(calls.at(-1)[0]).toBe('ROLLBACK'); expect(Pool.mockRelease).toHaveBeenCalledTimes(1);
  expect(calls.some(([sql]) => sql.includes('INSERT INTO credit_statement_documents'))).toBe(false);
});

test('wrong owner/missing account cannot receive a fabricated zero statement', async () => {
  account = null;
  await expect(service.getStatement(OWNER, MONTH)).rejects.toMatchObject({ code: 'statement_account_not_found' });
  expect(calls.some(([sql]) => sql.includes('transaction_entries'))).toBe(false);
});
test('period before account creation is rejected', async () => {
  account.created_at = '2026-10-01T00:00:00Z';
  await expect(service.getStatement(OWNER, MONTH)).rejects.toMatchObject({ code: 'statement_before_account' });
});
test('zero-activity month preserves its opening/closing balance', async () => {
  opening = closing = '2300'; rows = [];
  const statement = await service.getStatement(OWNER, MONTH);
  expect(statement).toMatchObject({ openingBalanceCents: 2300, closingBalanceCents: 2300,
    totalDebitsCents: 0, totalCreditsCents: 0, transactionCount: 0 });
});
test('current holds appear only as current-as-of reservations, never monthly posted activity', async () => {
  holds = [{ id: 'hold', amount_cents: '300', expires_at: '2026-10-06T00:00:00Z' }];
  await service.getStatement(OWNER, MONTH);
  expect(calls.some(([sql]) => sql.includes("status='active'"))).toBe(false);
  rows = []; opening = closing = '1000'; calls = [];
  const interim = await service.getStatement(OWNER, { from: '2026-10-01', to: '2026-10-05' });
  expect(interim).toMatchObject({ holdsAsOf: NOW, totalHeldCents: 300, closingBalanceCents: 1000, transactionCount: 0 });
  expect(calls.some(([sql]) => sql.includes('INSERT INTO credit_statement_documents'))).toBe(false);
});
test('already sealed month returns its original identity/hash without rescanning today ledger/holds', async () => {
  const document = await service.getStatement(OWNER, MONTH);
  saved = { document, content_hash: document.contentHash }; calls = [];
  rows = [row({ balance_after_cents: '17' })]; holds = [{ amount_cents: '900' }];
  expect(await service.getStatement(OWNER, MONTH)).toEqual(document);
  expect(calls.some(([sql]) => sql.includes('FROM oxsteed_credit_transaction_entries'))).toBe(false);
  expect(calls.some(([sql]) => sql.includes('INSERT INTO credit_statement_documents'))).toBe(false);
});
test('tampered sealed report fails closed and rolls back', async () => {
  const document = await service.getStatement(OWNER, MONTH);
  saved = { document: { ...document, closingBalanceCents: 1 }, content_hash: document.contentHash }; calls = [];
  await expect(service.getStatement(OWNER, MONTH)).rejects.toMatchObject({ code: 'statement_integrity_failed' });
  expect(calls.at(-1)[0]).toBe('ROLLBACK');
});
test('tampered embedded checksum is rejected even if the document body still hashes correctly', async () => {
  const document = await service.getStatement(OWNER, MONTH);
  saved = { document: { ...document, contentHash: 'b'.repeat(64) }, content_hash: document.contentHash };
  await expect(service.getStatement(OWNER, MONTH)).rejects.toMatchObject({ code: 'statement_integrity_failed' });
});
test.each(['activity', 'closing', 'too-many-rows', 'too-many-holds'])('ledger/export failure %s cannot persist a partial statement', async failure => {
  let options = MONTH;
  if (failure === 'activity') rows = [row({ balance_after_cents: '999' })];
  if (failure === 'closing') closing = '999';
  if (failure === 'too-many-rows') rows = Array.from({ length: service.MAX_ROWS + 1 }, () => row());
  if (failure === 'too-many-holds') {
    rows = []; opening = closing = '1000'; holds = Array.from({ length: service.MAX_ROWS + 1 }, () => ({}));
    options = { from: '2026-10-01', to: '2026-10-05' };
  }
  await expect(service.getStatement(OWNER, options)).rejects.toMatchObject({ code: failure.startsWith('too-many')
    ? 'statement_export_too_large' : 'statement_integrity_failed' });
  expect(calls.some(([sql]) => sql.includes('INSERT INTO credit_statement_documents'))).toBe(false);
  expect(calls.at(-1)[0]).toBe('ROLLBACK');
});
test.each(['40001', '23505'])('concurrent monthly issuance %s retries with fresh connection/snapshot', async code => {
  const original = mockQuery.getMockImplementation(); let collided = false;
  mockQuery.mockImplementation(async (sql, values) => {
    if (sql.includes('INSERT INTO credit_statement_documents') && !collided) {
      collided = true; calls.push([sql, values]); throw Object.assign(new Error('synthetic race'), { code });
    }
    return original(sql, values);
  });
  expect((await service.getStatement(OWNER, MONTH)).kind).toBe('monthly');
  expect(calls.filter(([sql]) => sql === 'ROLLBACK')).toHaveLength(1);
  expect(Pool.mockConnect).toHaveBeenCalledTimes(2); expect(Pool.mockRelease).toHaveBeenCalledTimes(2);
});
test('serialization retries are bounded and ordinary DB errors are never retried', async () => {
  mockQuery.mockImplementation(async sql => {
    if (sql === 'ROLLBACK') return { rows: [] };
    throw Object.assign(new Error('synthetic serialization'), { code: '40001' });
  });
  await expect(service.getStatement(OWNER, MONTH)).rejects.toMatchObject({ code: '40001' });
  expect(Pool.mockConnect).toHaveBeenCalledTimes(3); expect(Pool.mockRelease).toHaveBeenCalledTimes(3);
  Pool.mockConnect.mockClear(); Pool.mockRelease.mockClear();
  mockQuery.mockRejectedValue(Object.assign(new Error('synthetic undefined table'), { code: '42P01' }));
  await expect(service.getStatement(OWNER, MONTH)).rejects.toMatchObject({ code: '42P01' });
  expect(Pool.mockConnect).toHaveBeenCalledTimes(1); expect(Pool.mockRelease).toHaveBeenCalledTimes(1);
});
