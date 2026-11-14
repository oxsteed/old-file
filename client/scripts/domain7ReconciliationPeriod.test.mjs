// Domain 7 #26: the settlement page's reconciliation request must not send
// periodStart/periodEnd — the run always covers the all-time ledger, so the
// form must not invite a period-scoped reading. The settlement-creation form
// keeps its own period inputs (createSettlement still posts them).
//
// Run: node --test scripts/domain7ReconciliationPeriod.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const page = fs.readFileSync(
  path.join(root, 'src', 'admin', 'pages', 'super', 'oxsteedCredit', 'SettlementsPage.jsx'),
  'utf8',
);

function reconciliationPostBody(src) {
  const start = src.indexOf("adminApi.post('/admin/super/oxsteed-credit/reconciliation'");
  assert.notEqual(start, -1, 'reconciliation POST not found in SettlementsPage.jsx');
  const end = src.indexOf('});', start);
  assert.notEqual(end, -1, 'reconciliation POST body not terminated');
  return src.slice(start, end);
}

test('reconciliation request sends no period fields', () => {
  const body = reconciliationPostBody(page);
  assert.doesNotMatch(body, /periodStart/, 'reconciliation POST still sends periodStart');
  assert.doesNotMatch(body, /periodEnd/, 'reconciliation POST still sends periodEnd');
  assert.match(body, /currencyCode/, 'reconciliation POST must still send currencyCode');
  assert.match(body, /reason/, 'reconciliation POST must still send reason');
});

test('settlement creation keeps its own period fields', () => {
  assert.match(page, /periodStart: new Date\(settlementForm\.periodStart\)/, 'createSettlement must still post periodStart');
  assert.match(page, /periodEnd: new Date\(settlementForm\.periodEnd\)/, 'createSettlement must still post periodEnd');
});
