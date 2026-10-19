import test from 'node:test';
import assert from 'node:assert/strict';
import { analyticsCsv, formatAnalyticsCell } from '../src/utils/analyticsFormat.js';

test('formats exact database integer strings with their actual currency precision', () => {
  assert.match(formatAnalyticsCell('revenue_cents', '12345', { currency_code: 'USD' }), /123\.45/);
  assert.match(formatAnalyticsCell('revenue_cents', '12345', { currency_code: 'JPY' }), /12,345/);
  assert.match(formatAnalyticsCell('revenue_cents', '12345', { currency_code: 'KWD' }), /12\.345/);
  assert.match(formatAnalyticsCell('revenue_cents', '9007199254740993', { currency_code: 'USD' }), /90,071,992,547,409\.93/);
});

test('neutralizes untrusted spreadsheet formulas, preserves numeric records and quotes newlines', () => {
  const csv = analyticsCsv([
    { name: '=SUM(A1:A9)', amount: '-12345' },
    { name: '\t@SUM(A1)', amount: '9007199254740993' },
    { name: 'Menu,"name"\r\nSecond line', amount: null },
  ], ['name', 'amount']);
  assert.match(csv, /'=SUM/);
  assert.match(csv, /'\t@SUM/);
  assert.match(csv, /,-12345/);
  assert.match(csv, /,9007199254740993/);
  assert.match(csv, /"Menu,""name""\r\nSecond line"/);
});
