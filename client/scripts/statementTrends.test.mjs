import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { trendPeriodForStatement } from '../src/lib/statementTrends.js';

// Slice 5e, item 725 (D-751): the period comparison follows the applied
// statement's period instead of always comparing the current UTC month.

test('a single-month statement compares that month', () => {
  assert.equal(
    trendPeriodForStatement({ from: '2026-09-01', to: '2026-09-30' }),
    '2026-09',
  );
  assert.equal(
    trendPeriodForStatement({ from: '2026-11-01', to: '2026-11-28' }),
    '2026-11',
  );
});

test('a multi-month custom range compares its ending month', () => {
  assert.equal(
    trendPeriodForStatement({ from: '2026-10-15', to: '2026-11-20' }),
    '2026-11',
  );
  assert.equal(
    trendPeriodForStatement({ from: '2025-12-20', to: '2026-01-10' }),
    '2026-01',
  );
});

test('a missing or malformed period yields undefined (component default)', () => {
  assert.equal(trendPeriodForStatement(null), undefined);
  assert.equal(trendPeriodForStatement(undefined), undefined);
  assert.equal(trendPeriodForStatement({}), undefined);
  assert.equal(trendPeriodForStatement({ from: 'soon', to: '2026-11-28' }), undefined);
  assert.equal(trendPeriodForStatement({ from: '2026-11-01' }), undefined);
});

test('the statement page passes the applied period to PeriodTrends', async () => {
  const page = await readFile(
    new URL('../src/pages/food/CreditStatementsPage.jsx', import.meta.url), 'utf8');
  assert.match(page, /trendPeriodForStatement\(statement\?\.period\)/);
  assert.match(page, /<PeriodTrends product=\{product\} accountId=\{accountKey\(selected, product\)\} period=\{trendPeriodForStatement\(statement\?\.period\)\} \/>/);
});

test('PeriodTrends re-fetches when the period changes', async () => {
  const component = await readFile(
    new URL('../src/components/statements/PeriodTrends.jsx', import.meta.url), 'utf8');
  assert.match(component, /\[product, accountId, period\]/);
});
