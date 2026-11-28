import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dataAsOfDate, formatPeriodMonth } from '../src/lib/statementFreshness.js';
import { buildStatementAccounts } from '../src/lib/statementAccounts.js';

// Slice 5e, item 721 (D-746, D-747): dataset freshness on the statement
// report views. The server reports freshness per product/scope; the client
// derives only the interim report's as-of date (latest posted transaction,
// else the period end) and formats 'YYYY-MM' months for the copy.

test('dataAsOfDate returns the latest posted transaction date', () => {
  const statement = {
    period: { from: '2026-11-01', to: '2026-11-28' },
    transactions: [
      { date: '2026-11-03T10:00:00.000Z' },
      { date: '2026-11-20' },
      { date: '2026-11-12T08:30:00.000Z' },
    ],
  };
  assert.equal(dataAsOfDate(statement), '2026-11-20');
});

test('dataAsOfDate falls back to the period end with no transactions', () => {
  assert.equal(
    dataAsOfDate({ period: { from: '2026-11-01', to: '2026-11-28' }, transactions: [] }),
    '2026-11-28',
  );
  assert.equal(
    dataAsOfDate({ period: { from: '2026-11-01', to: '2026-11-28' } }),
    '2026-11-28',
  );
});

test('dataAsOfDate ignores malformed dates and returns null without a statement', () => {
  assert.equal(dataAsOfDate(null), null);
  assert.equal(dataAsOfDate({ period: {}, transactions: [{ date: 'soon' }, { date: null }] }), null);
  assert.equal(
    dataAsOfDate({ period: { from: '2026-11-01', to: '2026-11-28' }, transactions: [{ date: 'not-a-date' }] }),
    '2026-11-28',
  );
});

test('formatPeriodMonth localizes the month and year, never shifts by timezone', () => {
  assert.equal(formatPeriodMonth('2026-10', 'en'), 'October 2026');
  assert.equal(formatPeriodMonth('2026-10', 'fr'), 'octobre 2026');
  assert.equal(formatPeriodMonth('2025-12', 'en'), 'December 2025');
  assert.equal(formatPeriodMonth('bogus', 'en'), 'bogus');
  assert.equal(formatPeriodMonth(null, 'en'), '');
});

test('buildStatementAccounts carries the product freshness onto the record', () => {
  const products = {
    oxsteedCredit: {
      hasAccount: true,
      scopes: [{ scopeKey: 'oxsteed:USD', currency: 'USD', label: 'OxSteed Credit' }],
      freshness: { state: 'stale', latestPeriod: '2026-09', expectedPeriod: '2026-10' },
    },
  };
  const accounts = buildStatementAccounts(products);
  assert.equal(accounts.length, 1);
  assert.deepEqual(accounts[0].records[0].freshness, {
    state: 'stale', latestPeriod: '2026-09', expectedPeriod: '2026-10',
  });
  const withoutFreshness = buildStatementAccounts({
    oxsteedCredit: { hasAccount: true, scopes: [{ scopeKey: 'oxsteed:USD', currency: 'USD' }] },
  });
  assert.equal(withoutFreshness[0].records[0].freshness, null);
});

test('freshness i18n keys exist in all five credit catalogs', async () => {
  const keys = [
    'statements.center.freshnessCurrent',
    'statements.center.freshnessPending',
    'statements.center.freshnessStale',
    'archive.freshnessPending',
    'archive.freshnessStale',
    'statements.dataAsOf',
  ];
  for (const language of ['en', 'es', 'fr', 'ht', 'ar']) {
    const catalog = JSON.parse(
      await readFile(new URL(`../src/i18n/locales/${language}/credit.json`, import.meta.url), 'utf8'),
    );
    for (const key of keys) {
      const value = key.split('.').reduce((node, part) => node?.[part], catalog);
      assert.equal(typeof value, 'string', `${language} ${key} must be a string`);
      assert.notEqual(value, '', `${language} ${key} must not be empty`);
    }
  }
});

test('the three report views render the freshness they were given', async () => {
  const center = await readFile(
    new URL('../src/pages/food/StatementCenterPage.jsx', import.meta.url), 'utf8');
  assert.match(center, /freshnessText\(value\.freshness\)/);
  assert.match(center, /freshness\.state !== 'none'/);

  const archive = await readFile(
    new URL('../src/pages/food/StatementArchivePage.jsx', import.meta.url), 'utf8');
  assert.match(archive, /archive\.freshness\?\.state === 'stale'/);
  assert.match(archive, /archive\.freshness\?\.state === 'pending'/);
  assert.match(archive, /freshness: result\?\.freshness/);

  const credit = await readFile(
    new URL('../src/pages/food/CreditStatementsPage.jsx', import.meta.url), 'utf8');
  assert.match(credit, /dataAsOfDate\(statement\)/);
  assert.match(credit, /statement\.kind === 'interim'/);
});
